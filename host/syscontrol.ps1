# Reglages systeme pour KaneMode (acces rapide, energie) : un processus qui reste ouvert et recoit
# des commandes JSON, une par ligne, sur l'entree standard ; il repond une ligne JSON par commande.
#   {"id":1,"cmd":"state"}                     etat de tout (volume, luminosite, energie, ecran, radios, constructeur)
#   {"id":2,"cmd":"volume","value":40}         volume principal (0-100)
#   {"id":3,"cmd":"mute","value":true}
#   {"id":4,"cmd":"brightness","value":70}     ecran integre (consoles, portables)
#   {"id":5,"cmd":"powermode","value":"performance"}   efficiency | balanced | performance (mode d'alimentation de Windows)
#   {"id":6,"cmd":"refresh","value":120}       frequence de l'ecran principal
#   {"id":7,"cmd":"radio","kind":"WiFi","value":true}  WiFi | Bluetooth
#   {"id":8,"cmd":"vendor","value":"turbo"}    profil du constructeur (ROG Ally, Legion Go)
#   {"id":9,"cmd":"tdp","value":15}            limite de puissance en watts (ROG Ally, experimental)
#   {"id":10,"cmd":"chargelimit","value":80}   limite de charge de la batterie (ROG Ally)
#   {"id":11,"cmd":"policy"}                   profil du constructeur en cours et source d'alimentation (lecture rapide)
param([string]$Vendor = '')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false

$source = @'
using System;
using System.Runtime.InteropServices;

