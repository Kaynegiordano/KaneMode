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
        SourceInitialized += (_, _) => HwndSource.FromHwnd(new WindowInteropHelper(this).Handle)?.AddHook(WndProc);
        Activated += (_, _) => OnActivated();
        Closed += (_, _) => { SystemEvents.PowerModeChanged -= OnPowerModeChanged; _host.Dispose(); };
        // Veille et réveil du système, quelle qu'en soit la cause (menu, bouton d'alimentation, capot…)
        SystemEvents.PowerModeChanged += OnPowerModeChanged;
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
            WidgetBridge.Start(_host.Url);
            Web.CoreWebView2!.Navigate($"{_host.Url}/?native=1");
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
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Maximized;
        Show();
        Activate();
        Web.Focus();
        Post(new { type = "open", panel });
    }

    private void OnPowerModeChanged(object? sender, PowerModeChangedEventArgs e)
    {
        if (e.Mode == PowerModes.StatusChange) return;
        Log.Write(e.Mode == PowerModes.Suspend ? "Mise en veille du système" : "Réveil du système");
        // L'événement arrive sur un autre fil : on repasse sur celui de la fenêtre.
        Dispatcher.BeginInvoke(() => Post(new { type = e.Mode == PowerModes.Suspend ? "suspend" : "wake" }));
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            string type = root.GetProperty("type").GetString() ?? "";
            switch (type)
            {
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
                    Native.GiveForeground(root.TryGetProperty("window", out var w) ? w.GetString() : null);
                    break;
                case "stay":
                    _returnTo = IntPtr.Zero; // l'utilisateur est allé ailleurs dans KaneMode
                    break;
                case "hello":
                    Post(new { type = "native", version = typeof(App).Assembly.GetName().Version?.ToString(3), data = Paths.Data });
                    break;
            }
        }
        catch (Exception ex)
        {
            Log.Write("Message de l'interface invalide : " + ex.Message);
        }
    }

    private void Post(object message)
    {
        if (Web.CoreWebView2 == null) return;
        Web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message));
    }

    private void ExitToDesktop()
    {
        Log.Write("Retour au bureau");
        Native.EnsureDesktop();
        Close();
    }

    /// <summary>Écran d'erreur : Échap quitte, Entrée réessaie (clavier ou manette via Steam Input / pilotes).</summary>
    private async void OnKeyDown(object sender, KeyEventArgs e)
    {
        if (!_failed) return;
        if (e.Key == Key.Escape) { e.Handled = true; ExitToDesktop(); }
        else if (e.Key == Key.Enter)
        {
            e.Handled = true;
            _host.Dispose();
            _host = new HostProcess();
            await StartAsync();
        }
    }
}
