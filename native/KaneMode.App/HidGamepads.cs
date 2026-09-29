using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace KaneMode;

/// <summary>
/// Manettes compatibles Xbox lues en HID brut (collection « manette de jeu » que Windows crée pour
/// chaque manette XInput : chemin « …&amp;IG_xx »). Contrairement à XInput, cette lecture ne dépend ni
/// du premier plan ni du mode Xbox : sur la ROG Ally en mode Xbox, XInput ne donnait rien à KaneMode
/// (Start maintenu pas vu, mode souris sans stick ni boutons, manette perdue après KanePlay).
/// Chaque manette trouvée est lue sur son propre fil ; son état est rendu au format XInput.
/// </summary>
public sealed class HidGamepads : IDisposable
{
    public const int Max = 4;

    /// <summary>État façon XInput (boutons, sticks ; gâchettes non lues) de chaque manette HID.</summary>
    public readonly XState[] States = new XState[Max];
    public readonly bool[] Connected = new bool[Max];

    public struct XState { public ushort Buttons; public short LX, LY, RX, RY; }

    private readonly CancellationTokenSource _stop = new();
    private readonly object _lock = new();
    private readonly Dictionary<string, (int Slot, SafeFileHandle Handle)> _open = new(StringComparer.OrdinalIgnoreCase);

    public void Start()
    {
        var t = new Thread(() =>
        {
            while (!_stop.IsCancellationRequested)
            {
                try { Scan(); } catch (Exception ex) { Log.Write("Manettes HID : " + ex.Message); }
                _stop.Token.WaitHandle.WaitOne(3000); // nouvelles manettes, manettes revenues
            }
        }) { IsBackground = true, Name = "Manettes HID (recherche)" };
        t.Start();
    }

    /// <summary>Déconnexion puis reconnexion de toutes les manettes (retour de KanePlay).</summary>
    public void Reconnect()
    {
        lock (_lock)
        {
            // Lectures en cours interrompues, puis manettes fermées
            foreach (var (_, h) in _open.Values) { try { CancelIoEx(h, IntPtr.Zero); h.Dispose(); } catch (IOException) { } }
            _open.Clear();
            for (int i = 0; i < Max; i++) { Connected[i] = false; States[i] = default; }
        }
        Log.Write("Manettes HID : déconnexion et reconnexion");
        try { Scan(); } catch (Exception ex) { Log.Write("Manettes HID : " + ex.Message); }
    }

