using System.Diagnostics;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace KaneMode;

/// <summary>
/// Fenêtre plein écran qui affiche l'interface KaneMode (dossier ui\) dans WebView2.
/// L'interface parle à l'app par window.chrome.webview.postMessage pour ce qu'une page web
/// ne peut pas faire : retour au bureau, veille, redémarrage, extinction.
/// </summary>
public partial class MainWindow : Window
{
    public const string WindowTitle = "KaneMode";

    private HostProcess _host = new();
    // Menu ou accès rapide ouvert par-dessus une autre fenêtre (KanePlay) : on y retourne en le fermant
    private IntPtr _returnTo;
    // Boutons dédiés de la ROG Ally et ce qu'ils font (réglés dans Paramètres > Console portable)
    private readonly AllyButtons _buttons = new();
    private readonly XInputPads _pads;
    private readonly CursorOverlay _cursor = new();
    private IntPtr _hwnd; // fenêtre principale, lue par le fil des manettes
    private Dictionary<string, string> _buttonActions = new() { ["cc"] = "taskview", ["ac"] = "gamebar", ["ac-hold"] = "home" };
    private bool _blockAsusPrompt = true;
    private bool _ready;
    private bool _failed;

    private static readonly string[] Args = Environment.GetCommandLineArgs();

    public MainWindow()
    {
        InitializeComponent();
        // Développement : --windowed ouvre une fenêtre normale au lieu du plein écran.
        if (Args.Contains("--windowed"))
        {
            WindowStyle = WindowStyle.SingleBorderWindow;
            ResizeMode = ResizeMode.CanResize;
            WindowState = WindowState.Normal;
            Width = 1280;
            Height = 800;
        }
        Loaded += async (_, _) => await StartAsync();
        SourceInitialized += (_, _) => { _hwnd = new WindowInteropHelper(this).Handle; HwndSource.FromHwnd(_hwnd)?.AddHook(WndProc); };
        // Manettes XInput lues par l'app tant que KaneMode a la main (voir XInputPads), et mode souris
        _pads = new XInputPads(PadFocus);
        _pads.Changed += json => Dispatcher.BeginInvoke(() => { try { Web.CoreWebView2?.PostWebMessageAsJson("{\"type\":\"xpad\",\"pads\":" + json + "}"); } catch (InvalidOperationException) { } });
        _pads.Reclaim += () => Dispatcher.BeginInvoke(ReclaimForeground);
        _pads.Knock += () => Dispatcher.BeginInvoke(LogPadKnock);
        _pads.MouseModeChanged += on => Dispatcher.BeginInvoke(() =>
        {
            _cursor.Set(on); // curseur de KaneMode quand Windows cache le sien (mode Xbox)
            if (_ready) Post(new { type = "mouse-mode", on });
        });
        Activated += (_, _) => OnActivated();
        // KaneMode quitte le premier plan (jeu, Game Bar, bureau) : l'interface le signale à l'hôte
        Deactivated += (_, _) => { if (_ready) Post(new { type = "background" }); };
        // WebView2 libéré dès le début de la fermeture : sinon, la fenêtre qui se masque le sollicite alors
        // que son moteur s'arrête, et KaneMode plantait en se fermant (violation d'accès)
        Closing += (_, _) => { try { Web.Dispose(); } catch (Exception ex) when (ex is InvalidOperationException or System.Runtime.InteropServices.COMException) { } };
        Closed += (_, _) => { SystemEvents.PowerModeChanged -= OnPowerModeChanged; SystemEvents.DisplaySettingsChanged -= OnDisplayChanged; _buttons.Dispose(); _pads.Dispose(); _host.Dispose(); };
        _buttons.Pressed += b => Dispatcher.BeginInvoke(() => OnDeviceButton(b));
        // Widget Game Bar : ses messages « natifs » passent par le même traitement que ceux de l'interface
        WidgetBridge.NativeMessage = json => Dispatcher.Invoke(() => HandleMessage(json, fromWidget: true));
        // Veille et réveil du système, quelle qu'en soit la cause (menu, bouton d'alimentation, capot…)
        SystemEvents.PowerModeChanged += OnPowerModeChanged;
        // Résolution ou mise à l'échelle changée (widget Game Bar, Paramètres de Windows)
        SystemEvents.DisplaySettingsChanged += OnDisplayChanged;
        PreviewKeyDown += OnKeyDown;
    }

