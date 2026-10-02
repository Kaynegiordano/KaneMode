using System.Reflection;
namespace KaneMode;
internal static class Native
{
    public const uint MOUSE_MOVE = 1, LEFT_DOWN = 2, LEFT_UP = 4, RIGHT_DOWN = 8, RIGHT_UP = 16,
        MIDDLE_DOWN = 32, MIDDLE_UP = 64, X_DOWN = 128, X_UP = 256, WHEEL = 2048, HWHEEL = 4096;
    public static bool Interactive = true;
    public static List<(uint Flags, int X, int Y, int Data)> Events = new();
    public static bool Mouse(uint flags, int dx = 0, int dy = 0, int data = 0) { Events.Add((flags, dx, dy, data)); return true; }
    public static bool InteractiveDesktop() => Interactive;
}
internal static class Log { public static void Write(string text) { } }
// Raw Input demande WPF (fenêtre cachée) : le banc d'essai n'en a pas besoin
internal sealed class RawInputSink : IDisposable { public RawInputSink(Action<string, byte[]> report) { } public void Dispose() { } }
internal static class Program
{
    private static void Check(bool ok, string text) { if (!ok) throw new Exception(text); }
    private static byte[] Usb(byte face = 8, byte extra = 0) => new byte[] { 1, 128, 128, 128, 128, face, extra, 0, 0, 0 };
    public static void Main()
    {
        var mouse = new GamepadMouse(Native.Mouse); mouse.SetActive(true);
        mouse.Step(0, 0, 0, 1000, 8, true);
        mouse.Step(0x1000, 32767, 0, 1008, 8, true);
        Check(Native.Events.Count(e => e.Flags == Native.LEFT_DOWN) == 1 && Native.Events.Any(e => e.Flags == Native.MOUSE_MOVE && e.X > 0), "Déplacement et clic");
        // Le premier plan ne fait pas partie de la souris : le clic reste tenu pendant un glissé entre fenêtres.
        mouse.Step(0x1000, 32767, 0, 1016, 8, true); mouse.Step(0, 0, 0, 1024, 8, true);
        Check(Native.Events.Count(e => e.Flags == Native.LEFT_DOWN) == 1 && Native.Events.Count(e => e.Flags == Native.LEFT_UP) == 1, "Glissé sans nouveau clic après changement de fenêtre");
        foreach (var (button, down, up, data) in new[] { (0x2000, Native.RIGHT_DOWN, Native.RIGHT_UP, 0), (0x4000, Native.MIDDLE_DOWN, Native.MIDDLE_UP, 0), (0x100, Native.X_DOWN, Native.X_UP, 1), (0x200, Native.X_DOWN, Native.X_UP, 2) })
        {
            Native.Events.Clear(); mouse.Step((ushort)button, 0, 0, 1100, 8, true); mouse.Step(0, 0, 0, 1108, 8, true);
            Check(Native.Events.Select(e => (e.Flags, e.Data)).SequenceEqual(new[] { (down, data), (up, data) }), "Autres clics et boutons précédent/suivant");
        }
        Native.Events.Clear(); mouse.Step(1, 0, 0, 2000, 8, true); mouse.Step(1, 0, 0, 2200, 8, true); mouse.Step(1, 0, 0, 2350, 8, true);
        Check(Native.Events.Count(e => e.Flags == Native.WHEEL) == 2, "Molette et délai de répétition");
        mouse.Step(0, 0, 0, 2400, 8, true); Native.Events.Clear();
        mouse.Step(0x1000, 0, 0, 2500, 8, true); mouse.Pause();
        Check(Native.Events.Last().Flags == Native.LEFT_UP, "Verrouillage : clic relâché");
        Native.Events.Clear(); mouse.Step(0x1000, 32767, 0, 2600, 8, false); Check(Native.Events.Count == 0, "Aucune entrée sur le bureau sécurisé");
        mouse.Step(0x1000, 0, 0, 2700, 8, true); Check(Native.Events.Count == 0, "Clic tenu au déverrouillage ignoré");
        mouse.Step(0, 0, 0, 2710, 8, true); mouse.Step(0x1000, 0, 0, 2720, 8, true); mouse.SetActive(false);
        Check(Native.Events.Last().Flags == Native.LEFT_UP, "Arrêt : aucun bouton laissé enfoncé");
        Native.Events.Clear(); mouse.Step(0, 32767, 0, 2800, 8, true); Check(Native.Events.Count == 0, "Arrêt persistant");
        bool accept = false; var rejected = new List<uint>(); var retry = new GamepadMouse((f, x, y, d) => { rejected.Add(f); return accept; });
        retry.SetActive(true); retry.Step(0, 0, 0, 3000, 8, true); retry.Step(0x1000, 0, 0, 3010, 8, true);
        accept = true; retry.Step(0x1000, 0, 0, 3020, 8, true);
        Check(rejected.Count(f => f == Native.LEFT_DOWN) == 1, "Un clic refusé ne fuit pas dans la fenêtre suivante");
        retry.Step(0, 0, 0, 3030, 8, true); retry.Step(0x1000, 0, 0, 3040, 8, true);
        Check(rejected.Count(f => f == Native.LEFT_DOWN) == 2, "Un nouvel appui peut réessayer après un refus");
        Check(DualShockReports.TryRead(Usb(), out var neutral) && neutral.Buttons == 0 && neutral.LX == 0, "DualShock USB neutre");
        Check(DualShockReports.TryRead(Usb(0x28, 0x20), out var ds4) && ds4.Buttons == 0x1010, "DualShock : Croix et Options");
        var bt = new byte[78]; bt[0] = 0x11; Usb(0x58, 0x13).AsSpan(1).CopyTo(bt.AsSpan(3));
        Check(DualShockReports.TryRead(bt, out var wireless) && wireless.Buttons == 0x6320, "DualShock Bluetooth : boutons et épaules");
        var axes = Usb(); axes[1] = 0; axes[2] = 0; axes[3] = 255; axes[4] = 255; axes[8] = 255;
        Check(DualShockReports.TryRead(axes, out var limits) && limits.LX == -32767 && limits.LY == 32767 && limits.RX == 32767 && limits.RY == -32767 && limits.LT == 255, "DualShock : axes, inversion Y et gâchette");
        Check(!DualShockReports.TryRead(new byte[] { 1, 128 }, out _) && !DualShockReports.Device(0x054c, 0x0ce6), "Rapport tronqué et disposition inconnue refusés");
        // Le lecteur réel reçoit un relais simulé ; aucune manette ni entrée Windows réelle utilisée.
        XInputPads.Focus focus = XInputPads.Focus.Ours; using var pads = new XInputPads(() => focus);
        pads.SetMouseMode(true, "test"); Native.Events.Clear();
        var read = typeof(XInputPads).GetMethod("ReadOthers", BindingFlags.NonPublic | BindingFlags.Instance)!;
        var step = typeof(XInputPads).GetMethod("MouseStep", BindingFlags.NonPublic | BindingFlags.Instance)!;
        long tick = Environment.TickCount64;
        pads.SetUiPad(0, 0, 0, 0, 0); read.Invoke(pads, new object[] { tick }); step.Invoke(pads, new object[] { tick, 8.0 });
        foreach (var f in Enum.GetValues<XInputPads.Focus>())
        {
            focus = f; tick += 8; pads.SetUiPad(0, 0, 0, 1, 0); read.Invoke(pads, new object[] { tick }); step.Invoke(pads, new object[] { tick, 8.0 });
            Check(pads.MouseMode && Native.Events.Last().Flags == Native.MOUSE_MOVE, "Mode souris conservé dans " + f);
        }
        focus = XInputPads.Focus.Ours; Native.Events.Clear();
        pads.SetUiPad(0x1001, 1, 0, 0, 0); read.Invoke(pads, new object[] { tick }); step.Invoke(pads, new object[] { tick, 8.0 });
        Check(Native.Events.Count == 0, "Dans KaneMode, stick gauche et boutons réservés à la navigation");
        pads.SetUiPad(0x1001, 0, 0, 1, 0); read.Invoke(pads, new object[] { tick }); step.Invoke(pads, new object[] { tick, 8.0 });
        Check(Native.Events.All(e => e.Flags == Native.MOUSE_MOVE) && Native.Events.Count > 0, "Stick droit actif sans double clic ni double défilement");
        focus = XInputPads.Focus.Other; Native.Events.Clear();
        step.Invoke(pads, new object[] { tick, 8.0 });
        Check(!Native.Events.Any(e => e.Flags == Native.LEFT_DOWN), "Un bouton tenu en quittant KaneMode ne devient pas un clic");
        pads.SetUiPad(0, 0, 0, 0, 0); read.Invoke(pads, new object[] { tick }); step.Invoke(pads, new object[] { tick, 8.0 });
        // Régression : une manette native connectée mais muette ne doit pas éliminer les axes reçus.
        var hid = (HidGamepads)typeof(XInputPads).GetField("_hid", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(pads)!;
        var connected = (bool[])typeof(HidGamepads).GetField("Connected", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(hid)!;
        var sony = (bool[])typeof(HidGamepads).GetField("_sony", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(hid)!;
        var states = (HidGamepads.XState[])typeof(HidGamepads).GetField("States", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(hid)!;
        var navigation = typeof(XInputPads).GetMethod("NavigationJson", BindingFlags.NonPublic | BindingFlags.Instance)!;
        connected[0] = true; states[0] = new HidGamepads.XState { Buttons = 0x1000, LX = 32767, LT = 255 };
        read.Invoke(pads, new object[] { tick });
        using (var feed = System.Text.Json.JsonDocument.Parse((string)navigation.Invoke(pads, new object[] { XInputPads.Focus.Ours })!))
        {
            var pad = feed.RootElement[0];
            Check(pad.GetProperty("b").GetInt32() == 0x1000 && pad.GetProperty("lx").GetDouble() == 1 && pad.GetProperty("lt").GetInt32() == 255, "Manette native envoyée intacte pendant le mode souris");
        }
        Check((string)navigation.Invoke(pads, new object[] { XInputPads.Focus.Other })! == "[]", "Aucune navigation native derrière une autre fenêtre");
        states[0] = default; connected[0] = false;
        foreach (var source in new[] { "Xbox 360 Controller (XInput STANDARD GAMEPAD)", "DualShock 4 (054c:09cc)" })
        {
            connected[0] = true; sony[0] = source.StartsWith("DualShock"); Native.Events.Clear();
            tick = Environment.TickCount64; pads.SetUiPad(0x1000, 1, 0, 0, 0, source);
            read.Invoke(pads, new object[] { tick }); step.Invoke(pads, new object[] { tick, 8.0 });
            Check(Native.Events.Any(e => e.Flags == Native.MOUSE_MOVE), "La source native muette ne bloque pas les axes de " + source);
            connected[0] = false;
            read.Invoke(pads, new object[] { tick }); step.Invoke(pads, new object[] { tick, 8.0 });
            Check(Native.Events.Any(e => e.Flags == Native.MOUSE_MOVE), "Relais disponible en l’absence de source native : " + source);
            pads.SetUiPad(0, 0, 0, 0, 0, source); read.Invoke(pads, new object[] { tick }); step.Invoke(pads, new object[] { tick, 8.0 });
        }
        var sources = new MouseSources(3);
        sources.Update(0, true, default); sources.Update(1, true, new(0, 20000, 0));
        Check(sources.Current.X == 20000, "Source native inactive et vrai stick relayé");
        sources.Update(0, true, new(0, 22000, 0)); sources.Update(1, true, new(0, 20000, 0));
        Check(sources.Selected == 0, "Un état répété ne supplante pas une nouvelle commande native");
        sources.Update(0, true, default); sources.Update(1, true, new(0, 20000, 0));
        Check(sources.Current.X == 0, "Le relâchement natif arrête la copie relayée retardée");
        sources.Update(1, true, new(0, -24000, 0));
        Check(sources.Current.X == -24000, "Une nouvelle commande relayée est reçue");
        sources.Update(1, false, default);
        Check(sources.Current == default, "Un relais expiré arrête le curseur");
        sources.Update(0, true, new(0, 21000, 0)); sources.Update(1, true, new(0, 23000, 0)); sources.Update(1, false, default);
        Check(sources.Current.X == 21000, "Une source native active prend le relais après expiration de WebView2");
        var ranged = new HidGamepads.HIDP_VALUE_CAPS { UsagePage = 1, ReportID = 2, IsRange = 1, UsageMin = 0x30, UsageMax = 0x34, LogicalMin = 0, LogicalMax = 65535, BitSize = 16, LinkCollection = 3 };
        var single = ranged; single.ReportID = 3; single.IsRange = 0; single.UsageMin = 0x33; single.LogicalMin = -32768; single.LogicalMax = 32767;
        var ranges = HidGamepads.ExpandRanges(new[] { ranged, single });
        Check(ranges.Count == 6 && ranges[(2, 0x34)].Link == 3, "Tous les axes d’une plage HID et leur collection sont conservés");
        Check(System.Runtime.InteropServices.Marshal.SizeOf<HidGamepads.HIDP_VALUE_CAPS>() == 72, "Structure HID conforme au format Windows");
        Check(HidGamepads.NormalizeAxis(65535, ranges[(2, 0x33)], false) == 32767 && HidGamepads.NormalizeAxis(0, ranges[(2, 0x34)], true) == 32767, "Stick droit déclaré en plage et inversion Y");
        Check(HidGamepads.NormalizeAxis(0x8000, ranges[(3, 0x33)], false) == -32767 && Math.Abs(HidGamepads.NormalizeAxis(0, ranges[(3, 0x33)], false)) <= 1, "Extension du signe des axes HID, négatif et neutre");
        var calls = new List<(ushort Link, ushort Usage)>();
        var decoded = HidGamepads.ApplyValues(default, 2, ranges, (link, usage) => { calls.Add((link, usage)); return usage == 0x33 ? 65535u : 32768u; });
        Check(decoded.RX == 32767 && calls.Contains((3, 0x33)) && calls.Contains((3, 0x34)), "Décodage du rapport : le stick droit et sa collection atteignent le lecteur");
        var preserved = HidGamepads.ApplyValues(decoded, 9, ranges, (_, _) => throw new Exception("Rapport sans axe"));
        Check(preserved.RX == decoded.RX, "Un autre rapport ne remet pas les axes au neutre");
        var decodedMouse = new GamepadMouse(Native.Mouse); decodedMouse.SetActive(true); Native.Events.Clear();
        decodedMouse.Step(0, decoded.RX, decoded.RY, tick, 8, true);
        Check(Native.Events.Any(e => e.Flags == Native.MOUSE_MOVE && e.X > 0), "Chaîne capacités HID → lecture du stick droit → mouvement souris");
        Console.WriteLine("PASS Axes simulés en amont : source inactive, relais frais/expiré, doublons retardés, plages HID, valeurs signées et conversion en mouvement.");
        Console.WriteLine("PASS Souris globale : fenêtres, déplacement, glissé, clics, molette, refus, verrouillage et arrêt.");
        Console.WriteLine("PASS DualShock USB/Bluetooth : rapports, axes, boutons, gâchettes et refus de formats inconnus.");
    }
}
