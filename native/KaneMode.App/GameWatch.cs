using System.Windows;
using System.Windows.Threading;
using Microsoft.Win32;

namespace KaneMode;

/// <summary>
/// Jeu lancé depuis KaneMode. Pendant le lancement, KaneMode reste au-dessus de tout avec son écran
/// de lancement (Steam qui démarre reste caché) jusqu'à ce que la fenêtre du jeu apparaisse. Il la
/// suit ensuite et revient au premier plan dès qu'elle se ferme : en mode Xbox, Windows le fait
/// parfois de lui-même, sur le bureau jamais.
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
        public int SteamAppId;
        public bool Cover;
        public DateTime Started = DateTime.UtcNow;
        public HashSet<IntPtr> Before = new();
        public IntPtr Window;
        public uint Pid;
        public string Process = "";
        public bool SteamSeen;
        public DateTime? Gone;
    }

    // Durée maximale de l'écran de lancement par-dessus tout : au-delà, Steam attend peut-être une réponse
    private const int CoverSeconds = 25;
    private GameState? _game;
    private DispatcherTimer? _gameTimer;

    private void StartGameWatch(string id, int steamAppId, bool cover)
    {
        StopGameWatch();
        var s = new GameState { Id = id, SteamAppId = steamAppId, Cover = cover, Before = new(Native.VisibleWindows()) };
        _game = s;
        if (cover) Topmost = true;
        Log.Write($"Lancement suivi : {id}{(cover ? " (écran de lancement par-dessus)" : "")}");
        _gameTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
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
        if (s.SteamAppId != 0 && SteamRunningApp() == s.SteamAppId) s.SteamSeen = true;

        // 1. Lancement : on attend la fenêtre du jeu
        if (s.Window == IntPtr.Zero)
        {
            IntPtr found = FindGameWindow(s);
            if (found != IntPtr.Zero)
            {
                Adopt(s, found);
                DropLaunchCover();
                Native.ForceForeground(found);
                Post(new { type = "game-started", id = s.Id });
                return;
            }
            if (s.Cover && elapsed > CoverSeconds)
            {
                // Rien n'a pris le premier plan : une petite fenêtre (lanceur, choix d'options de
                // Steam…) attend peut-être derrière l'écran de lancement. On la met devant.
                IntPtr late = FindGameWindow(s, anySize: true);
                DropLaunchCover();
                if (late != IntPtr.Zero)
                {
                    Adopt(s, late);
                    Native.ForceForeground(late);
                    Post(new { type = "game-started", id = s.Id });
                    return;
                }
                IntPtr store = NewStoreWindow(s);
                Log.Write($"Le jeu n’est pas apparu en {CoverSeconds} s : écran de lancement retiré" + (store != IntPtr.Zero ? $", « {Native.WindowTitle(store)} » mise devant" : ""));
                if (store != IntPtr.Zero) Native.ForceForeground(store);
                Post(new { type = "launch-timeout", id = s.Id });
            }
            if (elapsed > (s.SteamSeen ? 600 : 180))
            {
                Log.Write("Fenêtre du jeu introuvable : suivi abandonné");
                StopGameWatch();
            }
            return;
        }

        // 2. Jeu en cours
        if (GameAlive(s)) { s.Gone = null; return; }
        // Fenêtre fermée : un lanceur qui passe la main au jeu, un jeu qui recrée sa fenêtre… ou la fin
        IntPtr next = FindGameWindow(s);
        if (next != IntPtr.Zero) { Adopt(s, next); return; }
        s.Gone ??= DateTime.UtcNow;
        if (s.SteamSeen && SteamRunningApp() == s.SteamAppId) return; // Steam le dit encore lancé
        double grace = Native.ProcessRunning(s.Pid) ? 20 : 4;
        if ((DateTime.UtcNow - s.Gone.Value).TotalSeconds < grace) return;
        Log.Write($"Jeu fermé ({s.Process}) : retour à KaneMode");
        string id = s.Id;
        StopGameWatch();
        ReturnFromGame(id);
    }

    private void Adopt(GameState s, IntPtr hwnd)
    {
        s.Window = hwnd;
        s.Pid = Native.WindowProcessId(hwnd);
        s.Process = Native.ProcessName(s.Pid);
        s.Gone = null;
        Log.Write($"Fenêtre du jeu : « {Native.WindowTitle(hwnd)} » ({s.Process})");
        if (_gameTimer != null) _gameTimer.Interval = TimeSpan.FromSeconds(1);
    }

    private bool GameAlive(GameState s)
    {
        if (Native.IsAppWindow(s.Window)) return true;
        // ApplicationFrameHost porte les fenêtres de toutes les applis UWP : seule la sienne compte
        if (s.Process.Equals("ApplicationFrameHost", StringComparison.OrdinalIgnoreCase)) return false;
        foreach (IntPtr h in Native.VisibleWindows())
            if (Native.WindowProcessId(h) == s.Pid && Native.IsAppWindow(h)) { s.Window = h; return true; }
        return false;
    }

    /// <summary>
    /// Nouvelle fenêtre (absente au lancement) d'un programme qui n'est ni une boutique ni Windows :
    /// celle qui a le premier plan, ou une grande fenêtre qui n'a pas réussi à le prendre.
    /// </summary>
    private IntPtr FindGameWindow(GameState s, bool anySize = false)
    {
        IntPtr fg = Native.GetForegroundWindow();
        if (IsGameWindow(s, fg, anySize: true)) return fg;
        foreach (IntPtr h in Native.VisibleWindows())
            if (IsGameWindow(s, h, anySize)) return h;
        return IntPtr.Zero;
    }

    /// <summary>Nouvelle fenêtre d'une boutique (Steam qui demande quelque chose), la plus haute d'abord.</summary>
    private IntPtr NewStoreWindow(GameState s)
    {
        foreach (IntPtr h in Native.VisibleWindows())
        {
            if (s.Before.Contains(h) || !Native.IsAppWindow(h)) continue;
            if (Stores.Contains(Native.ProcessName(Native.WindowProcessId(h)))) return h;
        }
        return IntPtr.Zero;
    }

    private bool IsGameWindow(GameState s, IntPtr h, bool anySize)
    {
        if (h == IntPtr.Zero || h == Hwnd || s.Before.Contains(h) || !Native.IsAppWindow(h)) return false;
        var (w, ht) = Native.WindowSize(h);
        if (w < 320 || ht < 240) return false;
        if (!anySize && (long)w * ht < Native.ScreenArea / 2) return false;
        uint pid = Native.WindowProcessId(h);
        if (pid == (uint)Environment.ProcessId) return false;
        string name = Native.ProcessName(pid);
        return name != "" && !Stores.Contains(name) && !Shell.Contains(name);
    }

    /// <summary>Le jeu est fermé : KaneMode revient devant, même si Steam remet sa fenêtre en avant.</summary>
    private void ReturnFromGame(string id)
    {
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Maximized;
        Show();
        Native.ForceForeground(Hwnd);
        Web.Focus();
        Post(new { type = "game-ended", id });
        var until = DateTime.UtcNow.AddSeconds(5);
        var t = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
        t.Tick += (_, _) =>
        {
            if (DateTime.UtcNow > until || _game != null) { t.Stop(); return; }
            IntPtr fg = Native.GetForegroundWindow();
            if (fg == Hwnd || fg == IntPtr.Zero) return;
            string name = Native.ProcessName(Native.WindowProcessId(fg));
            if (Stores.Contains(name) || name.Equals("explorer", StringComparison.OrdinalIgnoreCase))
            {
                Log.Write($"« {Native.WindowTitle(fg)} » ({name}) passe devant après le jeu : KaneMode reprend la main");
                Native.ForceForeground(Hwnd);
            }
        };
        t.Start();
    }

    /// <summary>Jeu Steam en cours (0 si aucun), tel que Steam le note dans le registre.</summary>
    private static int SteamRunningApp()
    {
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam");
            return k?.GetValue("RunningAppID") is int v ? v : 0;
        }
        catch (Exception e) when (e is System.Security.SecurityException or UnauthorizedAccessException or System.IO.IOException) { return 0; }
    }
}