    private async Task StartAsync()
    {
        _failed = false;
        Hint.Visibility = Visibility.Collapsed;
        try
        {
            Status.Text = "Démarrage de KaneMode…";
            await Task.Run(Paths.ImportPrototypeData);
            // L'hôte (Node) et le moteur web (WebView2) démarrent en même temps : une à deux secondes de gagnées
            Task host = _host.StartAsync();
            Task web = Web.CoreWebView2 == null ? InitWebViewAsync() : Task.CompletedTask;
            await Task.WhenAll(host, web);
            Web.CoreWebView2!.Navigate($"{_host.Url}/?native=1");
            _buttons.Start();
            _pads.Start();
            WidgetBridge.Start(_host.Url);
            WatchKanePlay();
        }
        catch (Exception ex)
        {
            Log.Write("Échec du démarrage : " + ex);
            _failed = true;
            Status.Text = "KaneMode n’a pas pu démarrer :\n" + ex.Message;
            Hint.Visibility = Visibility.Visible;
        }
    }

    private async Task InitWebViewAsync()
    {
        // Son de démarrage (et vidéo perso) joués sans clic préalable.
        string browserArgs = "--autoplay-policy=no-user-gesture-required";
        // Développement : --debug-port=9229 permet d'inspecter l'interface depuis l'extérieur.
        string? debugPort = Args.FirstOrDefault(a => a.StartsWith("--debug-port="))?.Split('=')[1];
        if (debugPort != null && int.TryParse(debugPort, out _)) browserArgs += $" --remote-debugging-port={debugPort}";
        var options = new CoreWebView2EnvironmentOptions(browserArgs);
        var env = await CoreWebView2Environment.CreateAsync(null, Paths.WebViewData, options);
        await Web.EnsureCoreWebView2Async(env);
        ConfigureWebView(Web.CoreWebView2!);
    }