namespace KaneMode {
  // ---- Volume (Core Audio)
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int NotImpl1();
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetChannelCount(out int count);
    int SetMasterVolumeLevel(float level, ref Guid context);
    int SetMasterVolumeLevelScalar(float level, ref Guid context);
    int GetMasterVolumeLevel(out float level);
    int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint channel, float level, ref Guid context);
    int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
    int GetChannelVolumeLevel(uint channel, out float level);
    int GetChannelVolumeLevelScalar(uint channel, out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }

  public static class Audio {
    static IAudioEndpointVolume Endpoint() {
      IMMDeviceEnumerator e = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
      IMMDevice dev;
      Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out dev)); // rendu, multimedia
      Guid iid = typeof(IAudioEndpointVolume).GUID;
      object o;
      Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
      return (IAudioEndpointVolume)o;
    }
    public static int GetVolume() { float v; Endpoint().GetMasterVolumeLevelScalar(out v); return (int)Math.Round(v * 100); }
    public static void SetVolume(int v) { Guid g = Guid.Empty; Endpoint().SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, v)) / 100f, ref g); }
    public static bool GetMute() { bool m; Endpoint().GetMute(out m); return m; }
    public static void SetMute(bool m) { Guid g = Guid.Empty; Endpoint().SetMute(m, ref g); }
  }

  // ---- Mode d'alimentation de Windows (curseur « Mode d'alimentation » des Parametres)
  public static class PowerMode {
    [DllImport("powrprof.dll")] static extern uint PowerGetEffectiveOverlayScheme(out Guid scheme);
    [DllImport("powrprof.dll")] static extern uint PowerSetActiveOverlayScheme(Guid scheme);
    public static readonly Guid Efficiency = new Guid("961cc777-2547-4f9d-8174-7d86181b8a7a");
    public static readonly Guid Balanced = Guid.Empty;
    public static readonly Guid Performance = new Guid("ded574b5-45a0-4f42-8737-46345c09c238");
    public static string Get() {
      Guid g;
      if (PowerGetEffectiveOverlayScheme(out g) != 0) return null;
      if (g == Efficiency) return "efficiency";
      if (g == Performance) return "performance";
      if (g == Balanced) return "balanced";
      return g.ToString();
    }
    public static uint Set(string mode) {
      Guid g = mode == "efficiency" ? Efficiency : mode == "performance" ? Performance : Balanced;
      return PowerSetActiveOverlayScheme(g);
    }
  }

  // ---- Mesures en direct : fréquence réelle du processeur (compteur « % Processor Performance »,
  // noms anglais donc indépendants de la langue de Windows) et puissance lue sur la batterie
  public static class Live {
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhOpenQuery(string src, IntPtr user, out IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhAddEnglishCounter(IntPtr query, string path, IntPtr user, out IntPtr counter);
    [DllImport("pdh.dll")] static extern int PdhCollectQueryData(IntPtr query);
    [StructLayout(LayoutKind.Explicit)] struct PdhValue { [FieldOffset(0)] public uint Status; [FieldOffset(8)] public double Double; }
    [DllImport("pdh.dll")] static extern int PdhGetFormattedCounterValue(IntPtr counter, uint format, IntPtr type, out PdhValue value);
    static IntPtr query, perf, util;
    static bool ready;
    static void Init() {
      if (ready) return;
      if (PdhOpenQuery(null, IntPtr.Zero, out query) != 0) throw new Exception("Compteurs indisponibles");
      PdhAddEnglishCounter(query, @"\Processor Information(_Total)\% Processor Performance", IntPtr.Zero, out perf);
      PdhAddEnglishCounter(query, @"\Processor Information(_Total)\% Processor Utility", IntPtr.Zero, out util);
      PdhCollectQueryData(query);
      ready = true;
    }
    static double Read(IntPtr c) {
      PdhValue v;
      if (c == IntPtr.Zero || PdhGetFormattedCounterValue(c, 0x00000200 | 0x00008000, IntPtr.Zero, out v) != 0) return -1; // DOUBLE | NOCAP100
      return v.Double;
    }
    public static double[] Cpu() {
      Init();
      PdhCollectQueryData(query);
      return new double[] { Read(perf), Read(util) };
    }

    // Batterie : IOCTL_BATTERY_QUERY_STATUS (Rate en mW, négatif en décharge)
    [DllImport("setupapi.dll", SetLastError = true)] static extern IntPtr SetupDiGetClassDevs(ref Guid cls, IntPtr enumerator, IntPtr parent, uint flags);
    [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr info, ref Guid cls, uint index, ref DevIface data);
    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref DevIface data, IntPtr detail, uint size, out uint required, IntPtr info);
    [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool DeviceIoControl(IntPtr h, uint code, ref uint inBuf, int inSize, out uint outBuf, int outSize, out int ret, IntPtr ov);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool DeviceIoControl(IntPtr h, uint code, ref WaitStatus inBuf, int inSize, out BatStatus outBuf, int outSize, out int ret, IntPtr ov);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [StructLayout(LayoutKind.Sequential)] struct DevIface { public int Size; public Guid Class; public int Flags; public IntPtr Reserved; }
    [StructLayout(LayoutKind.Sequential)] struct WaitStatus { public uint Tag, Timeout, PowerState, Low, High; }
    [StructLayout(LayoutKind.Sequential)] struct BatStatus { public uint PowerState, Capacity, Voltage; public int Rate; }
    // Renvoie { puissance (W, positive), en décharge (1/0), niveau (mWh) } ou null sans batterie
    // Chemin de la batterie, cherché une fois (l'énumération des périphériques est coûteuse, et les
    // mesures sont lues chaque seconde par l'accès rapide et les widgets Game Bar)
    static string batteryPath;
    static string FindBattery() {
      Guid cls = new Guid("72631e54-78a4-11d0-bcf7-00aa00b7b32a");
      IntPtr set = SetupDiGetClassDevs(ref cls, IntPtr.Zero, IntPtr.Zero, 0x12); // PRESENT | DEVICEINTERFACE
      if (set == new IntPtr(-1)) return null;
      try {
        DevIface d = new DevIface(); d.Size = Marshal.SizeOf(typeof(DevIface));
        if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref cls, 0, ref d)) return null;
        uint need;
        SetupDiGetDeviceInterfaceDetail(set, ref d, IntPtr.Zero, 0, out need, IntPtr.Zero);
        IntPtr buf = Marshal.AllocHGlobal((int)need);
        try {
          Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
          if (!SetupDiGetDeviceInterfaceDetail(set, ref d, buf, need, out need, IntPtr.Zero)) return null;
          return Marshal.PtrToStringUni(new IntPtr(buf.ToInt64() + 4));
        } finally { Marshal.FreeHGlobal(buf); }
      } finally { SetupDiDestroyDeviceInfoList(set); }
    }
    public static double[] Battery() {
      if (batteryPath == null) batteryPath = FindBattery();
      if (batteryPath == null) return null;
      IntPtr h = CreateFile(batteryPath, 0xC0000000, 3, IntPtr.Zero, 3, 0x80, IntPtr.Zero);
      if (h == new IntPtr(-1)) { batteryPath = null; return null; } // batterie réénumérée : cherchée à nouveau
      try {
        uint wait = 0, tag; int ret;
        if (!DeviceIoControl(h, 0x294040, ref wait, 4, out tag, 4, out ret, IntPtr.Zero) || tag == 0) return null;
        WaitStatus w = new WaitStatus(); w.Tag = tag;
        BatStatus st;
        if (!DeviceIoControl(h, 0x29404C, ref w, Marshal.SizeOf(typeof(WaitStatus)), out st, Marshal.SizeOf(typeof(BatStatus)), out ret, IntPtr.Zero)) return null;
        bool discharging = (st.PowerState & 0x2) != 0;
        double watts = st.Rate == unchecked((int)0x80000000) ? -1 : Math.Abs(st.Rate) / 1000.0;
        return new double[] { watts, discharging ? 1 : 0, st.Capacity };
      } finally { CloseHandle(h); }
    }
  }

  // ---- Processeur : limite de performance (%) et turbo, dans le mode de gestion actif (secteur et batterie)
  public static class Cpu {
    [DllImport("powrprof.dll")] static extern uint PowerGetActiveScheme(IntPtr root, out IntPtr scheme);
    [DllImport("powrprof.dll")] static extern uint PowerReadACValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, out uint value);
    [DllImport("powrprof.dll")] static extern uint PowerReadDCValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, out uint value);
    [DllImport("powrprof.dll")] static extern uint PowerWriteACValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, uint value);
    [DllImport("powrprof.dll")] static extern uint PowerWriteDCValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, uint value);
    [DllImport("powrprof.dll")] static extern uint PowerSetActiveScheme(IntPtr root, ref Guid scheme);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
    static Guid Sub = new Guid("54533251-82be-4824-96c1-47b60b740d00");
    public static Guid MaxState = new Guid("bc5038f7-23e0-4960-96da-33abaf5935ec");
    public static Guid Boost = new Guid("be337238-0d82-4146-a960-4f3749d470c7");
    static Guid Scheme() {
      IntPtr p;
      if (PowerGetActiveScheme(IntPtr.Zero, out p) != 0) throw new InvalidOperationException("Mode de gestion introuvable");
      Guid g = (Guid)Marshal.PtrToStructure(p, typeof(Guid));
      LocalFree(p);
      return g;
    }
    public static uint Read(Guid setting, bool ac) {
      Guid s = Scheme(); Guid sub = Sub; uint v;
      uint r = ac ? PowerReadACValueIndex(IntPtr.Zero, ref s, ref sub, ref setting, out v) : PowerReadDCValueIndex(IntPtr.Zero, ref s, ref sub, ref setting, out v);
      if (r != 0) throw new InvalidOperationException("Lecture refusée (" + r + ")");
      return v;
    }
    public static void Write(Guid setting, uint value) {
      Guid s = Scheme(); Guid sub = Sub;
      uint a = PowerWriteACValueIndex(IntPtr.Zero, ref s, ref sub, ref setting, value);
      uint d = PowerWriteDCValueIndex(IntPtr.Zero, ref s, ref sub, ref setting, value);
      if (a != 0 || d != 0) throw new InvalidOperationException("Windows a refusé le réglage (" + (a != 0 ? a : d) + ")");
      PowerSetActiveScheme(IntPtr.Zero, ref s);
    }
  }

  // ---- Frequence de l'ecran principal
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
    public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels;
    public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
    public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }
  public static class Display {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettings(string device, int mode, ref DEVMODE dm);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string device, ref DEVMODE dm, IntPtr hwnd, int flags, IntPtr param);
    static DEVMODE Current() { DEVMODE d = new DEVMODE(); d.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE)); EnumDisplaySettings(null, -1, ref d); return d; }
    public static int CurrentHz() { return Current().dmDisplayFrequency; }
    public static int[] Rates() {
      DEVMODE cur = Current();
      System.Collections.Generic.SortedSet<int> set = new System.Collections.Generic.SortedSet<int>();
      DEVMODE d = new DEVMODE(); d.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
      for (int i = 0; EnumDisplaySettings(null, i, ref d); i++) {
        if (d.dmPelsWidth == cur.dmPelsWidth && d.dmPelsHeight == cur.dmPelsHeight && d.dmBitsPerPel == cur.dmBitsPerPel && d.dmDisplayFrequency > 1) set.Add(d.dmDisplayFrequency);
      }
      int[] a = new int[set.Count]; set.CopyTo(a); return a;
    }
    public static int SetHz(int hz) {
      DEVMODE d = Current();
      d.dmDisplayFrequency = hz;
      d.dmFields = 0x400000; // DM_DISPLAYFREQUENCY
      return ChangeDisplaySettingsEx(null, ref d, IntPtr.Zero, 1 /* CDS_UPDATEREGISTRY */, IntPtr.Zero);
    }
    // Résolutions de l'écran principal (« 1920x1080 »), de la plus grande à la plus petite
    public static string CurrentSize() { DEVMODE c = Current(); return c.dmPelsWidth + "x" + c.dmPelsHeight; }
    public static string[] Sizes() {
      DEVMODE cur = Current();
      System.Collections.Generic.List<long> keys = new System.Collections.Generic.List<long>();
      DEVMODE d = new DEVMODE(); d.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
      for (int i = 0; EnumDisplaySettings(null, i, ref d); i++) {
        if (d.dmBitsPerPel != cur.dmBitsPerPel || d.dmPelsWidth < 800) continue;
        long k = (long)d.dmPelsWidth * 100000 + d.dmPelsHeight;
        if (!keys.Contains(k)) keys.Add(k);
      }
      keys.Sort(); keys.Reverse();
      string[] a = new string[keys.Count];
      for (int i = 0; i < a.Length; i++) a[i] = (keys[i] / 100000) + "x" + (keys[i] % 100000);
      return a;
    }
    public static int SetSize(int w, int h) {
      DEVMODE d = Current();
      int hz = d.dmDisplayFrequency;
      d.dmPelsWidth = w; d.dmPelsHeight = h;
      d.dmFields = 0x80000 | 0x100000; // DM_PELSWIDTH | DM_PELSHEIGHT
      int r = ChangeDisplaySettingsEx(null, ref d, IntPtr.Zero, 1, IntPtr.Zero);
      // Même fréquence si l'écran la propose dans cette résolution
      if (r == 0 && Array.IndexOf(Rates(), hz) >= 0 && CurrentHz() != hz) SetHz(hz);
      return r;
    }
  }

  // ---- HDR (couleur avancee) : API DisplayConfig, comme l'interrupteur des Parametres d'affichage
  public static class Hdr {
    [StructLayout(LayoutKind.Sequential)] struct Header { public uint type; public uint size; public uint adapterLow; public int adapterHigh; public uint id; }
    [StructLayout(LayoutKind.Sequential)] struct ColorInfo { public Header h; public uint value; public uint encoding; public uint bits; }
    [StructLayout(LayoutKind.Sequential)] struct ColorSet { public Header h; public uint value; }
    [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint flags, out uint paths, out uint modes);
    [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint flags, ref uint paths, IntPtr pathArray, ref uint modes, IntPtr modeArray, IntPtr topology);
    [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref ColorInfo info);
    [DllImport("user32.dll")] static extern int DisplayConfigSetDeviceInfo(ref ColorSet info);
    const int PathSize = 72, ModeSize = 64;

    // Ecrans actifs : adaptateur (LUID) et identifiant de la cible, lus dans DISPLAYCONFIG_PATH_INFO
    static Header[] Targets() {
      uint np, nm;
      if (GetDisplayConfigBufferSizes(2 /* QDC_ONLY_ACTIVE_PATHS */, out np, out nm) != 0) return new Header[0];
      IntPtr paths = Marshal.AllocHGlobal((int)np * PathSize), modes = Marshal.AllocHGlobal((int)nm * ModeSize);
      try {
        if (QueryDisplayConfig(2, ref np, paths, ref nm, modes, IntPtr.Zero) != 0) return new Header[0];
        Header[] list = new Header[np];
        for (int i = 0; i < np; i++) {
          IntPtr t = paths + i * PathSize + 20; // targetInfo apres sourceInfo (20 octets)
          list[i] = new Header { adapterLow = (uint)Marshal.ReadInt32(t), adapterHigh = Marshal.ReadInt32(t + 4), id = (uint)Marshal.ReadInt32(t + 8) };
        }
        return list;
      } finally { Marshal.FreeHGlobal(paths); Marshal.FreeHGlobal(modes); }
    }
    // -1 : aucun ecran HDR ; 0 : HDR coupe ; 1 : HDR actif (premier ecran compatible)
    public static int State() {
      foreach (Header t in Targets()) {
        ColorInfo c = new ColorInfo { h = t };
        c.h.type = 9; c.h.size = (uint)Marshal.SizeOf(typeof(ColorInfo));
        if (DisplayConfigGetDeviceInfo(ref c) == 0 && (c.value & 1) != 0) return (c.value & 2) != 0 ? 1 : 0;
      }
      return -1;
    }
    public static int Set(bool on) {
      int result = -1;
      foreach (Header t in Targets()) {
        ColorInfo c = new ColorInfo { h = t };
        c.h.type = 9; c.h.size = (uint)Marshal.SizeOf(typeof(ColorInfo));
        if (DisplayConfigGetDeviceInfo(ref c) != 0 || (c.value & 1) == 0) continue;
        ColorSet s = new ColorSet { h = t, value = on ? 1u : 0u };
        s.h.type = 10; s.h.size = (uint)Marshal.SizeOf(typeof(ColorSet));
        result = DisplayConfigSetDeviceInfo(ref s);
      }
      return result;
    }
  }

  // ---- Source d'alimentation : 1 secteur, 0 batterie, -1 inconnue
  public static class PowerSource {
    [StructLayout(LayoutKind.Sequential)]
    struct SYSTEM_POWER_STATUS { public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag; public int BatteryLifeTime, BatteryFullLifeTime; }
    [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS s);
    public static int OnAc() {
      SYSTEM_POWER_STATUS s;
      if (!GetSystemPowerStatus(out s)) return -1;
      return s.ACLineStatus == 1 ? 1 : s.ACLineStatus == 0 ? 0 : -1;
    }
  }

  // ---- ASUS (ROG Ally, Ally X, Xbox Ally) : peripherique ACPI « ATKACPI », comme G-Helper
  public static class Asus {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sec, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool DeviceIoControl(IntPtr h, uint code, byte[] inBuf, uint inSize, byte[] outBuf, uint outSize, ref uint returned, IntPtr overlapped);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    const uint DEVS = 0x53564544, DSTS = 0x53545344, IOCTL = 0x0022240C;
    public const int ThrottlePolicy = 0x00120075;   // 0 performance, 1 turbo, 2 silencieux
    public const int PptSpl = 0x001200A3, PptSppt = 0x001200A0, PptFppt = 0x001200C1;
    public const int ChargeLimit = 0x00120057;
    static int Call(uint method, byte[] args) {
      IntPtr h = CreateFile(@"\\.\ATKACPI", 0xC0000000, 3, IntPtr.Zero, 3, 0x80, IntPtr.Zero);
      if (h == new IntPtr(-1)) throw new InvalidOperationException("ATKACPI introuvable (pilote ASUS System Control Interface)");
      try {
        byte[] input = new byte[8 + args.Length];
        BitConverter.GetBytes(method).CopyTo(input, 0);
        BitConverter.GetBytes(args.Length).CopyTo(input, 4);
        args.CopyTo(input, 8);
        byte[] output = new byte[16];
        uint n = 0;
        if (!DeviceIoControl(h, IOCTL, input, (uint)input.Length, output, (uint)output.Length, ref n, IntPtr.Zero)) throw new InvalidOperationException("ATKACPI a refuse la commande");
        return BitConverter.ToInt32(output, 0);
      } finally { CloseHandle(h); }
    }
    public static bool Available() {
      IntPtr h = CreateFile(@"\\.\ATKACPI", 0xC0000000, 3, IntPtr.Zero, 3, 0x80, IntPtr.Zero);
      if (h == new IntPtr(-1)) return false;
      CloseHandle(h); return true;
    }
    public static int Get(int device) { return Call(DSTS, BitConverter.GetBytes(device)) - 65536; }
    public static int Set(int device, int value) {
      byte[] a = new byte[8];
      BitConverter.GetBytes(device).CopyTo(a, 0);
      BitConverter.GetBytes(value).CopyTo(a, 4);
      return Call(DEVS, a);
    }
  }
}
'@
# Code C# compilé une fois puis gardé (dll dans le dossier temporaire, nommée d'après son contenu) :
# le démarrage passe d'une demi-seconde de compilation à un simple chargement
$hash = [BitConverter]::ToString([Security.Cryptography.SHA1]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($source))).Replace('-', '').Substring(0, 16)
$dll = Join-Path ([IO.Path]::GetTempPath()) "kanemode-syscontrol-$hash.dll"
if (-not (Test-Path $dll)) {
    try { Add-Type -TypeDefinition $source -OutputAssembly $dll -ErrorAction Stop } catch { Remove-Item $dll -ErrorAction SilentlyContinue; Add-Type -TypeDefinition $source }
}
if (Test-Path $dll) { Add-Type -Path $dll }

