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
    private const uint RIDEV_INPUTSINK = 0x100, RIDEV_DEVNOTIFY = 0x2000;
    // RAWINPUTHEADER : dwType, dwSize (4 octets chacun), hDevice, wParam (un pointeur chacun)
    private static readonly uint HeaderSize = (uint)(8 + 2 * IntPtr.Size);

    private readonly HwndSource _window;
    private readonly Action<string, byte[]> _report;
    private readonly Dictionary<IntPtr, string> _names = new();
    public bool Registered { get; }

    /// <param name="report">Chemin du périphérique et rapport brut (identifiant de rapport compris s'il y en a un).</param>
    public RawInputSink(Action<string, byte[]> report)
    {
        _report = report;
        // Fenêtre « message seulement » : invisible, jamais au premier plan
        _window = new HwndSource(new HwndSourceParameters("KaneMode.RawInput") { ParentWindow = new IntPtr(-3 /* HWND_MESSAGE */), Width = 0, Height = 0, WindowStyle = 0 });
        _window.AddHook(Hook);
        var devices = new[]
        {
            new RAWINPUTDEVICE { UsagePage = 1, Usage = 5 /* manette */, Flags = RIDEV_INPUTSINK | RIDEV_DEVNOTIFY, Target = _window.Handle },
            new RAWINPUTDEVICE { UsagePage = 1, Usage = 4 /* joystick */, Flags = RIDEV_INPUTSINK | RIDEV_DEVNOTIFY, Target = _window.Handle },
        };
        Registered = RegisterRawInputDevices(devices, (uint)devices.Length, (uint)Marshal.SizeOf<RAWINPUTDEVICE>());
        Log.Write(Registered ? "Raw Input : manettes écoutées en arrière-plan" : "Raw Input : inscription refusée (code " + Marshal.GetLastWin32Error() + ")");
    }

    private IntPtr Hook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        // « handled » reste faux : Windows doit finir son traitement du message (DefWindowProc)
        if (msg == WM_INPUT) { try { Read(lParam); } catch (Exception ex) { Log.Write("Raw Input : " + ex.GetType().Name + " : " + ex.Message); } }
        return IntPtr.Zero;
    }

    private void Read(IntPtr raw)
    {
        uint size = 0;
        if (GetRawInputData(raw, RID_INPUT, IntPtr.Zero, ref size, HeaderSize) != 0 || size < HeaderSize + 8 || size > 8192) return;
        IntPtr buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            if (GetRawInputData(raw, RID_INPUT, buffer, ref size, HeaderSize) != size) return;
            if ((uint)Marshal.ReadInt32(buffer) != RIM_TYPEHID) return;
            IntPtr device = Marshal.ReadIntPtr(buffer, 8);
            int hid = (int)HeaderSize;
            int each = Marshal.ReadInt32(buffer, hid), count = Marshal.ReadInt32(buffer, hid + 4);
            if (each <= 0 || count <= 0 || hid + 8 + (long)each * count > size) return;
            if (!_names.TryGetValue(device, out string? path)) _names[device] = path = Name(device);
            if (path.Length == 0) return;
            for (int i = 0; i < count; i++)
            {
                var report = new byte[each];
                Marshal.Copy(buffer + hid + 8 + i * each, report, 0, each);
                _report(path, report);
            }
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static string Name(IntPtr device)
    {
        uint size = 0;
        GetRawInputDeviceInfo(device, RIDI_DEVICENAME, null, ref size);
        if (size == 0 || size > 1024) return "";
        var name = new StringBuilder((int)size);
        return GetRawInputDeviceInfo(device, RIDI_DEVICENAME, name, ref size) == uint.MaxValue ? "" : name.ToString();
    }

    public void Dispose() { try { _window.Dispose(); } catch { /* fenêtre déjà détruite */ } }
}