    private void ConfigureWebView(CoreWebView2 core)
    {
        var s = core.Settings;
        s.AreDefaultContextMenusEnabled = false;
        s.IsZoomControlEnabled = false;
        s.IsStatusBarEnabled = false;
        s.IsPinchZoomEnabled = false;
        s.IsSwipeNavigationEnabled = false;
#if DEBUG
        s.AreDevToolsEnabled = true;
#else
        s.AreDevToolsEnabled = false;
        s.AreBrowserAcceleratorKeysEnabled = false; // pas de F5, Ctrl+P… comme dans une vraie console
#endif
        core.WebMessageReceived += OnWebMessage;
        core.NavigationCompleted += (_, e) =>
        {
            if (!e.IsSuccess) { Log.Write($"Navigation : {e.WebErrorStatus}"); return; }
            Log.Write("Interface chargée");
            _ready = true;
            Loading.Visibility = Visibility.Collapsed;
            Web.Visibility = Visibility.Visible;
            Web.Focus();
        };
        // Les liens qui voudraient ouvrir une nouvelle fenêtre partent dans le navigateur par défaut.
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) && (uri.Scheme == "https" || uri.Scheme == "http"))
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        };
        core.ProcessFailed += (_, e) => Log.Write($"WebView2 : processus {e.ProcessFailedKind} arrêté");
    }

    /// <summary>
    /// Qui a la main, pour les manettes (lu par le fil des manettes). Au retour de KanePlay, le premier
    /// plan pouvait rester à une fenêtre fermée ou masquée : KaneMode était affiché mais la manette ne
    /// répondait plus, jusqu'à passer par la vue des tâches (retour de l'utilisateur).
    /// </summary>
    private XInputPads.Focus PadFocus()
    {
        var focus = ComputePadFocus();
        if (focus != _lastPadFocus)
        {
            // Journal : qui a la main pour la manette (diagnostic du mode Xbox sur la console)
            _lastPadFocus = focus;
            IntPtr f = Native.GetForegroundWindow();
            Log.Write($"Manette : {focus} (premier plan « {Native.WindowTitle(f)} », {Native.ProcessName(Native.WindowProcessId(f))}, {Native.WindowClass(f)})");
        }
        return focus;
    }
    private XInputPads.Focus _lastPadFocus = XInputPads.Focus.Hidden;

    private XInputPads.Focus ComputePadFocus()
    {
        IntPtr me = _hwnd;
        if (!_ready || me == IntPtr.Zero) return XInputPads.Focus.Hidden;
        IntPtr f = Native.GetForegroundWindow();
        if (f == me) return XInputPads.Focus.Ours;
        // Autre fenêtre de KaneMode (curseur du mode souris) : c'est toujours nous
        if (f != IntPtr.Zero && Native.WindowProcessId(f) == (uint)Environment.ProcessId) return XInputPads.Focus.Ours;
        // Jeu suivi ou KanePlay qu'on met devant : c'est à eux, KaneMode n'y touche pas
        if (_game != null || _watch != null) return XInputPads.Focus.Hidden;
        if (!Native.IsMinimized(me) && Native.IsAppWindow(me))
        {
            if (Native.IsOrphanForeground(f)) return XInputPads.Focus.Orphan;
            // Fenêtre d'application cachée derrière KaneMode : on peut reprendre la main. Sinon (fenêtre
            // outil, superposition), on ne fait que le noter dans le journal.
            IntPtr top = Native.VisibleWindows().FirstOrDefault(Native.IsAppWindow);
            if (top == me) return Native.IsAppWindow(f) ? XInputPads.Focus.Orphan : XInputPads.Focus.Other;
        }
        // KaneMode en arrière-plan (bureau Windows, lanceur, navigateur devant) : Start maintenu y active
        // le mode souris. Jamais par-dessus une fenêtre qui couvre l'écran (jeu, Game Bar, vue des tâches).
        return Native.IsOrphanForeground(f) || !Native.CoversMonitor(f) ? XInputPads.Focus.Desktop : XInputPads.Focus.Hidden;
    }

    private DateTime _reclaimedAt;
    private void ReclaimForeground()
    {
        if (DateTime.UtcNow - _reclaimedAt < TimeSpan.FromSeconds(1)) return;
        _reclaimedAt = DateTime.UtcNow;
        IntPtr f = Native.GetForegroundWindow();
        if (f == Hwnd) return;
        Log.Write($"Manette : premier plan repris (il était à « {Native.WindowTitle(f)} », {Native.ProcessName(Native.WindowProcessId(f))}, {Native.WindowClass(f)})");
        Native.ForceForeground(Hwnd);
        Web.Focus();
    }

    private IntPtr _knocked;
    private void LogPadKnock()
    {
        IntPtr f = Native.GetForegroundWindow();
        if (f == _knocked || f == Hwnd) return;
        _knocked = f;
        Log.Write($"Manette : KaneMode est affiché mais « {Native.WindowTitle(f)} » ({Native.ProcessName(Native.WindowProcessId(f))}, {Native.WindowClass(f)}) a le premier plan");
    }

    /// <summary>Retour sur KaneMode (après un jeu par exemple) : focus et rafraîchissement.</summary>
    private void OnActivated()
    {
        if (!_ready) return;
        Web.Focus();
        Post(new { type = "resume" });
    }

    /// <summary>
    /// Messages des autres programmes de KaneMode. KanePlay envoie « open	qam » ou « open	menu »
    /// (WM_COPYDATA, wParam = sa fenêtre) quand on appuie sur Start ou Select.
    /// </summary>
    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg != Native.WM_COPYDATA || lParam == IntPtr.Zero) return IntPtr.Zero;
        var data = System.Runtime.InteropServices.Marshal.PtrToStructure<Native.CopyData>(lParam);
        if (data.Kind != (IntPtr)0x4B4D || data.Data == IntPtr.Zero) return IntPtr.Zero;
        string text = System.Runtime.InteropServices.Marshal.PtrToStringUni(data.Data) ?? "";
        string[] parts = text.Split('\t');
        if (parts.Length == 2 && parts[0] == "open" && (parts[1] == "qam" || parts[1] == "menu"))
        {
            handled = true;
            OpenOverlay(parts[1], wParam);
            return (IntPtr)1;
        }
        return IntPtr.Zero;
    }

    /// <summary>Ouvre le menu ou l'accès rapide de KaneMode par-dessus la fenêtre `from`.</summary>
    public void OpenOverlay(string panel, IntPtr from)
    {
        if (!_ready) return;
        _returnTo = from;
        Log.Write($"Ouverture de « {panel} » par-dessus une autre fenêtre");
        StopForegroundWatch();
        StopInsisting();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Maximized;
        Show();
        // Pas toujours autorisé par Windows (bouton de la console pressé en plein jeu) : on insiste
        if (!Native.ForceForeground(Hwnd)) Activate();
        Web.Focus();
        Post(new { type = "open", panel });
    }

    private IntPtr Hwnd => new WindowInteropHelper(this).Handle;

    // ---------- Premier plan d'un programme lancé (KanePlay) ----------
    private System.Windows.Threading.DispatcherTimer? _watch;

    /// <summary>
    /// KanePlay lancé ou relancé : Windows ne lui laisse pas toujours le premier plan (il est lancé
    /// par l'hôte, pas par la fenêtre active). Pendant quelques secondes, KaneMode, qui a encore le
    /// premier plan, guette sa fenêtre et la met lui-même devant. Si aucun KanePlay ne tourne plus
    /// (la commande est partie vers une instance en train de se fermer), l'interface relance.
    /// </summary>
    private void WatchForeground(string title)
    {
        StopForegroundWatch();
        var started = DateTime.UtcNow;
        int stable = 0;
        bool seen = false, lost = false;
        _watch = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(120) };
        _watch.Tick += (_, _) =>
        {
            double elapsed = (DateTime.UtcNow - started).TotalSeconds;
            IntPtr hwnd = Native.FindVisibleWindow(title);
            if (hwnd != IntPtr.Zero)
            {
                seen = true;
                if (Native.GetForegroundWindow() == hwnd) { if (++stable >= 5) StopForegroundWatch(); }
                else
                {
                    stable = 0;
                    Log.Write($"« {title} » n’est pas au premier plan : KaneMode l’y met");
                    Native.ForceForeground(hwnd);
                }
            }
            else if (!seen && !lost && elapsed > 1.5 && System.Diagnostics.Process.GetProcessesByName("KanePlay").Length == 0)
            {
                // Le lancement s'est perdu : on le signale une fois à l'interface, qui relance
                lost = true;
                Log.Write($"« {title} » ne s’est pas ouvert : nouvelle tentative");
                Post(new { type = "foreground-lost", window = title });
            }
            if (elapsed > 15) StopForegroundWatch();
        };
        _watch.Start();
    }

    // ---------- Fermeture de KanePlay : KaneMode se recharge ----------
    private const string KanePlayTitle = "KaneMode · KanePlay";
    private System.Windows.Threading.DispatcherTimer? _kanePlayTimer;
    private bool _kanePlayOpen;

    /// <summary>
    /// Après une session KanePlay, la manette ne répondait plus dans KaneMode tant qu'on ne passait pas
    /// par la vue des tâches (2.0.0 n'a pas suffi). Désormais, dès que KanePlay est fermé (bouton
    /// « KaneMode » / B, fin de session, plantage), KaneMode reprend le premier plan et recharge
    /// entièrement son interface, sans le logo de démarrage.
    /// </summary>
    private void WatchKanePlay()
    {
        if (_kanePlayTimer != null) return; // démarrage relancé après une erreur
        _kanePlayTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _kanePlayTimer.Tick += (_, _) =>
        {
            if (!_ready) return;
            if (Native.FindVisibleWindow(KanePlayTitle) != IntPtr.Zero) { _kanePlayOpen = true; return; }
            if (!_kanePlayOpen || System.Diagnostics.Process.GetProcessesByName("KanePlay").Length > 0) return;
            _kanePlayOpen = false;
            ReloadAfterKanePlay();
        };
        _kanePlayTimer.Start();
    }

    /// <summary>
    /// KanePlay fermé. La recharge de l'interface (2.1.0) puis la relance complète de KaneMode (2.2.0)
    /// n'ont pas suffi, la relance a même fait pire. Désormais : KaneMode reprend le premier plan, puis
    /// déconnecte et reconnecte ses manettes (HID rouvertes, XInput réinterrogé, état de l'interface
    /// remis à zéro). Les manettes HID ne dépendent pas de WebView2 ni du premier plan.
    /// </summary>
    private async void ReloadAfterKanePlay()
    {
        Log.Write("KanePlay fermé : KaneMode reprend la main et reconnecte les manettes");
        _returnTo = IntPtr.Zero;
        StopForegroundWatch();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Maximized;
        Show();
        Native.ForceForeground(Hwnd);
        Web.Focus();
        await Task.Delay(400); // KanePlay a fini de lâcher la manette
        ReconnectPads();
    }

    private void ReconnectPads()
    {
        _pads.Reconnect();
        Post(new { type = "pads-reset" });
    }

    private void StopForegroundWatch()
    {
        _watch?.Stop();
        _watch = null;
    }

    // ---------- Boutons de la console (ROG Ally) ----------
    private void OnDeviceButton(string button)
    {
        string action = _buttonActions.TryGetValue(button, out var a) ? a : "none";
        Log.Write($"Bouton {button} : {action}");
        if (action == "none" || !_ready) return;
        if (_blockAsusPrompt) _ = CloseAsusPromptAsync();
        IntPtr front = Native.GetForegroundWindow();
        bool ours = front == Hwnd;
        switch (action)
        {
            case "gamebar":
                Native.SendKeys(Native.VK_LWIN, 0x47 /* G */);
                break;
            case "taskview":
                Native.SendKeys(Native.VK_LWIN, Native.VK_TAB);
                break;
            case "screenshot":
                // Capture de la Game Bar (dossier Vidéos\Captures)
                Native.SendKeys(Native.VK_LWIN, Native.VK_MENU, Native.VK_SNAPSHOT);
                break;
            case "qam":
            case "menu":
                if (ours) Post(new { type = "toggle", panel = action });
                else OpenOverlay(action, front);
                break;
            case "home":
                _returnTo = IntPtr.Zero;
                StopForegroundWatch();
                DropLaunchCover();
                StopInsisting();
                if (WindowState == WindowState.Minimized) WindowState = WindowState.Maximized;
                Show();
                Native.ForceForeground(Hwnd);
                Web.Focus();
                Post(new { type = "home" });
                break;
        }
    }

    /// <summary>
    /// Sans Armoury Crate SE, les services ASUS proposent de l'installer à chaque appui sur ces
    /// boutons. Pendant quelques secondes, les fenêtres qui apparaissent sont notées dans le journal ;
    /// celles d'Armoury Crate (et le Microsoft Store ouvert sur sa page) sont refermées.
    /// </summary>
    private async Task CloseAsusPromptAsync()
    {
        var before = new HashSet<IntPtr>(Native.VisibleWindows());
        uint self = (uint)Environment.ProcessId;
        for (int i = 0; i < 30; i++)
        {
            await Task.Delay(150);
            foreach (IntPtr w in Native.VisibleWindows())
            {
                if (!before.Add(w)) continue;
                uint pid = Native.WindowProcessId(w);
                if (pid == self) continue;
                string title = Native.WindowTitle(w), process = "";
                try { process = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch (Exception ex) when (ex is ArgumentException or InvalidOperationException) { }
                bool asus = System.Text.RegularExpressions.Regex.IsMatch(title + " " + process, "armou?ry|asus|rog live", System.Text.RegularExpressions.RegexOptions.IgnoreCase)
                    || process.Equals("WinStore.App", StringComparison.OrdinalIgnoreCase);
                Log.Write($"Fenêtre apparue après le bouton : « {title} » ({process}){(asus ? " : fermée" : "")}");
                if (asus) Native.PostMessage(w, 0x0010 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero);
            }
        }
    }

    /// <summary>
    /// Nouvelle résolution : la fenêtre plein écran reprend toute la taille de l'écran (WPF laisse une
    /// fenêtre sans bordure agrandie à son ancienne taille, l'interface débordait ou ne remplissait plus
    /// l'écran). Sans l'activer : un jeu au premier plan y reste. Refait un peu plus tard, le temps que
    /// Windows applique aussi la mise à l'échelle.
    /// </summary>
    private void OnDisplayChanged(object? sender, EventArgs e)
    {
        if (Args.Contains("--windowed")) return;
        Dispatcher.BeginInvoke(async () =>
        {
            foreach (int delay in new[] { 200, 1200, 3000 })
            {
                await Task.Delay(delay);
                if (WindowState == WindowState.Minimized) continue;
                var hwnd = new WindowInteropHelper(this).Handle;
                if (Native.FillMonitor(hwnd)) Log.Write("Affichage modifié : fenêtre remise à la taille de l'écran");
            }
        });
    }

    private void OnPowerModeChanged(object? sender, PowerModeChangedEventArgs e)
    {
        if (e.Mode == PowerModes.StatusChange) return;
        Log.Write(e.Mode == PowerModes.Suspend ? "Mise en veille du système" : "Réveil du système");
        if (e.Mode == PowerModes.Resume) _buttons.Reopen();
        // L'événement arrive sur un autre fil : on repasse sur celui de la fenêtre.
        Dispatcher.BeginInvoke(() => Post(new { type = e.Mode == PowerModes.Suspend ? "suspend" : "wake" }));
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e) => HandleMessage(e.WebMessageAsJson, fromWidget: false);

    // Ce que le widget Game Bar peut demander à l'app (le reste est réservé à l'interface de KaneMode)
    private static readonly HashSet<string> WidgetMessages = new() { "power", "show", "game-stop", "widget-state", "lossless", "gamebar-close", "mouse-mode" };

    /// <summary>
    /// Message de l'interface (WebView2) ou du widget Game Bar. Renvoie la réponse JSON pour le
    /// widget quand il en attend une (état du jeu en cours), sinon null.
    /// </summary>
    private string? HandleMessage(string json, bool fromWidget)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            string type = root.GetProperty("type").GetString() ?? "";
            if (fromWidget && !WidgetMessages.Contains(type)) { Log.Write($"Widget : message refusé ({type})"); return null; }
            if (fromWidget && type != "widget-state") Log.Write($"Widget : {type}"); // l'état est demandé toutes les 3 s
            switch (type)
            {
                case "widget-state":
                    // Jeu en cours, pour la section « Jeu » du widget
                    var g = _game;
                    return JsonSerializer.Serialize(new { game = g != null && g.Seen ? new { id = g.Id, name = g.Name ?? Native.WindowTitle(g.Window), dir = g.Dir, steamAppId = g.SteamAppId } : null, mouse = _pads.MouseMode });
                case "lossless":
                    // Widget : mise à l'échelle de Lossless Scaling, par son raccourci global (Ctrl + Alt + S par défaut)
                    Native.SendKeys(0x11 /* Ctrl */, Native.VK_MENU, 0x53 /* S */);
                    break;
                case "gamebar-close":
                    // Widget : B (rond) ferme la Game Bar, par son raccourci (Windows + G)
                    Native.SendKeys(Native.VK_LWIN, 0x47 /* G */);
                    break;
                case "show":
                    // Widget : « Ouvrir KaneMode » (accueil, ou une page)
                    _returnTo = IntPtr.Zero;
                    StopForegroundWatch();
                    DropLaunchCover();
                    StopInsisting();
                    if (WindowState == WindowState.Minimized) WindowState = WindowState.Maximized;
                    Show();
                    Native.ForceForeground(Hwnd);
                    Web.Focus();
                    Post(new { type = "home", page = Text(root, "page") });
                    break;
                case "exit":
                    ExitToDesktop();
                    break;
                case "power":
                    string action = root.TryGetProperty("action", out var a) ? a.GetString() ?? "" : "";
                    if (action == "desktop") ExitToDesktop();
                    else if (!Native.Power(action, new WindowInteropHelper(this).Handle)) Log.Write($"Action inconnue : {action}");
                    break;
                case "return":
                    // Menu ou accès rapide refermé : retour à la fenêtre d'où l'on venait
                    if (_returnTo != IntPtr.Zero) { Native.Activate(_returnTo); _returnTo = IntPtr.Zero; }
                    break;
                case "foreground":
                    string? title = root.TryGetProperty("window", out var w) ? w.GetString() : null;
                    _pads.StopMouseMode(); // KanePlay prend la manette
                    Native.GiveForeground(title);
                    if (!string.IsNullOrEmpty(title)) WatchForeground(title);
                    break;
                case "launch":
                    // Jeu lancé : écran de lancement par-dessus tout, puis retour ici à sa fermeture.
                    // La manette est au jeu : fin du mode souris.
                    _pads.StopMouseMode();
                    StartGameWatch(Text(root, "id") ?? "", SteamApp(root), Text(root, "dir"), Flag(root, "cover"), name: Text(root, "name"));
                    break;
                case "launch-cancel":
                    DropLaunchCover();
                    break;
                case "game-query":
                    QueryGame(Text(root, "id") ?? "", SteamApp(root), Text(root, "dir"));
                    break;
                case "game-front":
                    // « Reprendre » : le jeu en cours repasse devant
                    FrontGame(Text(root, "id") ?? "", Text(root, "dir"));
                    break;
                case "game-stop":
                    StopGame(Text(root, "id") ?? "", Text(root, "dir"), Flag(root, "force"));
                    break;
                case "buttons":
                    // Actions des boutons de la console, envoyées par l'interface au démarrage et à chaque changement
                    foreach (string key in new[] { "cc", "ac", "ac-hold" })
                        if (root.TryGetProperty(key, out var v) && v.GetString() is string act) _buttonActions[key] = act;
                    if (root.TryGetProperty("blockPrompt", out var bp)) _blockAsusPrompt = bp.ValueKind == JsonValueKind.True;
                    break;
                case "stay":
                    _returnTo = IntPtr.Zero; // l'utilisateur est allé ailleurs dans KaneMode
                    break;
                case "log":
                    // Diagnostic de l'interface (ex. source de la manette), dans kanemode.log
                    string line = Text(root, "text") ?? "";
                    if (line.Length > 0) Log.Write("[interface] " + (line.Length > 300 ? line[..300] : line));
                    break;
                case "hello":
                    Post(new { type = "native", version = typeof(App).Assembly.GetName().Version?.ToString(3), data = Paths.Data });
                    if (_pads.MouseMode) Post(new { type = "mouse-mode", on = true });
                    break;
                case "pads-reconnect":
                    // Accès rapide : « Reconnecter les manettes »
                    Log.Write("Manettes : reconnexion demandée");
                    ReconnectPads();
                    break;
                case "mouse-pad":
                {
                    // Manette vue par l'interface pendant le mode souris (mode Xbox : XInput muet)
                    var r = root;
                    double D(string k) => r.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;
                    _pads.SetUiPad((ushort)D("b"), D("lx"), D("ly"), D("rx"), D("ry"));
                    break;
                }
                case "mouse-mode":
                    // Interface (Start maintenu vu par WebView2, quand l'app ne l'a pas vu elle-même) ou
                    // widget Game Bar (interrupteur « Mode souris »)
                    bool on = Flag(root, "on");
                    if (!fromWidget && on && Environment.TickCount64 - _pads.LastToggle < 2500) return null; // déjà basculé par l'app
                    _pads.SetMouseMode(on, fromWidget ? "widget Game Bar" : $"interface, manette : {_lastPadFocus}");
                    return JsonSerializer.Serialize(new { on = _pads.MouseMode });
            }
        }
        catch (Exception ex)
        {
            Log.Write("Message de l'interface invalide : " + ex.Message);
        }
        return null;
    }

    private static string? Text(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    private static bool Flag(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;
    private static int SteamApp(JsonElement o) =>
        o.TryGetProperty("steamAppId", out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out int n) ? n : 0;

    private void Post(object message)
    {
        if (Web.CoreWebView2 == null) return;
        Web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message));
    }

    private bool _leaving;

    /// <summary>
    /// « Bureau Windows » (2.1.0) : KaneMode ne se ferme plus. En mode Xbox, on en sort seulement
    /// (Windows + F11, le raccourci de Windows ; Windows peut demander confirmation) et KaneMode reste
    /// ouvert tel quel sur le bureau. Déjà sur le bureau : KaneMode se réduit pour le laisser voir.
    /// </summary>
    private async void ExitToDesktop(bool quit = false)
    {
        if (_leaving) return;
        _leaving = true;
        try
        {
            Native.EnsureDesktop();
            if (Native.FullScreenExperienceActive)
            {
                Log.Write("Bureau Windows : sortie du mode Xbox, KaneMode reste ouvert");
                Native.ForceForeground(Hwnd);
                Native.SendKeys(Native.VK_LWIN, Native.VK_F11);
                var deadline = DateTime.UtcNow.AddSeconds(30);
                while (Native.FullScreenExperienceActive && DateTime.UtcNow < deadline) await Task.Delay(250);
                if (Native.FullScreenExperienceActive)
                {
                    Log.Write("Le mode Xbox est resté actif");
                    Post(new { type = "desktop-failed" });
                    return;
                }
                if (quit) Close();
                return;
            }
            if (quit) { Close(); return; }
            Log.Write("Bureau Windows : KaneMode réduit, toujours ouvert");
            WindowState = WindowState.Minimized;
        }
        finally { _leaving = false; }
    }

    /// <summary>Écran d'erreur : Échap quitte, Entrée réessaie (clavier ou manette via Steam Input / pilotes).</summary>
    private async void OnKeyDown(object sender, KeyEventArgs e)
    {
        if (!_failed) return;
        if (e.Key == Key.Escape) { e.Handled = true; ExitToDesktop(quit: true); } // démarrage raté : on quitte vraiment
        else if (e.Key == Key.Enter)
        {
            e.Handled = true;
            _host.Dispose();
            _host = new HostProcess();
            await StartAsync();
        }
    }
}