# ---- Radios (Wi-Fi, Bluetooth) : API Windows.Devices.Radios
$radioReady = $false
function Init-Radios {
    if ($script:radioReady) { return }
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime] | Out-Null
    [Windows.Devices.Radios.RadioAccessStatus, Windows.System.Devices, ContentType = WindowsRuntime] | Out-Null
    $null = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
    $script:radioReady = $true
}
function Await($op, [Type]$type) {
    $t = $script:asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $null = $t.Wait(5000)
    $t.Result
}
function Get-Radios {
    Init-Radios
    $list = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
    @($list | Where-Object { "$($_.Kind)" -in 'WiFi', 'Bluetooth' })
}

# ---- Réseau (icône de la barre du haut) : connexion qui mène à Internet, filaire ou Wi-Fi.
# Une carte compte si elle est active et a une passerelle (le commutateur par défaut de Hyper-V n'en a
# pas) ; le filaire passe avant le Wi-Fi, comme dans Windows. VPN et Bluetooth sont ignorés.
function Get-Net {
    $best = $null
    foreach ($n in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        if ("$($n.OperationalStatus)" -ne 'Up') { continue }
        $t = "$($n.NetworkInterfaceType)"
        $kind = if ($t -eq 'Wireless80211') { 'wifi' } elseif ($t -match 'Ethernet') { 'ethernet' } else { continue }
        if ($n.Description -match 'VPN|TAP-|WireGuard|Tailscale|ZeroTier|Loopback|VMware|VirtualBox|Bluetooth') { continue }
        $gw = @($n.GetIPProperties().GatewayAddresses | Where-Object { $a = "$($_.Address)"; $a -and $a -ne '0.0.0.0' -and $a -ne '::' })
        if (-not $gw.Count) { continue }
        if (-not $best -or ($kind -eq 'ethernet' -and $best -eq 'wifi')) { $best = $kind }
    }
    $r = [ordered]@{ kind = if ($best) { $best } else { 'none' }; signal = $null }
    if ($best -eq 'wifi') {
        # Qualité du signal (0-100) ; netsh peut la refuser sans l'accès à la position : icône pleine
        try {
            $line = netsh wlan show interfaces 2>$null | Where-Object { $_ -match '^\s*Signal\s*:\s*(\d+)\s*%' } | Select-Object -First 1
            if ($line -match '(\d+)\s*%') { $r.signal = [int]$Matches[1] }
        } catch { }
    }
    $r
}

