using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Interop;

namespace KaneMode;

/// <summary>
/// Manettes lues par Raw Input (WM_INPUT, mode « sink ») : c'est le système qui livre les rapports à une
/// fenêtre cachée de KaneMode, qu'elle ait le premier plan ou non. En expérience Xbox, XInput et la lecture
/// du périphérique par ReadFile ne donnent plus rien à KaneMode dès qu'une autre fenêtre a le focus
/// (journal d'une ROG Ally : sticks à 0/0, un rapport HID seulement au retour devant KaneMode).
/// Les rapports sont décodés comme ceux de la lecture directe (voir HidGamepads.Feed).
/// L'écoute n'est inscrite que pendant le mode souris (voir Enable) : une manette envoie des centaines de
/// rapports par seconde, qui passeraient tous par le fil de l'interface même sans mode souris.
/// </summary>
internal sealed class RawInputSink : IDisposable
{
    [StructLayout(LayoutKind.Sequential)]
    private struct RAWINPUTDEVICE { public ushort UsagePage, Usage; public uint Flags; public IntPtr Target; }
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterRawInputDevices([In] RAWINPUTDEVICE[] devices, uint count, uint size);
    [DllImport("user32.dll")]
    private static extern uint GetRawInputData(IntPtr raw, uint command, IntPtr data, ref uint size, uint headerSize);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetRawInputDeviceInfo(IntPtr device, uint command, StringBuilder? data, ref uint size);

    private const int WM_INPUT = 0x00FF;
    private const uint RID_INPUT = 0x10000003, RIDI_DEVICENAME = 0x20000007, RIM_TYPEHID = 2;
    private const uint RIDEV_REMOVE = 0x1, RIDEV_INPUTSINK = 0x100, RIDEV_DEVNOTIFY = 0x2000;
    // RAWINPUTHEADER : dwType, dwSize (4 octets chacun), hDevice, wParam (un pointeur chacun)
    private static readonly uint HeaderSize = (uint)(8 + 2 * IntPtr.Size);
    private const int BufferSize = 8192;

    private readonly HwndSource _window;
    private readonly IntPtr _handle;
    private readonly Action<string, byte[]> _report;
    // Périphérique → chemin, ou « » s'il ne nous intéresse pas (ni manette XInput ni DualShock) : décidé une fois
    private readonly Dictionary<IntPtr, string> _names = new();
    // Mémoire réutilisée pour chaque rapport : aucune allocation à 250 rapports par seconde et par manette
    private readonly IntPtr _buffer = Marshal.AllocHGlobal(BufferSize);
    private byte[] _data = new byte[16];
    private bool _enabled;
    private bool _disposed;

    /// <param name="report">Chemin du périphérique et rapport brut (identifiant de rapport compris s'il y en a un) ;
    /// le tableau est réutilisé : il ne doit pas être conservé.</param>
    public RawInputSink(Action<string, byte[]> report)
    {
        _report = report;
        // Fenêtre « message seulement » : invisible, jamais au premier plan
        _window = new HwndSource(new HwndSourceParameters("KaneMode.RawInput") { ParentWindow = new IntPtr(-3 /* HWND_MESSAGE */), Width = 0, Height = 0, WindowStyle = 0 });
        _handle = _window.Handle;
        _window.AddHook(Hook);
    }

    /// <summary>Commence ou cesse d'écouter les manettes (mode souris activé ou coupé).</summary>
    public void Enable(bool on)
    {
        if (_disposed || on == _enabled) return;
        // Retrait : la cible doit être vide (RIDEV_REMOVE)
        var devices = new[]
        {
            new RAWINPUTDEVICE { UsagePage = 1, Usage = 5 /* manette */, Flags = on ? RIDEV_INPUTSINK | RIDEV_DEVNOTIFY : RIDEV_REMOVE, Target = on ? _handle : IntPtr.Zero },
            new RAWINPUTDEVICE { UsagePage = 1, Usage = 4 /* joystick */, Flags = on ? RIDEV_INPUTSINK | RIDEV_DEVNOTIFY : RIDEV_REMOVE, Target = on ? _handle : IntPtr.Zero },
        };
        bool ok = RegisterRawInputDevices(devices, (uint)devices.Length, (uint)Marshal.SizeOf<RAWINPUTDEVICE>());
        if (ok) _enabled = on;
        Log.Write(ok ? (on ? "Raw Input : manettes écoutées en arrière-plan" : "Raw Input : écoute arrêtée") : "Raw Input : inscription refusée (code " + Marshal.GetLastWin32Error() + ")");
    }

    private IntPtr Hook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        // « handled » reste faux : Windows doit finir son traitement du message (DefWindowProc)
        if (msg == WM_INPUT && !_disposed) { try { Read(lParam); } catch (Exception ex) { Log.Write("Raw Input : " + ex.GetType().Name + " : " + ex.Message); } }
        return IntPtr.Zero;
    }

    private void Read(IntPtr raw)
    {
        uint size = BufferSize;
        uint got = GetRawInputData(raw, RID_INPUT, _buffer, ref size, HeaderSize);
        if (got == uint.MaxValue || got < HeaderSize + 8) return;
        if ((uint)Marshal.ReadInt32(_buffer) != RIM_TYPEHID) return;
        IntPtr device = Marshal.ReadIntPtr(_buffer, 8);
        if (!_names.TryGetValue(device, out string? path)) _names[device] = path = Name(device);
        if (path.Length == 0) return; // pas une manette qui nous concerne : rien n'est copié
        int hid = (int)HeaderSize;
        int each = Marshal.ReadInt32(_buffer, hid), count = Marshal.ReadInt32(_buffer, hid + 4);
        if (each <= 0 || count <= 0 || hid + 8 + (long)each * count > got) return;
        if (_data.Length != each) _data = new byte[each];
        for (int i = 0; i < count; i++)
        {
            Marshal.Copy(_buffer + hid + 8 + i * each, _data, 0, each);
            _report(path, _data);
        }
    }

    /// <summary>Chemin du périphérique s'il s'agit d'une manette XInput (« …&amp;IG_xx ») ou d'une DualShock, sinon vide.</summary>
    private static string Name(IntPtr device)
    {
        uint size = 0;
        GetRawInputDeviceInfo(device, RIDI_DEVICENAME, null, ref size);
        if (size == 0 || size > 1024) return "";
        var name = new StringBuilder((int)size);
        if (GetRawInputDeviceInfo(device, RIDI_DEVICENAME, name, ref size) == uint.MaxValue) return "";
        string path = name.ToString();
        return path.Contains("&ig_", StringComparison.OrdinalIgnoreCase) || DualShockReports.Candidate(path) ? path : "";
    }

    public void Dispose()
    {
        if (_disposed) return;
        Enable(false);
        _disposed = true;
        try { _window.Dispose(); } catch { /* fenêtre déjà détruite */ }
        Marshal.FreeHGlobal(_buffer);
    }
}
