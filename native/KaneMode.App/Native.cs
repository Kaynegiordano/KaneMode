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
