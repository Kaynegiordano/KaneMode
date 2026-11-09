// Décodage des rapports bruts des manettes (DualShockReports) : Select + Start et boutons principaux
// pour chaque format (Pro Controller et Joy-Con USB/Bluetooth, DualSense USB/Bluetooth, DualShock 4).
// « live » : lit en plus les vraies manettes branchées pendant 8 s (lecture seule) et affiche leur état.
using KaneMode;

const ushort BACK = 0x20, START = 0x10, A = 0x1000, B = 0x2000, GUIDE = 0x400, UP = 1;
int fails = 0;
void Check(string name, PadKind kind, bool bt, byte[] report, ushort mustHave, ushort mustNot = 0)
{
    bool ok = DualShockReports.TryRead(kind, bt, report, out var s) && (s.Buttons & mustHave) == mustHave && (s.Buttons & mustNot) == 0;
    Console.WriteLine($"{(ok ? "ok  " : "ÉCHEC")} {name} → boutons 0x{s.Buttons:X4} LX {s.LX} LY {s.LY}");
    if (!ok) fails++;
}
byte[] R(params int[] b) { var a = new byte[64]; for (int i = 0; i < b.Length; i++) a[i] = (byte)b[i]; return a; }

// Pro Controller, rapport complet (vrai rapport USB au repos, puis − et + appuyés)
Check("Pro 0x30 repos", PadKind.Nintendo, false, R(0x30, 0x0F, 0x81, 0x00, 0x80, 0x00, 0xCD, 0x98, 0x72, 0xB7, 0x27, 0x76), 0, BACK | START | A | B);
Check("Pro 0x30 − +", PadKind.Nintendo, false, R(0x30, 0x0F, 0x81, 0x00, 0x83, 0x00, 0xCD, 0x98, 0x72, 0xB7, 0x27, 0x76), BACK | START);
Check("Pro 0x30 B(bas)=A, Home", PadKind.Nintendo, true, R(0x30, 0, 0, 0x04, 0x10, 0x02, 0, 0x08, 0x80, 0, 0x08, 0x80), A | GUIDE | UP, B);
// Pro Controller en Bluetooth, rapport simple (avant tout réglage)
Check("Pro 0x3F − +", PadKind.Nintendo, true, R(0x3F, 0x00, 0x03, 0x08, 0, 0x80, 0, 0x80, 0, 0x80, 0, 0x80), BACK | START, A | B | UP);
Check("Pro 0x3F A(droite)=B, haut", PadKind.Nintendo, true, R(0x3F, 0x02, 0x00, 0x00, 0, 0x80, 0, 0x80, 0, 0x80, 0, 0x80), B | UP, A | BACK);
// Joy-Con seuls (Bluetooth, simple) : − à gauche, + à droite
Check("Joy-Con G −", PadKind.JoyCon, true, R(0x3F, 0x00, 0x01, 0x08), BACK, START);
Check("Joy-Con D +", PadKind.JoyCon, true, R(0x3F, 0x00, 0x02, 0x08), START, BACK);
// DualSense : USB, Bluetooth complet, Bluetooth simple
Check("DualSense USB Create+Options", PadKind.DualSense, false, R(0x01, 128, 128, 128, 128, 0, 0, 1, 0x08, 0x30, 0), BACK | START, UP);
Check("DualSense BT 0x31 Create+Options", PadKind.DualSense, true, R(0x31, 0x10, 128, 128, 128, 128, 0, 0, 1, 0x08, 0x30, 0), BACK | START, UP);
Check("DualSense BT 0x31 croix(bas)=A, PS", PadKind.DualSense, true, R(0x31, 0x10, 128, 128, 128, 128, 0, 0, 1, 0x28, 0x00, 0x01), A | GUIDE);
Check("DualSense BT 0x01 simple", PadKind.DualSense, true, R(0x01, 128, 128, 128, 128, 0x08, 0x30, 0, 0, 0), BACK | START);
// DualShock 4 : USB et Bluetooth
Check("DualShock 4 USB Share+Options", PadKind.DualShock4, false, R(0x01, 128, 128, 128, 128, 0x08, 0x30, 0, 0, 0), BACK | START);
Check("DualShock 4 BT 0x11 Share+Options", PadKind.DualShock4, true, R(0x11, 0xC0, 0x00, 128, 128, 128, 128, 0x08, 0x30, 0, 0, 0), BACK | START);
Console.WriteLine(fails == 0 ? "Décodage : tout passe" : $"Décodage : {fails} échec(s)");

if (args.Contains("live"))
{
    using var hid = new HidGamepads();
    hid.Start();
    for (int t = 0; t < 8; t++)
    {
        Thread.Sleep(1000);
        for (int k = 0; k < HidGamepads.Max; k++) if (hid.Snapshot(k, out var s)) Console.WriteLine($"  {t + 1} s, manette {k} : boutons 0x{s.Buttons:X4} LX {s.LX} LY {s.LY} RX {s.RX} RY {s.RY} — {hid.Describe(k)}");
    }
}
return fails == 0 ? 0 : 1;

namespace KaneMode
{
    public static class Log { public static void Write(string m) => Console.WriteLine("  [journal] " + m); }
}