    private void Scan()
    {
        HidD_GetHidGuid(out Guid hidGuid);
        IntPtr set = SetupDiGetClassDevs(ref hidGuid, IntPtr.Zero, IntPtr.Zero, 0x12 /* DIGCF_PRESENT | DIGCF_DEVICEINTERFACE */);
        if (set == new IntPtr(-1)) return;
        try
        {
            var iface = new SP_DEVICE_INTERFACE_DATA { cbSize = Marshal.SizeOf<SP_DEVICE_INTERFACE_DATA>() };
            for (uint i = 0; SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref hidGuid, i, ref iface); i++)
            {
                string? path = InterfacePath(set, ref iface);
                // Manettes XInput seulement (disposition des boutons connue)
                if (path == null || !path.Contains("&ig_", StringComparison.OrdinalIgnoreCase)) continue;
                lock (_lock) { if (_open.ContainsKey(path)) continue; }
                TryOpen(path);
            }
        }
        finally { SetupDiDestroyDeviceInfoList(set); }
    }

    private void TryOpen(string path)
    {
        var handle = CreateFile(path, 0x80000000 /* GENERIC_READ */, 3 /* FILE_SHARE_READ | FILE_SHARE_WRITE */, IntPtr.Zero, 3 /* OPEN_EXISTING */, 0, IntPtr.Zero);
        if (handle.IsInvalid) { handle.Dispose(); return; }
        if (!HidD_GetPreparsedData(handle, out IntPtr pre)) { handle.Dispose(); return; }
        HIDP_CAPS caps;
        if (HidP_GetCaps(pre, out caps) != HIDP_STATUS_SUCCESS || caps.UsagePage != 1 || (caps.Usage != 4 && caps.Usage != 5) || caps.InputReportByteLength < 2)
        {
            HidD_FreePreparsedData(pre); handle.Dispose(); return;
        }
        int slot;
        lock (_lock)
        {
            slot = Enumerable.Range(0, Max).FirstOrDefault(s => !_open.Values.Any(o => o.Slot == s), -1);
            if (slot < 0) { HidD_FreePreparsedData(pre); handle.Dispose(); return; }
            _open[path] = (slot, handle);
        }
        var ranges = ValueRanges(pre, caps);
        Log.Write($"Manette HID {slot} ouverte ({path.Split('#').ElementAtOrDefault(1) ?? path})");
        var t = new Thread(() => ReadLoop(path, slot, handle, pre, caps.InputReportByteLength, ranges)) { IsBackground = true, Name = "Manette HID " + slot, Priority = ThreadPriority.AboveNormal };
        t.Start();
    }

    private void ReadLoop(string path, int slot, SafeFileHandle handle, IntPtr pre, int length, Dictionary<ushort, (int Min, int Max)> ranges)
    {
        var report = new byte[length];
        var usages = new ushort[32];
        try
        {
            using var stream = new FileStream(handle, FileAccess.Read, 0, isAsync: false);
            while (!_stop.IsCancellationRequested)
            {
                int n = stream.Read(report, 0, length);
                if (n <= 0) break;
                var s = new XState();
                int count = usages.Length;
                if (HidP_GetUsages(0 /* HidP_Input */, 9 /* boutons */, 0, usages, ref count, pre, report, length) == HIDP_STATUS_SUCCESS)
                    for (int k = 0; k < count; k++) s.Buttons |= Button(usages[k]);
                s.LX = Axis(pre, report, length, ranges, 0x30, false);
                s.LY = Axis(pre, report, length, ranges, 0x31, true);
                s.RX = Axis(pre, report, length, ranges, 0x33, false);
                s.RY = Axis(pre, report, length, ranges, 0x34, true);
                s.Buttons |= Hat(pre, report, length, ranges);
                States[slot] = s;
                Connected[slot] = true;
            }
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or UnauthorizedAccessException or OperationCanceledException) { }
        finally
        {
            HidD_FreePreparsedData(pre);
            lock (_lock)
            {
                // Après Reconnect, la même manette a pu être rouverte : on ne touche qu'à la sienne
                if (_open.TryGetValue(path, out var o) && o.Handle == handle) _open.Remove(path);
                try { handle.Dispose(); } catch (IOException) { }
                if (!_open.Values.Any(x => x.Slot == slot)) { Connected[slot] = false; States[slot] = default; }
            }
            if (!_stop.IsCancellationRequested) Log.Write($"Manette HID {slot} fermée");
        }
    }

    // Boutons HID des manettes XInput : A, B, X, Y, LB, RB, View, Menu, L3, R3 → bits XInput
    private static readonly ushort[] ButtonBits = { 0x1000, 0x2000, 0x4000, 0x8000, 0x100, 0x200, 0x20, 0x10, 0x40, 0x80 };
    private static ushort Button(ushort usage) => usage >= 1 && usage <= ButtonBits.Length ? ButtonBits[usage - 1] : (ushort)0;

    /// <summary>Axe en valeur XInput (−32767 à 32767, haut positif pour Y).</summary>
    private static short Axis(IntPtr pre, byte[] report, int length, Dictionary<ushort, (int Min, int Max)> ranges, ushort usage, bool invert)
    {
        if (!ranges.TryGetValue(usage, out var r) || r.Max <= r.Min) return 0;
        if (HidP_GetUsageValue(0, 1, 0, usage, out uint raw, pre, report, length) != HIDP_STATUS_SUCCESS) return 0;
        double v = ((double)raw - r.Min) / (r.Max - r.Min) * 2 - 1;
        if (invert) v = -v; // HID : Y vers le bas ; XInput : Y vers le haut
        return (short)Math.Round(Math.Clamp(v, -1, 1) * 32767);
    }

    /// <summary>Croix (chapeau HID, 8 directions à partir du haut) → bits XInput.</summary>
    private static ushort Hat(IntPtr pre, byte[] report, int length, Dictionary<ushort, (int Min, int Max)> ranges)
    {
        if (!ranges.TryGetValue(0x39, out var r)) return 0;
        if (HidP_GetUsageValue(0, 1, 0, 0x39, out uint raw, pre, report, length) != HIDP_STATUS_SUCCESS) return 0;
        int d = (int)raw - r.Min;
        if (d < 0 || d > 7 || (int)raw > r.Max) return 0; // position neutre
        const ushort UP = 0x1, DOWN = 0x2, LEFT = 0x4, RIGHT = 0x8;
        return d switch { 0 => UP, 1 => UP | RIGHT, 2 => RIGHT, 3 => DOWN | RIGHT, 4 => DOWN, 5 => DOWN | LEFT, 6 => LEFT, _ => UP | LEFT };
    }

    /// <summary>Bornes de chaque valeur (axes, chapeau) de la manette.</summary>
    private static Dictionary<ushort, (int Min, int Max)> ValueRanges(IntPtr pre, HIDP_CAPS caps)
    {
        var map = new Dictionary<ushort, (int, int)>();
        ushort n = caps.NumberInputValueCaps;
        if (n == 0) return map;
        var list = new HIDP_VALUE_CAPS[n];
        if (HidP_GetValueCaps(0, list, ref n, pre) != HIDP_STATUS_SUCCESS) return map;
        for (int i = 0; i < n; i++)
        {
            var c = list[i];
            if (c.UsagePage != 1) continue;
            int min = c.LogicalMin, max = c.LogicalMax;
            // Valeur non signée sur 16 bits décrite comme signée : 0 à 65535
            if (max < min && c.BitSize > 0 && c.BitSize < 32) { min = 0; max = (1 << c.BitSize) - 1; }
            map[c.UsageMin] = (min, max);
        }
        return map;
    }

    public void Dispose()
    {
        _stop.Cancel();
        lock (_lock) { foreach (var (_, h) in _open.Values) { try { h.Dispose(); } catch (IOException) { } } _open.Clear(); }
    }

    private static string? InterfacePath(IntPtr set, ref SP_DEVICE_INTERFACE_DATA iface)
    {
        SetupDiGetDeviceInterfaceDetail(set, ref iface, IntPtr.Zero, 0, out int size, IntPtr.Zero);
        if (size <= 0) return null;
        IntPtr detail = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.WriteInt32(detail, IntPtr.Size == 8 ? 8 : 6);
            if (!SetupDiGetDeviceInterfaceDetail(set, ref iface, detail, size, out _, IntPtr.Zero)) return null;
            return Marshal.PtrToStringUni(detail + 4);
        }
        finally { Marshal.FreeHGlobal(detail); }
    }

    // ---------- HID et SetupAPI ----------
    private const int HIDP_STATUS_SUCCESS = 0x00110000;

    [StructLayout(LayoutKind.Sequential)]
    private struct SP_DEVICE_INTERFACE_DATA { public int cbSize; public Guid InterfaceClassGuid; public int Flags; public IntPtr Reserved; }

    [StructLayout(LayoutKind.Sequential)]
    private struct HIDP_CAPS
    {
        public ushort Usage, UsagePage, InputReportByteLength, OutputReportByteLength, FeatureReportByteLength;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
        public ushort NumberLinkCollectionNodes, NumberInputButtonCaps, NumberInputValueCaps, NumberInputDataIndices,
            NumberOutputButtonCaps, NumberOutputValueCaps, NumberOutputDataIndices,
            NumberFeatureButtonCaps, NumberFeatureValueCaps, NumberFeatureDataIndices;
    }

    // HIDP_VALUE_CAPS (72 octets) ; pour une valeur simple, Usage est à la place de UsageMin
    [StructLayout(LayoutKind.Sequential)]
    private struct HIDP_VALUE_CAPS
    {
        public ushort UsagePage; public byte ReportID; public byte IsAlias;
        public ushort BitField, LinkCollection, LinkUsage, LinkUsagePage;
        public byte IsRange, IsStringRange, IsDesignatorRange, IsAbsolute, HasNull, Reserved;
        public ushort BitSize, ReportCount;
        public ushort R1, R2, R3, R4, R5;
        public uint UnitsExp, Units;
        public int LogicalMin, LogicalMax, PhysicalMin, PhysicalMax;
        public ushort UsageMin, UsageMax, StringMin, StringMax, DesignatorMin, DesignatorMax, DataIndexMin, DataIndexMax;
    }

    [DllImport("hid.dll")] private static extern void HidD_GetHidGuid(out Guid guid);
    [DllImport("hid.dll")] private static extern bool HidD_GetPreparsedData(SafeFileHandle device, out IntPtr data);
    [DllImport("hid.dll")] private static extern bool HidD_FreePreparsedData(IntPtr data);
    [DllImport("hid.dll")] private static extern int HidP_GetCaps(IntPtr data, out HIDP_CAPS caps);
    [DllImport("hid.dll")] private static extern int HidP_GetValueCaps(int type, [Out] HIDP_VALUE_CAPS[] caps, ref ushort length, IntPtr data);
    [DllImport("hid.dll")] private static extern int HidP_GetUsages(int type, ushort page, ushort link, [Out] ushort[] list, ref int length, IntPtr data, byte[] report, int reportLength);
    [DllImport("hid.dll")] private static extern int HidP_GetUsageValue(int type, ushort page, ushort link, ushort usage, out uint value, IntPtr data, byte[] report, int reportLength);

    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern IntPtr SetupDiGetClassDevs(ref Guid classGuid, IntPtr enumerator, IntPtr parent, int flags);
    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr deviceInfo, ref Guid classGuid, uint index, ref SP_DEVICE_INTERFACE_DATA data);
    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref SP_DEVICE_INTERFACE_DATA data, IntPtr detail, int size, out int required, IntPtr deviceInfo);
    [DllImport("setupapi.dll")]
    private static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);

    [DllImport("kernel32.dll")]
    private static extern bool CancelIoEx(SafeFileHandle handle, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
}
