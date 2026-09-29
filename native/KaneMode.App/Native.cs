using System.Diagnostics;
using System.Runtime.InteropServices;

namespace KaneMode;

/// <summary>Appels Windows : premier plan, veille, arrêt, bureau, objet « job » pour l'hôte.</summary>
public static class Native
{
    // ---------- Fenêtres ----------
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindow(string? className, string windowName);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int cmd);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    /// <summary>Redonne le premier plan à une fenêtre (celle d'où l'on vient : KanePlay, un jeu…).</summary>
    public static bool Activate(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return false;
        if (IsIconic(hwnd)) ShowWindow(hwnd, 9); // SW_RESTORE
        return SetForegroundWindow(hwnd);
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct CopyData { public IntPtr Kind; public int Size; public IntPtr Data; }
    public const int WM_COPYDATA = 0x004A;

    [DllImport("user32.dll")]
    private static extern bool AllowSetForegroundWindow(int processId);

    /// <summary>
    /// KaneMode (au premier plan) autorise le programme qu'il lance à prendre le premier plan, et
    /// ramène lui-même la fenêtre `title` si elle existe déjà (KanePlay en arrière-plan).
    /// </summary>
    public static void GiveForeground(string? title)
    {
        AllowSetForegroundWindow(-1); // ASFW_ANY
        if (string.IsNullOrEmpty(title)) return;
        IntPtr hwnd = FindWindow(null, title);
        if (hwnd == IntPtr.Zero) return;
        ShowWindow(hwnd, IsIconic(hwnd) ? 9 : 5); // SW_RESTORE ou SW_SHOW (fenêtre masquée)
        SetForegroundWindow(hwnd);
    }

    public static void BringToFront(string title)
    {
        IntPtr hwnd = FindWindow(null, title);
        if (hwnd == IntPtr.Zero) return;
        ShowWindow(hwnd, 9); // SW_RESTORE
        SetForegroundWindow(hwnd);
    }

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int max);
    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr param);
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc proc, IntPtr param);

    public static string WindowTitle(IntPtr hwnd)
    {
        var sb = new System.Text.StringBuilder(256);
        GetWindowText(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }

    public static uint WindowProcessId(IntPtr hwnd)
    {
        GetWindowThreadProcessId(hwnd, out uint pid);
        return pid;
    }

    /// <summary>Fenêtres principales visibles (sans propriétaire), de haut en bas.</summary>
    public static List<IntPtr> VisibleWindows()
    {
        var list = new List<IntPtr>();
        EnumWindows((h, _) =>
        {
            if (IsWindowVisible(h) && GetWindow(h, 4 /* GW_OWNER */) == IntPtr.Zero) list.Add(h);
            return true;
        }, IntPtr.Zero);
        return list;
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    /// <summary>
    /// Fenêtre d'application qu'on voit vraiment : visible, pas masquée par le compositeur (applis
    /// UWP suspendues), pas une palette d'outils.
    /// </summary>
    public static bool IsAppWindow(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd) || !IsWindowVisible(hwnd)) return false;
        if (DwmGetWindowAttribute(hwnd, 14 /* DWMWA_CLOAKED */, out int cloaked, sizeof(int)) == 0 && cloaked != 0) return false;
        return ((long)GetWindowLongPtr(hwnd, -20 /* GWL_EXSTYLE */) & 0x80 /* WS_EX_TOOLWINDOW */) == 0;
    }

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

    /// <summary>
    /// Place `hwnd` juste sous `above` dans l'ordre d'affichage, sans l'activer. Retirer « toujours
    /// au-dessus » remet une fenêtre en tête des fenêtres normales, donc devant le jeu.
    /// </summary>
    public static void PlaceBelow(IntPtr hwnd, IntPtr above)
    {
        const uint NOSIZE = 0x1, NOMOVE = 0x2, NOACTIVATE = 0x10, NOOWNERZORDER = 0x200;
        SetWindowPos(hwnd, above, 0, 0, 0, 0, NOSIZE | NOMOVE | NOACTIVATE | NOOWNERZORDER);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO { public int Size; public RECT Monitor, Work; public uint Flags; }
    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

    /// <summary>
    /// Étend la fenêtre à tout son écran, à sa taille actuelle, sans l'activer ni changer son rang :
    /// après un changement de résolution, une fenêtre sans bordure agrandie garde sinon l'ancienne taille.
    /// Renvoie vrai si la taille a changé.
    /// </summary>
    public static bool FillMonitor(IntPtr hwnd)
    {
        const uint NOZORDER = 0x4, NOACTIVATE = 0x10, NOOWNERZORDER = 0x200;
        var info = new MONITORINFO { Size = Marshal.SizeOf<MONITORINFO>() };
        if (!GetMonitorInfo(MonitorFromWindow(hwnd, 2 /* MONITOR_DEFAULTTONEAREST */), ref info)) return false;
        var m = info.Monitor;
        if (GetWindowRect(hwnd, out RECT r) && r.Left == m.Left && r.Top == m.Top && r.Right == m.Right && r.Bottom == m.Bottom) return false;
        return SetWindowPos(hwnd, IntPtr.Zero, m.Left, m.Top, m.Right - m.Left, m.Bottom - m.Top, NOZORDER | NOACTIVATE | NOOWNERZORDER);
    }

    /// <summary>Réduit une fenêtre sans activer celle qui se trouve derrière (on choisit nous-mêmes laquelle passe devant).</summary>
    public static void Minimize(IntPtr hwnd) => ShowWindow(hwnd, 7 /* SW_SHOWMINNOACTIVE */);

    /// <summary>Met la fenêtre au premier plan et en tête de l'affichage, même si elle a déjà le focus.</summary>
    public static bool Raise(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return false;
        bool ok = ForceForeground(hwnd);
        BringWindowToTop(hwnd);
        return ok;
    }

    public static (int Width, int Height) WindowSize(IntPtr hwnd) =>
        GetWindowRect(hwnd, out var r) ? (r.Right - r.Left, r.Bottom - r.Top) : (0, 0);

    /// <summary>Surface de l'écran principal, en pixels.</summary>
    public static long ScreenArea => (long)GetSystemMetrics(0 /* SM_CXSCREEN */) * GetSystemMetrics(1 /* SM_CYSCREEN */);

    public static string ProcessName(uint pid)
    {
        try { using var p = Process.GetProcessById((int)pid); return p.ProcessName; }
        catch (Exception e) when (e is ArgumentException or InvalidOperationException) { return ""; }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageName(IntPtr process, int flags, System.Text.StringBuilder name, ref int size);

    /// <summary>Chemin de l'exécutable d'un processus (droit limité : marche aussi pour un jeu lancé en administrateur).</summary>
    public static string? ProcessPath(uint pid)
    {
        IntPtr h = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
        if (h == IntPtr.Zero) return null;
        try
        {
            var sb = new System.Text.StringBuilder(1024);
            int size = sb.Capacity;
            return QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString() : null;
        }
        finally { CloseHandle(h); }
    }

    /// <summary>Processus dont l'exécutable est dans ce dossier (ou un sous-dossier). `dir` finit par « \ ».</summary>
    public static List<uint> ProcessesIn(string dir)
    {
        var list = new List<uint>();
        uint self = (uint)Environment.ProcessId;
        foreach (var p in Process.GetProcesses())
        {
            using (p)
            {
                uint pid = (uint)p.Id;
                if (pid == self || pid <= 4) continue;
                string? path = ProcessPath(pid);
                if (path != null && path.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) list.Add(pid);
            }
        }
        return list;
    }

    public static bool ProcessRunning(uint pid)
    {
        try
        {
            using var p = Process.GetProcessById((int)pid);
            try { return !p.HasExited; }
            catch (System.ComponentModel.Win32Exception) { return true; } // processus protégé (anti-triche) : il existe
        }
        catch (Exception e) when (e is ArgumentException or InvalidOperationException) { return false; }
    }

    /// <summary>
    /// Fenêtre visible portant exactement ce titre. FindWindow peut renvoyer la fenêtre masquée
    /// d'un programme en train de se fermer (KanePlay qui vient de rendre la main).
    /// </summary>
    public static IntPtr FindVisibleWindow(string title) =>
        VisibleWindows().FirstOrDefault(h => WindowTitle(h) == title);

    /// <summary>
    /// Met une fenêtre au premier plan, même quand Windows le refuse à un programme en arrière-plan
    /// (bouton de la console pressé pendant un jeu) : on se rattache un instant à la file d'entrée
    /// de la fenêtre qui a le premier plan, ce qui lève le verrou.
    /// </summary>
    public static bool ForceForeground(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return false;
        ShowWindow(hwnd, IsIconic(hwnd) ? 9 : 5); // SW_RESTORE ou SW_SHOW
        if (SetForegroundWindow(hwnd) && GetForegroundWindow() == hwnd) return true;
        IntPtr current = GetForegroundWindow();
        uint theirs = current == IntPtr.Zero ? 0 : GetWindowThreadProcessId(current, out _);
        uint ours = GetCurrentThreadId();
        bool attached = theirs != 0 && theirs != ours && AttachThreadInput(ours, theirs, true);
        try
        {
            BringWindowToTop(hwnd);
            SetForegroundWindow(hwnd);
        }
        finally
        {
            if (attached) AttachThreadInput(ours, theirs, false);
        }
        if (GetForegroundWindow() == hwnd) return true;
        // Dernier recours : un appui simulé sur Alt compte comme une action de l'utilisateur
        SendKeys(0x12 /* VK_MENU */);
        SetForegroundWindow(hwnd);
        return GetForegroundWindow() == hwnd;
    }

    // ---------- Clavier simulé (raccourcis de Windows : Game Bar, mode Xbox…) ----------
    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT { public ushort Vk; public ushort Scan; public uint Flags; public uint Time; public IntPtr Extra; }
    // INPUT : type puis l'union (la plus grande, MOUSEINPUT, fait 32 octets en 64 bits)
    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT { public int Dx; public int Dy; public int Data; public uint Flags; public uint Time; public IntPtr Extra; }
    [StructLayout(LayoutKind.Explicit, Size = 40)]
    private struct INPUT { [FieldOffset(0)] public uint Type; [FieldOffset(8)] public KEYBDINPUT Key; [FieldOffset(8)] public MOUSEINPUT Mouse; }
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, INPUT[] inputs, int size);

    /// <summary>Appuie sur les touches dans l'ordre puis les relâche dans l'ordre inverse (ex. Windows + G).</summary>
    public static bool SendKeys(params ushort[] keys)
    {
        const uint KEYUP = 0x0002, EXTENDED = 0x0001;
        var inputs = new List<INPUT>();
        foreach (ushort k in keys) inputs.Add(Key(k, k == 0x5B ? EXTENDED : 0));
        foreach (ushort k in Enumerable.Reverse(keys)) inputs.Add(Key(k, KEYUP | (k == 0x5B ? EXTENDED : 0)));
        uint sent = SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf<INPUT>());
        return sent == inputs.Count;

        static INPUT Key(ushort vk, uint flags) => new() { Type = 1 /* INPUT_KEYBOARD */, Key = new KEYBDINPUT { Vk = vk, Flags = flags } };
    }

    // ---------- Souris simulée (mode souris à la manette, voir XInputPads) ----------
    public const uint MOUSE_MOVE = 0x0001, LEFT_DOWN = 0x0002, LEFT_UP = 0x0004, RIGHT_DOWN = 0x0008, RIGHT_UP = 0x0010,
        MIDDLE_DOWN = 0x0020, MIDDLE_UP = 0x0040, X_DOWN = 0x0080, X_UP = 0x0100, WHEEL = 0x0800, HWHEEL = 0x1000;

    /// <summary>Évènement de souris : déplacement relatif, bouton (data = 1 ou 2 pour les boutons X) ou molette (data = ±120).</summary>
    public static void Mouse(uint flags, int dx = 0, int dy = 0, int data = 0)
    {
        var input = new INPUT { Type = 0 /* INPUT_MOUSE */, Mouse = new MOUSEINPUT { Dx = dx, Dy = dy, Data = data, Flags = flags } };
        SendInput(1, new[] { input }, Marshal.SizeOf<INPUT>());
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder name, int max);

    public static string WindowClass(IntPtr hwnd)
    {
        var sb = new System.Text.StringBuilder(128);
        GetClassName(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }

    public static bool IsMinimized(IntPtr hwnd) => IsIconic(hwnd);

    /// <summary>
    /// Premier plan « à personne » : aucune fenêtre, une fenêtre masquée ou invisible (KanePlay qui vient
    /// de se fermer), ou le bureau. KaneMode, affiché, peut alors reprendre la main sans rien voler.
    /// </summary>
    public static bool IsOrphanForeground(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd) || !IsWindowVisible(hwnd)) return true;
        if (DwmGetWindowAttribute(hwnd, 14 /* DWMWA_CLOAKED */, out int cloaked, sizeof(int)) == 0 && cloaked != 0) return true;
        string cls = WindowClass(hwnd);
        return cls == "Progman" || cls == "WorkerW";
    }

    public const ushort VK_LWIN = 0x5B, VK_F11 = 0x7A, VK_TAB = 0x09, VK_MENU = 0x12, VK_SNAPSHOT = 0x2C;

    // ---------- Mode Xbox (expérience plein écran) ----------
    [DllImport("api-ms-win-gaming-experience-l1-1-0.dll")]
    [return: MarshalAs(UnmanagedType.U1)]
    private static extern bool IsGamingFullScreenExperienceActive();

    /// <summary>
    /// Vrai si le mode Xbox (expérience plein écran de Windows 11) est actif. Dans ce mode,
    /// Windows relance l'application d'accueil dès qu'elle se ferme : il faut d'abord en sortir.
    /// </summary>
    public static bool FullScreenExperienceActive
    {
        get
        {
            try { return IsGamingFullScreenExperienceActive(); }
            catch (Exception e) when (e is DllNotFoundException or EntryPointNotFoundException) { return false; }
        }
    }

    // ---------- Alimentation ----------
    [DllImport("powrprof.dll", SetLastError = true)]
    private static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent);
    [DllImport("powrprof.dll")]
    private static extern bool GetPwrCapabilities(byte[] capabilities);
    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    /// <summary>
    /// Veille moderne (S0 Low Power Idle, champ AoAc de SYSTEM_POWER_CAPABILITIES) : la plupart des
    /// consoles portables. La veille classique (S3) n'y existe pas ; éteindre l'écran y endort le PC,
    /// comme un appui sur le bouton d'alimentation.
    /// </summary>
    public static bool ModernStandby
    {
        get
        {
            var caps = new byte[76];
            return GetPwrCapabilities(caps) && caps[20] != 0;
        }
    }

    private static void ScreenOff(IntPtr hwnd)
    {
        const uint WM_SYSCOMMAND = 0x0112;
        const int SC_MONITORPOWER = 0xF170;
        SendMessage(hwnd, WM_SYSCOMMAND, (IntPtr)SC_MONITORPOWER, (IntPtr)2);
    }

    /// <summary>Veille, redémarrage ou arrêt. Renvoie faux si l'action est inconnue.</summary>
    public static bool Power(string action, IntPtr hwnd = default)
    {
        Log.Write($"Alimentation : {action}");
        switch (action)
        {
            case "sleep":
                if (ModernStandby && hwnd != IntPtr.Zero)
                {
                    Log.Write("Veille moderne : extinction de l'écran");
                    ScreenOff(hwnd);
                }
                else if (!SetSuspendState(false, false, false))
                {
                    Log.Write($"Veille refusée (code {Marshal.GetLastWin32Error()}) : extinction de l'écran");
                    if (hwnd != IntPtr.Zero) ScreenOff(hwnd);
                }
                return true;
            case "restart":
                Process.Start(new ProcessStartInfo("shutdown.exe", "/r /t 0") { CreateNoWindow = true, UseShellExecute = false });
                return true;
            case "shutdown":
                Process.Start(new ProcessStartInfo("shutdown.exe", "/s /hybrid /t 0") { CreateNoWindow = true, UseShellExecute = false });
                return true;
            default:
                return false;
        }
    }

    /// <summary>
    /// S'assure que le bureau Windows est chargé : en mode Xbox, l'Explorateur (le bureau)
    /// peut ne pas tourner ; le relancer le réaffiche.
    /// </summary>
    public static void EnsureDesktop()
    {
        if (Process.GetProcessesByName("explorer").Length > 0) return;
        Log.Write("Bureau absent : démarrage de l'Explorateur");
        Process.Start(new ProcessStartInfo("explorer.exe") { UseShellExecute = true });
    }

    // ---------- Objet « job » : l'hôte Node s'arrête avec l'app ----------
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string? name);
    [DllImport("kernel32.dll")]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int length);
    [DllImport("kernel32.dll")]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS { public ulong a, b, c, d, e, f; }
    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    private const uint KillOnJobClose = 0x2000;
    // Les jeux lancés par l'hôte ne font pas partie du job : fermer KaneMode ne les ferme pas.
    private const uint SilentBreakawayOk = 0x1000;
    private static IntPtr _job;

    public static void TieToApp(Process process)
    {
        if (_job == IntPtr.Zero)
        {
            _job = CreateJobObject(IntPtr.Zero, null);
            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = KillOnJobClose | SilentBreakawayOk;
            SetInformationJobObject(_job, 9 /* JobObjectExtendedLimitInformation */, ref info, Marshal.SizeOf(info));
        }
        AssignProcessToJobObject(_job, process.Handle);
    }
}
