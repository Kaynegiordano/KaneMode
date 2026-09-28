using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace KaneMode;

/// <summary>
/// Boutons dédiés des ROG Ally (Command Center en haut à gauche, Armoury Crate en dessous). Ils
/// passent par la manette interne d'ASUS (HID, VID 0B05) : rapport 0x5A dont le 2e octet donne
/// le bouton. Plusieurs programmes peuvent lire ces rapports en même temps, KaneMode les lit donc
/// à côté des services ASUS, sans pilote ni droits administrateur.
/// </summary>
public sealed class AllyButtons : IDisposable
{
    private const ushort AsusVendor = 0x0B05;
    // ROG Ally (RC71L), ROG Ally X et ROG Xbox Ally (RC72L, RC73)
    private static readonly ushort[] Products = { 0x1ABE, 0x1B4C };
    private const byte ReportId = 0x5A;

    /// <summary>Bouton pressé : « cc » (Command Center), « ac » (Armoury Crate), « ac-hold » (appui long).</summary>
    public event Action<string>? Pressed;

    private readonly CancellationTokenSource _stop = new();
    private FileStream? _stream;

    public void Start() => Task.Run(ReadLoopAsync);

    /// <summary>Après une sortie de veille, la manette interne est réénumérée : on la rouvre.</summary>
    public void Reopen()
    {
        try { _stream?.Dispose(); } catch (IOException) { }
    }

    private async Task ReadLoopAsync()
    {
        bool logged = false;
        while (!_stop.IsCancellationRequested)
        {
            (SafeFileHandle handle, int length)? found = null;
            try { found = Open(out bool asus); if (!asus) { Log.Write("Boutons ASUS : pas de manette ROG Ally sur ce PC"); return; } }
            catch (Exception ex) { Log.Write("Boutons ASUS : " + ex.Message); }
            if (found == null)
            {
                if (!logged) { Log.Write("Boutons ASUS : manette interne introuvable, nouvel essai dans 5 s"); logged = true; }
                await Delay(5000);
                continue;
            }
            logged = false;
            var (handle, length) = found.Value;
            Log.Write("Boutons ASUS : lecture de la manette interne");
            var buffer = new byte[Math.Max(length, 64)];
            try
            {
                using (_stream = new FileStream(handle, FileAccess.Read, 0, isAsync: true))
                {
                    while (!_stop.IsCancellationRequested)
                    {
                        int n = await _stream.ReadAsync(buffer.AsMemory(0, length), _stop.Token);
                        if (n < 2 || buffer[0] != ReportId) continue;
                        string? button = buffer[1] switch
                        {
                            166 => "cc",      // Command Center : clic
                            56 => "ac",       // Armoury Crate : clic
                            167 => "ac-hold", // Armoury Crate : appui long (168 au relâchement)
                            _ => null,
                        };
                        if (button != null) Pressed?.Invoke(button);
                    }
                }
            }
            catch (OperationCanceledException) { return; }
            catch (Exception ex) when (ex is IOException or ObjectDisposedException or UnauthorizedAccessException)
            {
                Log.Write("Boutons ASUS : lecture interrompue (" + ex.Message + "), reprise");
            }
            await Delay(1500);
        }
    }

    private async Task Delay(int ms)
    {
        try { await Task.Delay(ms, _stop.Token); } catch (OperationCanceledException) { }
    }