# ---- Lenovo (Legion Go, Go S, Go 2) : WMI « LENOVO_GAMEZONE_DATA », comme Legion Space
function Lenovo-Mode([int]$set = -1) {
    $wmi = Get-CimInstance -Namespace root/WMI -ClassName LENOVO_GAMEZONE_DATA -ErrorAction Stop | Select-Object -First 1
    if ($set -ge 0) { $null = Invoke-CimMethod -InputObject $wmi -MethodName SetSmartFanMode -Arguments @{ Data = [uint32]$set } }
    (Invoke-CimMethod -InputObject $wmi -MethodName GetSmartFanMode).Data
}

$asusModes = @{ performance = 0; turbo = 1; silent = 2 }
$lenovoModes = @{ quiet = 1; balanced = 2; performance = 3; custom = 255 }

function Vendor-State {
    if ($Vendor -eq 'asus' -and [KaneMode.Asus]::Available()) {
        $m = [KaneMode.Asus]::Get([KaneMode.Asus]::ThrottlePolicy)
        $name = ($asusModes.GetEnumerator() | Where-Object { $_.Value -eq $m } | Select-Object -First 1).Key
        $limit = [KaneMode.Asus]::Get([KaneMode.Asus]::ChargeLimit)
        return [ordered]@{ vendor = 'asus'; modes = @('silent', 'performance', 'turbo'); mode = $name; tdp = @{ min = 7; max = 30; boostMax = 35 }; chargeLimit = if ($limit -ge 20 -and $limit -le 100) { $limit } else { $null } }
    }
    if ($Vendor -eq 'lenovo') {
        try {
            $m = Lenovo-Mode
            $name = ($lenovoModes.GetEnumerator() | Where-Object { $_.Value -eq $m } | Select-Object -First 1).Key
            return [ordered]@{ vendor = 'lenovo'; modes = @('quiet', 'balanced', 'performance', 'custom'); mode = $name; tdp = @{ min = 5; max = 30; boostMax = 35 }; chargeLimit = $null }
        } catch { return [ordered]@{ vendor = 'lenovo'; error = $_.Exception.Message } }
    }
    $null
}

