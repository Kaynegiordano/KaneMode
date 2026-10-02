using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace KaneMode;

/// <summary>
/// Manettes compatibles Xbox lues en HID brut (collection « manette de jeu » que Windows crée pour
/// chaque manette XInput : chemin « …&amp;IG_xx »). Contrairement à XInput, cette lecture ne dépend ni
/// du premier plan ni du mode Xbox : sur la ROG Ally en mode Xbox, XInput ne donnait rien à KaneMode
/// (Start maintenu pas vu, mode souris sans stick ni boutons, manette perdue après KanePlay).
/// DualShock 4 : rapports USB/Bluetooth lus directement, sans dépendre de WebView2 en arrière-plan.
/// Chaque manette trouvée est lue sur son propre fil ; son état est rendu au format XInput.
/// </summary>
public sealed class HidGamepads : IDisposable
{
    public const int Max = 4;

    /// <summary>États publiés et lus sous verrou : aucun mélange de deux rapports de manette.</summary>
    private readonly XState[] States = new XState[Max];
    private readonly bool[] Connected = new bool[Max];

    public struct XState { public ushort Buttons; public short LX, LY, RX, RY; public byte LT, RT; }
    private readonly bool[] _sony = new bool[Max];
    public bool SonyConnected { get { lock (_lock) return Enumerable.Range(0, Max).Any(i => _sony[i] && Connected[i]); } }
    public bool SonySlot(int slot) { lock (_lock) return _sony[slot] && Connected[slot]; }
    public bool Snapshot(int slot, out XState state) { lock (_lock) { state = States[slot]; return Connected[slot]; } }

    // Lecture par Raw Input : décodage identique à celui de ReadLoop, à partir du rapport reçu par le système
    private sealed record Dev(int Slot, IntPtr Pre, Dictionary<(byte, ushort), ValueRange> Ranges, bool Sony, int Length);
    private readonly Dictionary<string, Dev> _devices = new(StringComparer.OrdinalIgnoreCase);
    private readonly long[] _rawReports = new long[Max];

    /// <summary>Rapport reçu par Raw Input pour une manette déjà ouverte (chemin du périphérique, rapport brut).</summary>
    internal void Feed(string path, byte[] data)
    {
        lock (_lock)
        {
            if (!_open.ContainsKey(path) || !_devices.TryGetValue(path, out var d)) return;
            // Sans identifiant de rapport, Raw Input ne le fournit pas : on le rétablit (0) comme ReadFile
            byte[] report = data.Length == d.Length ? data : data.Length + 1 == d.Length ? new byte[] { 0 }.Concat(data).ToArray() : Array.Empty<byte>();
            if (report.Length == 0) return;
            XState s = States[d.Slot];
            if (d.Sony)
            {
                if (!DualShockReports.TryRead(report.AsSpan(0, report.Length), out s)) return;
            }
            else
            {
                var usages = new ushort[32];
                int count = usages.Length;
                if (HidP_GetUsages(0, 9, 0, usages, ref count, d.Pre, report, d.Length) == HIDP_STATUS_SUCCESS)
                {
                    s.Buttons &= 15;
                    for (int k = 0; k < count; k++) s.Buttons |= Button(usages[k]);
                }
                uint? Read(ushort link, ushort usage) => HidP_GetUsageValue(0, 1, link, usage, out uint raw, d.Pre, report, d.Length) == HIDP_STATUS_SUCCESS ? raw : null;
                s = ApplyValues(s, report[0], d.Ranges, Read);
            }
            States[d.Slot] = s; Connected[d.Slot] = true;
            _rawReports[d.Slot]++;
            _last[d.Slot] = report.AsSpan(0, Math.Min(report.Length, 24)).ToArray();
        }
    }

