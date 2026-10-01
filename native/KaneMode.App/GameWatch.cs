using System.IO;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Win32;

namespace KaneMode;

/// <summary>
/// Jeu lancé depuis KaneMode. Pendant le lancement, KaneMode reste au-dessus de tout avec son écran
/// de lancement (Steam qui démarre reste caché) jusqu'à ce que la fenêtre du jeu apparaisse. Chaque
/// nouvelle fenêtre du jeu est ensuite mise devant une fois (un programme de démarrage qui passe la
/// main au vrai jeu laisse sinon KaneMode devant). Quand le jeu se ferme, KaneMode revient au premier
/// plan : en mode Xbox, Windows le fait parfois de lui-même, sur le bureau jamais.
///
/// « Le jeu tourne » = un processus lancé depuis son dossier d'installation (fiable même quand un
/// lanceur relance le jeu sous un autre processus), ou Steam qui le dit en cours. Sans dossier connu,
/// on suit sa fenêtre.
/// </summary>
public partial class MainWindow
{
    // Boutiques et lanceurs : leurs fenêtres ne sont pas le jeu, et elles repassent souvent devant
    // quand il se ferme
    private static readonly HashSet<string> Stores = new(StringComparer.OrdinalIgnoreCase)
    {
        "steam", "steamwebhelper", "steamservice", "steamerrorreporter", "gameoverlayui", "gameoverlayui64",
        "EpicGamesLauncher", "EpicWebHelper", "GalaxyClient", "GalaxyClient Helper", "upc", "UplayWebCore",
        "EADesktop", "EABackgroundService", "Battle.net", "Amazon Games UI", "XboxPcApp", "XboxPcAppFT",
    };
    // Windows, la Game Bar, ASUS et KaneMode lui-même
    private static readonly HashSet<string> Shell = new(StringComparer.OrdinalIgnoreCase)
    {
        "explorer", "ShellExperienceHost", "StartMenuExperienceHost", "SearchHost", "SearchApp", "TextInputHost",
        "LockApp", "SystemSettings", "GameBar", "GameBarFTServer", "gamingservices", "ArmouryCrate",
        "ArmouryCrateSE", "ArmourySocketServer", "KaneMode", "KanePlay", "msedgewebview2", "node",
    };

    private sealed class GameState
    {
        public string Id = "";
        public string? Name; // nom affiché (widget Game Bar)
        public int SteamAppId;
        public string? Dir;
        public bool Cover;
        public DateTime Started = DateTime.UtcNow;
        public HashSet<IntPtr> Before = new();
        // Fenêtres du jeu déjà mises devant (une seule fois chacune : on peut revenir à KaneMode)
        public HashSet<IntPtr> Pushed = new();
        public IntPtr Window;
        public uint Pid;
        public string Process = "";
        public bool Seen;
        public bool Launched; // lancé depuis KaneMode (pas un jeu trouvé déjà en cours)
        public DateTime? Gone;
        public DateTime InsistUntil;
    }

    // Durée maximale de l'écran de lancement par-dessus tout : au-delà, Steam attend peut-être une réponse
    private const int CoverSeconds = 25;
    private GameState? _game;
    private DispatcherTimer? _gameTimer;

    /// <summary>
    /// Dossier d'installation utilisable pour reconnaître les processus du jeu : pas une racine de
    /// disque ni un dossier système qui contiendrait bien d'autres programmes.
    /// </summary>
    private static string? GameDir(string? dir)
    {
        if (string.IsNullOrWhiteSpace(dir) || !Path.IsPathFullyQualified(dir)) return null;
        string full;
        try { full = Path.GetFullPath(dir).TrimEnd('\\') + "\\"; }
        catch (Exception e) when (e is ArgumentException or NotSupportedException or PathTooLongException) { return null; }
        if (full.Count(c => c == '\\') < 3) return null; // « C:\Jeux\ » au moins deux niveaux : « C:\Jeux\Hades\ »
        var broad = new[]
        {
            Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.Windows,
            Environment.SpecialFolder.UserProfile, Environment.SpecialFolder.Desktop, Environment.SpecialFolder.LocalApplicationData,
            Environment.SpecialFolder.ApplicationData, Environment.SpecialFolder.MyDocuments,
        };
        foreach (var f in broad)
        {
            string p = Environment.GetFolderPath(f);
            if (p.Length > 0 && string.Equals(full, p.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase)) return null;
        }
        return full;
    }

