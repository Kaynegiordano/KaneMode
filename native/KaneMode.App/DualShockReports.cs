namespace KaneMode;

// Format des rapports DualShock 4 USB/Bluetooth, vérifié dans le pilote HID officiel SDL2.
// https://github.com/libsdl-org/SDL/blob/SDL2/src/joystick/hidapi/SDL_hidapi_ps4.c
internal static class DualShockReports
{
    private static readonly ushort[] Face = { 0x4000, 0x1000, 0x2000, 0x8000 };
    private static readonly ushort[] Extra = { 0x100, 0x200, 0, 0, 0x20, 0x10, 0x40, 0x80 };
    public static bool Device(ushort vendor, ushort product) => vendor == 0x054c && product is 0x05c4 or 0x09cc;
    public static bool Candidate(string path) => path.Contains("vid_054c", StringComparison.OrdinalIgnoreCase) || path.Contains("vid&0002054c", StringComparison.OrdinalIgnoreCase);
    public static bool TryRead(ReadOnlySpan<byte> report, out HidGamepads.XState state)
    {
        state = default;
        if (report.Length == 0) return false;
        int offset = report[0] == 1 ? 1 : report[0] is >= 0x11 and <= 0x19 ? 3 : -1;
        if (offset < 0 || report.Length < offset + 9) return false;
        var p = report.Slice(offset);
        static short Axis(byte b, bool invert = false) { double v = (b - 128) / (b < 128 ? 128.0 : 127.0); return (short)Math.Round(v * (invert ? -32767 : 32767)); }
        state.LX = Axis(p[0]); state.LY = Axis(p[1], true); state.RX = Axis(p[2]); state.RY = Axis(p[3], true);
        state.LT = p[7]; state.RT = p[8];
        for (int i = 0; i < 4; i++) if ((p[4] & (0x10 << i)) != 0) state.Buttons |= Face[i];
        for (int i = 0; i < 8; i++) if ((p[5] & (1 << i)) != 0) state.Buttons |= Extra[i];
        if ((p[6] & 1) != 0) state.Buttons |= 0x400; // bouton PS, disposition standard XInput
        state.Buttons |= (p[4] & 15) switch { 0 => (ushort)1, 1 => (ushort)9, 2 => (ushort)8, 3 => (ushort)10, 4 => (ushort)2, 5 => (ushort)6, 6 => (ushort)4, 7 => (ushort)5, _ => (ushort)0 };
        return true;
    }
}