    // Diagnostic : ce que la manette envoie vraiment (nombre de rapports, dernier rapport en hexadécimal)
    private readonly long[] _reports = new long[Max];
    private readonly byte[][] _last = new byte[Max][];
    public string Describe(int slot)
    {
        lock (_lock)
        {
            var s = States[slot];
            string hex = _last[slot] == null ? "aucun" : BitConverter.ToString(_last[slot]);
            return $"rapports={_reports[slot]} raw={_rawReports[slot]} dernier={hex} décodé=LX{s.LX} LY{s.LY} RX{s.RX} RY{s.RY} boutons=0x{s.Buttons:X}";
        }
    }

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
                // Nouvelles manettes, manettes revenues : toutes les 3 s tant qu'aucune n'est ouverte,
                // toutes les 20 s ensuite (la recherche parcourt tous les périphériques HID)
                bool any;
                lock (_lock) any = _open.Count > 0;
                _stop.Token.WaitHandle.WaitOne(any ? 20000 : 3000);
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
                // Dispositions connues : XInput et DualShock 4 ; jamais clavier ou souris HID.
                if (path == null || (!path.Contains("&ig_", StringComparison.OrdinalIgnoreCase) && !DualShockReports.Candidate(path))) continue;
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
        var attrs = new HIDD_ATTRIBUTES { Size = Marshal.SizeOf<HIDD_ATTRIBUTES>() };
        bool sony = HidD_GetAttributes(handle, ref attrs) && DualShockReports.Device(attrs.VendorID, attrs.ProductID);
        if (!sony && !path.Contains("&ig_", StringComparison.OrdinalIgnoreCase)) { handle.Dispose(); return; }
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
            _sony[slot] = sony;
        }
        var ranges = ValueRanges(pre, caps);
        lock (_lock) _devices[path] = new Dev(slot, pre, ranges, sony, caps.InputReportByteLength);
        Log.Write($"Manette HID {slot} ouverte ({path.Split('#').ElementAtOrDefault(1) ?? path})");
        // Description du périphérique : permet de vérifier le décodage des axes d'une console donnée
        Log.Write($"Manette HID {slot} : rapport de {caps.InputReportByteLength} octets, valeurs : " +
            string.Join(", ", ranges.Select(kv => $"id{kv.Key.Item1}/0x{kv.Key.Item2:X2}={kv.Value.Min}..{kv.Value.Max} ({kv.Value.Bits} bits)")));
        var t = new Thread(() => ReadLoop(path, slot, handle, pre, caps.InputReportByteLength, ranges, sony)) { IsBackground = true, Name = "Manette HID " + slot, Priority = ThreadPriority.AboveNormal };
        t.Start();
    }

    private void ReadLoop(string path, int slot, SafeFileHandle handle, IntPtr pre, int length, Dictionary<(byte, ushort), ValueRange> ranges, bool sony)
    {
        var report = new byte[length];
        var usages = new ushort[32];
        uint? ReadValue(ushort link, ushort usage) => HidP_GetUsageValue(0, 1, link, usage, out uint raw, pre, report, length) == HIDP_STATUS_SUCCESS ? raw : null;
        Func<ushort, ushort, uint?> readValue = ReadValue;
        try
        {
            using var stream = new FileStream(handle, FileAccess.Read, 0, isAsync: false);
            while (!_stop.IsCancellationRequested)
            {
                int n = stream.Read(report, 0, length);
                if (n <= 0) break;
                lock (_lock) { _reports[slot]++; _last[slot] = report.AsSpan(0, Math.Min(n, 24)).ToArray(); }
                if (_reports[slot] <= 2) Log.Write($"Manette HID {slot} : premier rapport reçu ({BitConverter.ToString(report, 0, Math.Min(n, 24))})");
                Snapshot(slot, out var s);
                if (sony)
                {
                    if (!DualShockReports.TryRead(report.AsSpan(0, n), out s)) continue;
                }
                else
                {
                    int count = usages.Length;
                    if (HidP_GetUsages(0 /* HidP_Input */, 9 /* boutons */, 0, usages, ref count, pre, report, length) == HIDP_STATUS_SUCCESS)
                    {
                        s.Buttons &= 15;
                        for (int k = 0; k < count; k++) s.Buttons |= Button(usages[k]);
                    }
                    s = ApplyValues(s, report[0], ranges, readValue);
                }
                lock (_lock)
                {
                    if (!_open.TryGetValue(path, out var current) || current.Handle != handle) break;
                    States[slot] = s; Connected[slot] = true;
                }
            }
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or UnauthorizedAccessException or OperationCanceledException) { }
        // Un rapport inattendu d'une manette ne doit jamais arrêter KaneMode : la manette est simplement
        // refermée (elle est rouverte par la prochaine recherche) et l'erreur est notée dans le journal
        catch (Exception ex) { Log.Write("Manette HID " + slot + " : lecture abandonnée (" + ex.GetType().Name + " : " + ex.Message + ")"); }
        finally
        {
            lock (_lock)
            {
                // Après Reconnect, la même manette a pu être rouverte : on ne touche qu'à la sienne
                if (_open.TryGetValue(path, out var o) && o.Handle == handle) { _open.Remove(path); _devices.Remove(path); }
                // Les données de description ne sont libérées qu'ici, sous verrou : Raw Input les utilise aussi
                HidD_FreePreparsedData(pre);
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
    internal static XState ApplyValues(XState state, byte report, Dictionary<(byte, ushort), ValueRange> ranges, Func<ushort, ushort, uint?> read)
    {
        short Axis(ushort usage, bool invert, short previous)
        {
            if (!ranges.TryGetValue((report, usage), out var range)) return previous;
            var raw = read(range.Link, usage);
            return raw.HasValue ? NormalizeAxis(raw.Value, range, invert) : previous;
        }
        state.LX = Axis(0x30, false, state.LX); state.LY = Axis(0x31, true, state.LY);
        state.RX = Axis(0x33, false, state.RX); state.RY = Axis(0x34, true, state.RY);
        if (ranges.TryGetValue((report, 0x39), out var hat) && read(hat.Link, 0x39) is uint rawHat)
        {
            long d = rawHat - hat.Min;
            ushort bits = (ushort)(d < 0 || d > 7 || rawHat > hat.Max ? 0 : d switch { 0 => 1, 1 => 9, 2 => 8, 3 => 10, 4 => 2, 5 => 6, 6 => 4, _ => 5 });
            state.Buttons = (ushort)((state.Buttons & ~15) | bits);
        }
        return state;
    }

    internal readonly record struct ValueRange(long Min, long Max, ushort Bits, ushort Link);
    internal static short NormalizeAxis(uint raw, ValueRange range, bool invert)
    {
        if (range.Max <= range.Min || range.Bits is 0 or > 32) return 0;
        long value = raw & ((1L << range.Bits) - 1);
        if (range.Min < 0) { long sign = 1L << (range.Bits - 1); value = (value ^ sign) - sign; }
        if (value < range.Min || value > range.Max) return 0;
        double v = (double)(value - range.Min) / (range.Max - range.Min) * 2 - 1;
        if (invert) v = -v; // HID : Y vers le bas ; XInput : Y vers le haut
        return (short)Math.Round(Math.Clamp(v, -1, 1) * 32767);
    }

    /// <summary>Bornes de chaque valeur (axes, chapeau) de la manette.</summary>
    private static Dictionary<(byte, ushort), ValueRange> ValueRanges(IntPtr pre, HIDP_CAPS caps)
    {
        ushort n = caps.NumberInputValueCaps;
        if (n == 0) return new();
        var list = new HIDP_VALUE_CAPS[n];
        if (HidP_GetValueCaps(0, list, ref n, pre) != HIDP_STATUS_SUCCESS) return new();
        return ExpandRanges(list.Take(n));
    }

    // Une capacité HID peut décrire plusieurs axes : conserver toute la plage, le rapport
    // et la collection. HidP_GetUsageValue renvoie une valeur brute non signée.
    internal static Dictionary<(byte, ushort), ValueRange> ExpandRanges(IEnumerable<HIDP_VALUE_CAPS> list)
    {
        var map = new Dictionary<(byte, ushort), ValueRange>();
        foreach (var c in list)
        {
            if (c.UsagePage != 1 || c.BitSize is 0 or > 32) continue;
            long min = c.LogicalMin, max = c.LogicalMax;
            // Valeur non signée sur 16 bits décrite comme signée : 0 à 65535
            if (min >= 0 && max < min) max = (1L << c.BitSize) - 1;
            int end = c.IsRange != 0 ? c.UsageMax : c.UsageMin;
            for (int usage = Math.Max(0x30, (int)c.UsageMin); usage <= Math.Min(0x39, end); usage++)
                map[(c.ReportID, (ushort)usage)] = new(min, max, c.BitSize, c.LinkCollection);
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
    [StructLayout(LayoutKind.Sequential)]
    private struct HIDD_ATTRIBUTES { public int Size; public ushort VendorID, ProductID, VersionNumber; }
    [DllImport("hid.dll")] private static extern bool HidD_GetAttributes(SafeFileHandle device, ref HIDD_ATTRIBUTES attributes);
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
    internal struct HIDP_VALUE_CAPS
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