    /// <summary>
    /// Cherche l'interface HID de la manette ASUS qui accepte le rapport 0x5A (collection
    /// constructeur). `asus` est faux s'il n'y a aucun périphérique ASUS de ce type : pas une ROG Ally.
    /// </summary>
    private static (SafeFileHandle, int)? Open(out bool asus)
    {
        asus = false;
        HidD_GetHidGuid(out Guid hidGuid);
        IntPtr set = SetupDiGetClassDevs(ref hidGuid, IntPtr.Zero, IntPtr.Zero, 0x12 /* DIGCF_PRESENT | DIGCF_DEVICEINTERFACE */);
        if (set == new IntPtr(-1)) return null;
        try
        {
            var iface = new SP_DEVICE_INTERFACE_DATA { cbSize = Marshal.SizeOf<SP_DEVICE_INTERFACE_DATA>() };
            for (uint i = 0; SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref hidGuid, i, ref iface); i++)
            {
                string? path = InterfacePath(set, ref iface);
                if (path == null || !IsAlly(path)) continue;
                asus = true;
                var handle = CreateFile(path, 0xC0000000 /* GENERIC_READ | GENERIC_WRITE */, 3 /* FILE_SHARE_READ | FILE_SHARE_WRITE */,
                    IntPtr.Zero, 3 /* OPEN_EXISTING */, 0x40000000 /* FILE_FLAG_OVERLAPPED */, IntPtr.Zero);
                if (handle.IsInvalid) { handle.Dispose(); continue; }
                if (Caps(handle) is { } caps && caps.FeatureReportByteLength >= 64 && caps.InputReportByteLength > 1)
                {
                    var feature = new byte[caps.FeatureReportByteLength];
                    feature[0] = ReportId;
                    if (HidD_GetFeature(handle, feature, feature.Length)) return (handle, caps.InputReportByteLength);
                }
                handle.Dispose();
            }
        }
        finally { SetupDiDestroyDeviceInfoList(set); }
        return null;
    }

    private static bool IsAlly(string path)
    {
        string p = path.ToLowerInvariant();
        return p.Contains($"vid_{AsusVendor:x4}") && Products.Any(id => p.Contains($"pid_{id:x4}"));
    }

    private static string? InterfacePath(IntPtr set, ref SP_DEVICE_INTERFACE_DATA iface)
    {
        SetupDiGetDeviceInterfaceDetail(set, ref iface, IntPtr.Zero, 0, out int size, IntPtr.Zero);
        if (size <= 0) return null;
        IntPtr detail = Marshal.AllocHGlobal(size);
        try
        {
            // SP_DEVICE_INTERFACE_DETAIL_DATA_W : cbSize vaut 8 en 64 bits, le chemin suit à l'octet 4
            Marshal.WriteInt32(detail, IntPtr.Size == 8 ? 8 : 6);
            if (!SetupDiGetDeviceInterfaceDetail(set, ref iface, detail, size, out _, IntPtr.Zero)) return null;
            return Marshal.PtrToStringUni(detail + 4);
        }
        finally { Marshal.FreeHGlobal(detail); }
    }

    private static HIDP_CAPS? Caps(SafeFileHandle handle)
    {
        if (!HidD_GetPreparsedData(handle, out IntPtr data)) return null;
        try { return HidP_GetCaps(data, out HIDP_CAPS caps) == 0x00110000 /* HIDP_STATUS_SUCCESS */ ? caps : null; }
        finally { HidD_FreePreparsedData(data); }
    }

    public void Dispose()
    {
        _stop.Cancel();
        Reopen();
    }

    // ---------- HID et SetupAPI ----------
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

    [DllImport("hid.dll")] private static extern void HidD_GetHidGuid(out Guid guid);
    [DllImport("hid.dll")] private static extern bool HidD_GetPreparsedData(SafeFileHandle device, out IntPtr data);
    [DllImport("hid.dll")] private static extern bool HidD_FreePreparsedData(IntPtr data);
    [DllImport("hid.dll")] private static extern int HidP_GetCaps(IntPtr data, out HIDP_CAPS caps);
    [DllImport("hid.dll")] private static extern bool HidD_GetFeature(SafeFileHandle device, byte[] buffer, int length);

    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern IntPtr SetupDiGetClassDevs(ref Guid classGuid, IntPtr enumerator, IntPtr parent, int flags);
    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr deviceInfo, ref Guid classGuid, uint index, ref SP_DEVICE_INTERFACE_DATA data);
    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref SP_DEVICE_INTERFACE_DATA data, IntPtr detail, int size, out int required, IntPtr deviceInfo);
    [DllImport("setupapi.dll")]
    private static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
}