function Get-State {
    $s = [ordered]@{}
    $ac = [KaneMode.PowerSource]::OnAc()
    $s.ac = if ($ac -ge 0) { [bool]$ac } else { $null }
    try { $s.volume = [KaneMode.Audio]::GetVolume(); $s.muted = [KaneMode.Audio]::GetMute() } catch { $s.volume = $null }
    try { $s.brightness = [int](Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness } catch { $s.brightness = $null }
    try { $s.powerMode = [KaneMode.PowerMode]::Get() } catch { $s.powerMode = $null }
    try { $s.refresh = [ordered]@{ current = [KaneMode.Display]::CurrentHz(); available = @([KaneMode.Display]::Rates()) } } catch { $s.refresh = $null }
    try { $s.resolution = [ordered]@{ current = [KaneMode.Display]::CurrentSize(); available = @([KaneMode.Display]::Sizes()) } } catch { $s.resolution = $null }
    try { $s.hdr = [KaneMode.Hdr]::State() } catch { $s.hdr = -1 }
    try { $s.radios = @(Get-Radios | ForEach-Object { [ordered]@{ kind = "$($_.Kind)"; on = "$($_.State)" -eq 'On' } }) } catch { $s.radios = @() }
    try { $s.vendor = Vendor-State } catch { $s.vendor = $null }
    try { $s.cpu = [ordered]@{ maxAc = [int][KaneMode.Cpu]::Read([KaneMode.Cpu]::MaxState, $true); maxDc = [int][KaneMode.Cpu]::Read([KaneMode.Cpu]::MaxState, $false); boostAc = [int][KaneMode.Cpu]::Read([KaneMode.Cpu]::Boost, $true); boostDc = [int][KaneMode.Cpu]::Read([KaneMode.Cpu]::Boost, $false) } } catch { $s.cpu = $null }
    $s
}

function Run($c) {
    switch ($c.cmd) {
        'state' { return Get-State }
        'volume' { [KaneMode.Audio]::SetVolume([int]$c.value); return @{ volume = [KaneMode.Audio]::GetVolume() } }
        'mute' { [KaneMode.Audio]::SetMute([bool]$c.value); return @{ muted = [KaneMode.Audio]::GetMute() } }
        'brightness' {
            $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
            $null = Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]0; Brightness = [byte][Math]::Max(0, [Math]::Min(100, [int]$c.value)) }
            # Relue sur l'écran : la valeur renvoyée est celle qui est vraiment appliquée
            $read = $null
            try { $read = [int](Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness } catch { }
            return @{ brightness = if ($null -ne $read) { $read } else { [int]$c.value }; verified = $null -ne $read }
        }
        'powermode' {
            if ($c.value -notin 'efficiency', 'balanced', 'performance') { throw 'Mode inconnu' }
            $r = [KaneMode.PowerMode]::Set($c.value)
            if ($r -ne 0) { throw "Windows a refusé le mode d'alimentation (code $r) : il n'existe qu'avec le mode de gestion « Utilisation normale »" }
            return @{ powerMode = [KaneMode.PowerMode]::Get() }
        }
        'refresh' {
            $hz = [int]$c.value
            if ($hz -notin [KaneMode.Display]::Rates()) { throw "Fréquence non proposée par l'écran : $hz Hz" }
            $r = [KaneMode.Display]::SetHz($hz)
            if ($r -ne 0) { throw "Windows a refusé la fréquence (code $r)" }
            return @{ refresh = [KaneMode.Display]::CurrentHz() }
        }
        'resolution' {
            if ("$($c.value)" -notmatch '^(\d{3,5})x(\d{3,5})$') { throw 'Résolution invalide' }
            if ("$($c.value)" -notin [KaneMode.Display]::Sizes()) { throw "Résolution non proposée par l'écran : $($c.value)" }
            $r = [KaneMode.Display]::SetSize([int]$Matches[1], [int]$Matches[2])
            if ($r -ne 0) { throw "Windows a refusé la résolution (code $r)" }
            return @{ resolution = [KaneMode.Display]::CurrentSize() }
        }
        'hdr' {
            $r = [KaneMode.Hdr]::Set([bool]$c.value)
            if ($r -eq -1) { throw "Pas d'écran HDR" }
            if ($r -ne 0) { throw "Windows a refusé le HDR (code $r)" }
            return @{ hdr = [KaneMode.Hdr]::State() }
        }
        'net' { return Get-Net }
        'radio' {
            $radio = Get-Radios | Where-Object { "$($_.Kind)" -eq $c.kind } | Select-Object -First 1
            if (-not $radio) { throw "$($c.kind) introuvable" }
            $state = if ($c.value) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
            $r = Await ($radio.SetStateAsync($state)) ([Windows.Devices.Radios.RadioAccessStatus])
            if ("$r" -ne 'Allowed') { throw "Windows a refusé ($r)" }
            return @{ kind = $c.kind; on = [bool]$c.value }
        }
        'vendor' {
            if ($Vendor -eq 'asus') {
                if (-not $asusModes.ContainsKey($c.value)) { throw 'Profil inconnu' }
                $null = [KaneMode.Asus]::Set([KaneMode.Asus]::ThrottlePolicy, $asusModes[$c.value])
                # Vérifié : la console doit vraiment être passée dans ce profil
                $ok = $false
                for ($i = 0; $i -lt 3 -and -not $ok; $i++) {
                    if ($i) { Start-Sleep -Milliseconds 150 }
                    $got = [KaneMode.Asus]::Get([KaneMode.Asus]::ThrottlePolicy)
                    # Valeur illisible (certains BIOS) : rien à vérifier
                    $ok = $got -eq $asusModes[$c.value] -or $got -notin $asusModes.Values
                }
                if (-not $ok) { throw "La console n'a pas accepté le profil $($c.value)" }
            } elseif ($Vendor -eq 'lenovo') {
                if (-not $lenovoModes.ContainsKey($c.value)) { throw 'Profil inconnu' }
                $null = Lenovo-Mode $lenovoModes[$c.value]
            } else { throw 'Pas de profil constructeur sur cet appareil' }
            return Vendor-State
        }
        'tdp' {
            # Une valeur (les trois limites égales, comme le curseur de SteamOS) ou { spl, sppt, fppt }
            $v = $c.value
            if ($v -is [int] -or $v -is [long] -or $v -is [double]) { $v = @{ spl = [int]$v; sppt = [int]$v; fppt = [int]$v } }
            else { $v = @{ spl = [int]$v.spl; sppt = [int]$v.sppt; fppt = [int]$v.fppt } }
            $lim = (Vendor-State).tdp
            if (-not $lim) { throw 'Limite de puissance réglable seulement sur ROG Ally et Legion Go' }
            $spl = [Math]::Max($lim.min, [Math]::Min($lim.max, $v.spl))
            $sppt = [Math]::Max($spl, [Math]::Min($lim.boostMax, $v.sppt))
            $fppt = [Math]::Max($sppt, [Math]::Min($lim.boostMax, $v.fppt))
            if ($Vendor -eq 'asus') {
                $null = [KaneMode.Asus]::Set([KaneMode.Asus]::PptSpl, $spl)
                $null = [KaneMode.Asus]::Set([KaneMode.Asus]::PptSppt, $sppt)
                $null = [KaneMode.Asus]::Set([KaneMode.Asus]::PptFppt, $fppt)
            } else {
                # Legion Go : profil « personnalisé » puis limites (LENOVO_OTHER_METHOD, comme Legion Space)
                $null = Lenovo-Mode 255
                $m = Get-CimInstance -Namespace root/WMI -ClassName LENOVO_OTHER_METHOD -ErrorAction Stop | Select-Object -First 1
                foreach ($p in @(@(0x0102FF00, $spl), @(0x0101FF00, $sppt), @(0x0103FF00, $fppt))) {
                    $null = Invoke-CimMethod -InputObject $m -MethodName SetFeatureValue -Arguments @{ IDs = [int]$p[0]; value = [int]$p[1] }
                }
            }
            return @{ tdp = @{ spl = $spl; sppt = $sppt; fppt = $fppt } }
        }
        'cpumax' {
            $v = [Math]::Max(30, [Math]::Min(100, [int]$c.value))
            [KaneMode.Cpu]::Write([KaneMode.Cpu]::MaxState, [uint32]$v)
            return @{ cpuMax = [int][KaneMode.Cpu]::Read([KaneMode.Cpu]::MaxState, $true); verified = $true }
        }
        'boost' {
            # 0 : désactivé ; 2 : agressif (valeur par défaut de Windows sur la plupart des PC)
            $v = if ($c.value) { 2 } else { 0 }
            [KaneMode.Cpu]::Write([KaneMode.Cpu]::Boost, [uint32]$v)
            return @{ boost = [KaneMode.Cpu]::Read([KaneMode.Cpu]::Boost, $true) -ne 0; verified = $true }
        }
        'live' {
            # Mesures en direct pour l'accès rapide : fréquence réelle, charge, puissance sur batterie
            if (-not $script:baseMhz) { $script:baseMhz = [int](Get-ItemProperty 'HKLM:\HARDWARE\DESCRIPTION\System\CentralProcessor\0').'~MHz' }
            $cpu = [KaneMode.Live]::Cpu()
            $bat = $null
            try { $bat = [KaneMode.Live]::Battery() } catch { }
            return [ordered]@{
                mhz = if ($cpu[0] -ge 0) { [int]($script:baseMhz * $cpu[0] / 100) } else { $null }
                load = if ($cpu[1] -ge 0) { [Math]::Min(100, [int]$cpu[1]) } else { $null }
                watts = if ($bat -and $bat[0] -ge 0) { [Math]::Round($bat[0], 1) } else { $null }
                discharging = if ($bat) { [bool]$bat[1] } else { $null }
            }
        }
        'policy' {
            # Lecture rapide pour tenir le profil choisi (host/server.js, keepPerf) : un autre programme
            # (Armoury Crate SE et ses profils par jeu) ou la console elle-même peut en changer
            $ac = [KaneMode.PowerSource]::OnAc()
            $m = $null
            if ($Vendor -eq 'asus' -and [KaneMode.Asus]::Available()) {
                $v = [KaneMode.Asus]::Get([KaneMode.Asus]::ThrottlePolicy)
                $m = ($asusModes.GetEnumerator() | Where-Object { $_.Value -eq $v } | Select-Object -First 1).Key
            } elseif ($Vendor -eq 'lenovo') {
                $v = Lenovo-Mode
                $m = ($lenovoModes.GetEnumerator() | Where-Object { $_.Value -eq $v } | Select-Object -First 1).Key
            }
            return [ordered]@{ vendor = $m; ac = if ($ac -ge 0) { [bool]$ac } else { $null } }
        }
        'chargelimit' {
            if ($Vendor -ne 'asus') { throw 'Limite de charge réglable seulement sur ROG Ally pour l''instant' }
            $p = [Math]::Max(40, [Math]::Min(100, [int]$c.value))
            $null = [KaneMode.Asus]::Set([KaneMode.Asus]::ChargeLimit, $p)
            $read = [KaneMode.Asus]::Get([KaneMode.Asus]::ChargeLimit)
            if ($read -ge 20 -and $read -le 100) { return @{ chargeLimit = $read; verified = $true } }
            return @{ chargeLimit = $p; verified = $false }
        }
        default { throw "Commande inconnue : $($c.cmd)" }
    }
}

[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
    $req = $null
    try {
        $req = $line | ConvertFrom-Json
        $data = Run $req
        $out = @{ id = $req.id; ok = $true; data = $data }
    } catch {
        $out = @{ id = if ($req) { $req.id } else { $null }; ok = $false; error = $_.Exception.Message }
    }
    [Console]::Out.WriteLine(($out | ConvertTo-Json -Depth 6 -Compress))
}