    private void StartGameWatch(string id, int steamAppId, string? dir, bool cover, bool alreadyRunning = false, string? name = null)
    {
        StopGameWatch();
        var s = new GameState { Id = id, Name = name, SteamAppId = steamAppId, Dir = GameDir(dir), Cover = cover, Launched = !alreadyRunning, Before = new(Native.VisibleWindows()) };
        // Les applis Store peuvent afficher leur fenêtre avant le retour de ShellExecute.
        // Conserver le relevé effectué avant le lancement, pas seulement celui après la réponse.
        if (!alreadyRunning && _preparedLaunch is { } prepared && prepared.Id == id) s.Before = prepared.Before;
        _preparedLaunch = null;
        if (alreadyRunning)
        {
            // Jeu trouvé en cours (lancé avant, ou KaneMode relancé) : ses fenêtres actuelles restent où elles sont
            s.Seen = true;
            foreach (IntPtr h in GameWindows(s)) s.Pushed.Add(h);
        }
        _game = s;
        if (cover) Topmost = true;
        Log.Write($"{(alreadyRunning ? "Jeu en cours suivi" : "Lancement suivi")} : {id}{(steamAppId != 0 ? $", Steam {steamAppId}" : "")}{(s.Dir != null ? $", dossier {s.Dir}" : ", sans dossier")}{(cover ? " (écran de lancement par-dessus)" : "")}{(Native.FullScreenExperienceActive ? ", mode Xbox" : ", bureau")}");
        _lastForeground = IntPtr.Zero;
        _gameTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(alreadyRunning ? 1000 : 250) };
        _gameTimer.Tick += (_, _) => { if (_game == s) GameTick(s); };
        _gameTimer.Start();
    }

    private void StopGameWatch()
    {
        _gameTimer?.Stop();
        _gameTimer = null;
        _game = null;
        Topmost = false;
    }

    /// <summary>Retire l'écran de lancement (B, bouton de la console) sans cesser de suivre le jeu.</summary>
    private void DropLaunchCover()
    {
        if (_game == null || !_game.Cover) return;
        _game.Cover = false;
        Topmost = false;
    }

    private void GameTick(GameState s)
    {
        double elapsed = (DateTime.UtcNow - s.Started).TotalSeconds;
        // Jeu lancé depuis plus de 90 s : vérifié chaque seconde (le retour sur KaneMode à sa fermeture
        // reste rapide), moins de travail pris au jeu pendant toute la partie
        if (s.Seen && elapsed > 90 && _gameTimer != null && _gameTimer.Interval < TimeSpan.FromSeconds(1)) _gameTimer.Interval = TimeSpan.FromSeconds(1);
        bool running = IsRunning(s);
        LogForeground(s);

        // Nouvelle fenêtre du jeu : devant, une fois
        IntPtr win = NewGameWindow(s);
        if (win != IntPtr.Zero)
        {
            bool first = s.Window == IntPtr.Zero;
            Adopt(s, win);
            if (!_externalOpen.Active) ShowGame(s, win);
            else s.Pushed.Add(win);
            if (first) Post(new { type = "game-started", id = s.Id });
            running = true;
        }
        else if (!_externalOpen.Active && s.InsistUntil > DateTime.UtcNow && Native.GetForegroundWindow() == Hwnd && Native.IsAppWindow(s.Window))
        {
            // KaneMode a repris le focus juste après (fenêtre fermée devant lui, Windows qui refuse) : on insiste
            Log.Write($"KaneMode est repassé devant « {Native.WindowTitle(s.Window)} » : le jeu revient devant");
            Native.Raise(s.Window);
            Native.PlaceBelow(Hwnd, s.Window);
        }

        if (running)
        {
            if (!s.Seen) Post(new { type = "game-state", id = s.Id, running = true });
            s.Seen = true;
            s.Gone = null;
        }

        // Lancement : l'écran de lancement ne reste pas indéfiniment
        if (s.Cover && elapsed > CoverSeconds)
        {
            // Rien n'a pris le premier plan : une petite fenêtre (lanceur, choix d'options de
            // Steam…) attend peut-être derrière l'écran de lancement. On la met devant.
            IntPtr late = s.Dir == null ? FindNewWindow(s, anySize: true) : IntPtr.Zero;
            DropLaunchCover();
            if (late != IntPtr.Zero)
            {
                Adopt(s, late);
                ShowGame(s, late);
                Post(new { type = "game-started", id = s.Id });
                return;
            }
            IntPtr store = NewStoreDialog(s);
            Log.Write($"Le jeu n’est pas apparu en {CoverSeconds} s : écran de lancement retiré" + (store != IntPtr.Zero ? $", « {Native.WindowTitle(store)} » mise devant" : ""));
            if (store != IntPtr.Zero) Native.ForceForeground(store);
            Post(new { type = "launch-timeout", id = s.Id });
        }

        if (running) return;
        if (!s.Seen)
        {
            if (elapsed > 600)
            {
                Log.Write("Le jeu n’a pas démarré : suivi abandonné");
                StopGameWatch();
            }
            return;
        }

        // Plus rien ne tourne : KaneMode revient devant tout de suite (sans laisser Steam s'afficher),
        // puis quelques secondes de grâce avant de conclure (un lanceur qui relance le jeu : sa
        // nouvelle fenêtre repassera devant)
        if (s.Gone == null)
        {
            s.Gone = DateTime.UtcNow;
            s.InsistUntil = DateTime.MinValue;
            if (!_externalOpen.Active) BackToKaneMode();
        }
        double grace = s.Dir != null ? 3 : Native.ProcessRunning(s.Pid) ? 20 : 4;
        if ((DateTime.UtcNow - s.Gone.Value).TotalSeconds < grace) return;
        Log.Write($"Jeu fermé ({(s.Process != "" ? s.Process : s.Id)}) : retour à KaneMode");
        string id = s.Id;
        StopGameWatch();
        ReturnFromGame(id);
    }

    /// <summary>
    /// Met une fenêtre du jeu devant : KaneMode quitte « toujours au-dessus » (ce qui le remet en tête
    /// des fenêtres normales), le jeu passe au premier plan et KaneMode se range juste derrière.
    /// Pendant 4 s, si KaneMode reprend le focus, le jeu est remis devant.
    /// </summary>
    private void ShowGame(GameState s, IntPtr win)
    {
        s.Pushed.Add(win);
        DropLaunchCover();
        Log.Write($"« {Native.WindowTitle(win)} » mise au premier plan");
        Native.Raise(win);
        Native.PlaceBelow(Hwnd, win);
        s.InsistUntil = DateTime.UtcNow.AddSeconds(4);
    }

    /// <summary>
    /// Journal : chaque fenêtre qui prend le premier plan pendant le suivi (ce que fait Windows,
    /// Steam ou le mode Xbox entre le lancement et la fin du jeu).
    /// </summary>
    private IntPtr _lastForeground;
    private void LogForeground(GameState s)
    {
        IntPtr fg = Native.GetForegroundWindow();
        if (fg == _lastForeground) return;
        _lastForeground = fg;
        if (fg == IntPtr.Zero) { Log.Write("Premier plan : aucune fenêtre"); return; }
        Log.Write($"Premier plan : « {Native.WindowTitle(fg)} » ({(fg == Hwnd ? "KaneMode" : Native.ProcessName(Native.WindowProcessId(fg)))}{(IsLarge(fg) ? ", grande" : "")})");
    }

    /// <summary>L'utilisateur revient lui-même sur KaneMode (bouton, accès rapide) : on ne le renvoie pas au jeu.</summary>
    private void StopInsisting()
    {
        if (_game != null) _game.InsistUntil = DateTime.MinValue;
    }

    private bool IsRunning(GameState s)
    {
        if (s.Dir != null && Native.ProcessesIn(s.Dir).Count > 0) return true;
        if (s.SteamAppId != 0 && SteamRunning(s.SteamAppId)) return true;
        return s.Dir == null && s.Window != IntPtr.Zero && WindowAlive(s);
    }

    private void Adopt(GameState s, IntPtr hwnd)
    {
        if (s.Window == hwnd) return;
        s.Window = hwnd;
        s.Pid = Native.WindowProcessId(hwnd);
        s.Process = Native.ProcessName(s.Pid);
        s.Gone = null;
        Log.Write($"Fenêtre du jeu : « {Native.WindowTitle(hwnd)} » ({s.Process})");
        // Assez souvent pour revenir sur KaneMode dès la fermeture du jeu
        if (_gameTimer != null) _gameTimer.Interval = TimeSpan.FromMilliseconds(500);
    }

    /// <summary>Sans dossier connu : la fenêtre suivie, ou une autre du même processus, est encore là.</summary>
    private bool WindowAlive(GameState s)
    {
        if (Native.IsAppWindow(s.Window)) return true;
        // ApplicationFrameHost porte les fenêtres de toutes les applis UWP : seule la sienne compte
        if (s.Process.Equals("ApplicationFrameHost", StringComparison.OrdinalIgnoreCase)) return false;
        foreach (IntPtr h in Native.VisibleWindows())
            if (Native.WindowProcessId(h) == s.Pid && Native.IsAppWindow(h)) { s.Window = h; return true; }
        return false;
    }

    private static bool BigEnough(IntPtr h)
    {
        var (w, ht) = Native.WindowSize(h);
        return w >= 320 && ht >= 240;
    }

    /// <summary>Fenêtres visibles des processus du jeu (dossier connu), la plus grande d'abord.</summary>
    private List<IntPtr> GameWindows(GameState s)
    {
        if (s.Dir == null) return new();
        var pids = new HashSet<uint>(Native.ProcessesIn(s.Dir));
        if (pids.Count == 0) return new();
        return Native.VisibleWindows()
            .Where(h => pids.Contains(Native.WindowProcessId(h)) && Native.IsAppWindow(h) && BigEnough(h))
            .OrderByDescending(h => { var (w, ht) = Native.WindowSize(h); return (long)w * ht; })
            .ToList();
    }

    /// <summary>Fenêtre du jeu pas encore mise devant.</summary>
    private IntPtr NewGameWindow(GameState s)
    {
        if (s.Dir != null) return GameWindows(s).FirstOrDefault(h => !s.Pushed.Contains(h));
        IntPtr h = FindNewWindow(s);
        return s.Pushed.Contains(h) ? IntPtr.Zero : h;
    }

    /// <summary>
    /// Sans dossier connu : nouvelle fenêtre (absente au lancement) d'un programme qui n'est ni une
    /// boutique ni Windows, celle qui a le premier plan ou une grande fenêtre qui n'a pas pu le prendre.
    /// </summary>
    private IntPtr FindNewWindow(GameState s, bool anySize = false)
    {
        IntPtr fg = Native.GetForegroundWindow();
        if (IsNewWindow(s, fg, anySize: true)) return fg;
        foreach (IntPtr h in Native.VisibleWindows())
            if (IsNewWindow(s, h, anySize)) return h;
        return IntPtr.Zero;
    }

    private bool IsNewWindow(GameState s, IntPtr h, bool anySize)
    {
        if (h == IntPtr.Zero || h == Hwnd || s.Before.Contains(h) || !Native.IsAppWindow(h) || !BigEnough(h)) return false;
        var (w, ht) = Native.WindowSize(h);
        if (!anySize && (long)w * ht < Native.ScreenArea / 2) return false;
        uint pid = Native.WindowProcessId(h);
        if (pid == (uint)Environment.ProcessId) return false;
        string name = Native.ProcessName(pid);
        return name != "" && !Stores.Contains(name) && !Shell.Contains(name);
    }

    /// <summary>
    /// Nouvelle petite fenêtre d'une boutique : Steam qui demande quelque chose (options de lancement,
    /// synchronisation…). Sa grande fenêtre (bibliothèque, Big Picture) n'est jamais remise devant.
    /// </summary>
    private static IntPtr NewStoreDialog(GameState s)
    {
        foreach (IntPtr h in Native.VisibleWindows())
        {
            if (s.Before.Contains(h) || !Native.IsAppWindow(h) || IsLarge(h)) continue;
            if (Stores.Contains(Native.ProcessName(Native.WindowProcessId(h)))) return h;
        }
        return IntPtr.Zero;
    }

    private static bool IsLarge(IntPtr h)
    {
        var (w, ht) = Native.WindowSize(h);
        return (long)w * ht >= Native.ScreenArea / 2;
    }

    /// <summary>KaneMode revient devant quand le jeu est fermé.</summary>
    private void BackToKaneMode()
    {
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Maximized;
        Show();
        Native.Raise(Hwnd);
        Web.Focus();
    }

    /// <summary>
    /// Le jeu est fermé : retour sans surveillance répétée des boutiques après la session.
    /// </summary>
    private void ReturnFromGame(string id)
    {
        if (!_externalOpen.Active) BackToKaneMode();
        Post(new { type = "game-ended", id });
    }

    // ---------- Demandes de l'interface : état, reprise, arrêt ----------

    /// <summary>Le jeu tourne-t-il ? S'il tourne sans être suivi, on le suit (retour ici à sa fermeture).</summary>
    private void QueryGame(string id, int steamAppId, string? dir)
    {
        bool running;
        if (_game != null && _game.Id == id) running = _game.Seen || IsRunning(_game);
        else
        {
            string? d = GameDir(dir);
            running = (d != null && Native.ProcessesIn(d).Count > 0) || (steamAppId != 0 && SteamRunning(steamAppId));
            if (running && _game == null) StartGameWatch(id, steamAppId, dir, cover: false, alreadyRunning: true);
        }
        Post(new { type = "game-state", id, running });
    }

    /// <summary>Remet le jeu devant (« Reprendre »).</summary>
    private void FrontGame(string id, string? dir)
    {
        var s = _game != null && _game.Id == id ? _game : new GameState { Id = id, Dir = GameDir(dir) };
        IntPtr win = GameWindows(s).FirstOrDefault();
        if (win == IntPtr.Zero && s.Window != IntPtr.Zero && Native.IsAppWindow(s.Window)) win = s.Window;
        if (win == IntPtr.Zero)
        {
            Log.Write($"Reprendre {id} : aucune fenêtre du jeu");
            Post(new { type = "game-front-failed", id });
            return;
        }
        s.Pushed.Add(win);
        Native.Raise(win);
        Native.PlaceBelow(Hwnd, win);
    }

    /// <summary>
    /// Arrête le jeu : d'abord poliment (on demande à ses fenêtres de se fermer, le jeu peut
    /// sauvegarder ou demander confirmation), puis de force si l'interface le redemande.
    /// </summary>
    private void StopGame(string id, string? dir, bool force)
    {
        var pids = new HashSet<uint>();
        string? d = GameDir(dir);
        if (d != null) pids.UnionWith(Native.ProcessesIn(d));
        if (_game != null && _game.Id == id && _game.Pid != 0 && Native.ProcessRunning(_game.Pid)) pids.Add(_game.Pid);
        int done = 0, failed = 0;
        if (!force)
        {
            foreach (IntPtr h in Native.VisibleWindows())
                if (pids.Contains(Native.WindowProcessId(h)) && Native.IsAppWindow(h)) { Native.PostMessage(h, 0x0010 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero); done++; }
        }
        else
        {
            foreach (uint pid in pids)
            {
                try { using var p = System.Diagnostics.Process.GetProcessById((int)pid); p.Kill(entireProcessTree: true); done++; }
                catch (Exception e) when (e is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception or NotSupportedException)
                {
                    failed++;
                    Log.Write($"Arrêt forcé impossible (processus {pid}) : {e.Message}");
                }
            }
        }
        Log.Write($"{(force ? "Arrêt forcé" : "Fermeture demandée")} : {id}, {pids.Count} processus, {done} {(force ? "arrêtés" : "fenêtres")}{(failed > 0 ? $", {failed} refus" : "")}");
        Post(new { type = "game-stop", id, force, processes = pids.Count, done, failed });
    }

    /// <summary>Steam dit le jeu en cours (valeurs du registre de l'utilisateur).</summary>
    private static bool SteamRunning(int appId)
    {
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam");
            if (k == null) return false;
            if (k.GetValue("RunningAppID") is int v && v == appId) return true;
            using var a = k.OpenSubKey($@"Apps\{appId}");
            return a?.GetValue("Running") is int r && r != 0;
        }
        catch (Exception e) when (e is System.Security.SecurityException or UnauthorizedAccessException or System.IO.IOException) { return false; }
    }
}
