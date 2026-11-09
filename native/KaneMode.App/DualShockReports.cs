namespace KaneMode;

/// <summary>Manettes lues par leurs rapports bruts (formats propres au fabricant, décodés ici).</summary>
internal enum PadKind { XInput, DualShock4, DualSense, Nintendo, JoyCon }

// Formats des rapports DualShock 4, DualSense et Nintendo (Pro Controller, Joy-Con), en USB et en
// Bluetooth, vérifiés dans les pilotes HID officiels de SDL2 :
// https://github.com/libsdl-org/SDL/blob/SDL2/src/joystick/hidapi/SDL_hidapi_ps4.c
// https://github.com/libsdl-org/SDL/blob/SDL2/src/joystick/hidapi/SDL_hidapi_ps5.c
// https://github.com/libsdl-org/SDL/blob/SDL2/src/joystick/hidapi/SDL_hidapi_switch.c
// Lecture seule : KaneMode n'envoie rien à la manette (l'émulateur, Steam ou WebView2 peuvent la régler
// en même temps ; chaque format qu'ils choisissent est décodé).
// Disposition XInput par position : le bouton du bas est A (B chez Nintendo), celui de droite B (A chez
// Nintendo). − = Select (View), + = Start (Menu), Home = Guide.
internal static class DualShockReports
{
    private static readonly ushort[] Face = { 0x4000, 0x1000, 0x2000, 0x8000 };
    private static readonly ushort[] Extra = { 0x100, 0x200, 0, 0, 0x20, 0x10, 0x40, 0x80 };
    private const ushort BACK = 0x20, START = 0x10, GUIDE = 0x400, LS = 0x40, RS = 0x80, LB = 0x100, RB = 0x200,
        A = 0x1000, B = 0x2000, X = 0x4000, Y = 0x8000, UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8;

    public static bool Candidate(string path) =>
        path.Contains("vid_054c", StringComparison.OrdinalIgnoreCase) || path.Contains("vid&0002054c", StringComparison.OrdinalIgnoreCase) ||
        path.Contains("vid_057e", StringComparison.OrdinalIgnoreCase) || path.Contains("vid&0002057e", StringComparison.OrdinalIgnoreCase);

    /// <summary>Manette reconnue par son fabricant et son modèle ; XInput sinon (non décodée ici).</summary>
    public static PadKind Kind(ushort vendor, ushort product) => (vendor, product) switch
    {
        (0x054c, 0x05c4 or 0x09cc) => PadKind.DualShock4,
        (0x054c, 0x0ce6 or 0x0df2) => PadKind.DualSense,
        (0x057e, 0x2009 or 0x200e) => PadKind.Nintendo, // Pro Controller, Joy-Con dans la poignée de recharge (USB)
        (0x057e, 0x2006 or 0x2007) => PadKind.JoyCon,    // Joy-Con gauche ou droit seul (Bluetooth)
        _ => PadKind.XInput,
    };

    public static bool IsSony(PadKind k) => k is PadKind.DualShock4 or PadKind.DualSense;

    /// <param name="bluetooth">Manette reliée en Bluetooth (chemin « {00001124-… »).</param>
    public static bool TryRead(PadKind kind, bool bluetooth, ReadOnlySpan<byte> report, out HidGamepads.XState state)
    {
        state = default;
        if (report.Length == 0) return false;
        return kind switch
        {
            PadKind.DualShock4 => report[0] == 1 ? Ds4(report.Slice(1), out state) : report[0] is >= 0x11 and <= 0x19 && Ds4(report.Slice(3), out state),
            // DualSense : USB 0x01 et Bluetooth 0x31 au format complet ; Bluetooth 0x01 (avant tout réglage) au format DualShock 4
            PadKind.DualSense => report[0] == 0x31 ? Ds5(report.Slice(2), out state) : report[0] == 1 && (bluetooth ? Ds4(report.Slice(1), out state) : Ds5(report.Slice(1), out state)),
            PadKind.Nintendo or PadKind.JoyCon => Switch(kind, report, out state),
            _ => false,
        };
    }

    private static short Axis8(byte b, bool invert = false) { double v = (b - 128) / (b < 128 ? 128.0 : 127.0); return (short)Math.Round(v * (invert ? -32767 : 32767)); }
    private static ushort Hat(int h) => h switch { 0 => UP, 1 => UP | RIGHT, 2 => RIGHT, 3 => DOWN | RIGHT, 4 => DOWN, 5 => DOWN | LEFT, 6 => LEFT, 7 => UP | LEFT, _ => 0 };

    // DualShock 4 (et DualSense Bluetooth simple) : LX LY RX RY, croix + faces, épaules…, PS, L2, R2
    private static bool Ds4(ReadOnlySpan<byte> p, out HidGamepads.XState state)
    {
        state = default;
        if (p.Length < 9) return false;
        state.LX = Axis8(p[0]); state.LY = Axis8(p[1], true); state.RX = Axis8(p[2]); state.RY = Axis8(p[3], true);
        state.LT = p[7]; state.RT = p[8];
        Buttons(ref state, p[4], p[5], p[6]);
        return true;
    }

    // DualSense complet : LX LY RX RY, L2, R2, compteur, croix + faces, épaules…, PS
    private static bool Ds5(ReadOnlySpan<byte> p, out HidGamepads.XState state)
    {
        state = default;
        if (p.Length < 10) return false;
        state.LX = Axis8(p[0]); state.LY = Axis8(p[1], true); state.RX = Axis8(p[2]); state.RY = Axis8(p[3], true);
        state.LT = p[4]; state.RT = p[5];
        Buttons(ref state, p[7], p[8], p[9]);
        return true;
    }

    private static void Buttons(ref HidGamepads.XState state, byte faces, byte extra, byte ps)
    {
        for (int i = 0; i < 4; i++) if ((faces & (0x10 << i)) != 0) state.Buttons |= Face[i];
        for (int i = 0; i < 8; i++) if ((extra & (1 << i)) != 0) state.Buttons |= Extra[i];
        if ((ps & 1) != 0) state.Buttons |= GUIDE;
        state.Buttons |= Hat(faces & 15);
    }

    // Nintendo : rapport complet (0x30 à 0x33, réglé par l'émulateur, Steam ou WebView2) ou simple
    // (0x3F, celui du Bluetooth tant que personne n'a rien réglé).
    private static bool Switch(PadKind kind, ReadOnlySpan<byte> r, out HidGamepads.XState state)
    {
        state = default;
        if (r[0] is >= 0x30 and <= 0x33 && r.Length >= 12)
        {
            byte right = r[3], shared = r[4], left = r[5];
            if ((right & 0x04) != 0) state.Buttons |= A;      // B (bas)
            if ((right & 0x08) != 0) state.Buttons |= B;      // A (droite)
            if ((right & 0x01) != 0) state.Buttons |= X;      // Y (gauche)
            if ((right & 0x02) != 0) state.Buttons |= Y;      // X (haut)
            if ((right & 0x40) != 0) state.Buttons |= RB;
            if ((right & 0x80) != 0) state.RT = 255;          // ZR
            if ((left & 0x40) != 0) state.Buttons |= LB;
            if ((left & 0x80) != 0) state.LT = 255;           // ZL
            if ((left & 0x01) != 0) state.Buttons |= DOWN;
            if ((left & 0x02) != 0) state.Buttons |= UP;
            if ((left & 0x04) != 0) state.Buttons |= RIGHT;
            if ((left & 0x08) != 0) state.Buttons |= LEFT;
            SharedButtons(ref state, shared, rightStick: 0x04, leftStick: 0x08);
            // Sticks sur 12 bits, centre vers 2048, haut positif ; un Joy-Con seul n'a qu'un stick (l'autre reste à 0)
            int lx = r[6] | ((r[7] & 0x0F) << 8), ly = (r[7] >> 4) | (r[8] << 4);
            int rx = r[9] | ((r[10] & 0x0F) << 8), ry = (r[10] >> 4) | (r[11] << 4);
            if (lx != 0 || ly != 0) { state.LX = S12(lx); state.LY = S12(ly); }
            if (rx != 0 || ry != 0) { state.RX = S12(rx); state.RY = S12(ry); }
            return true;
        }
        if (r[0] == 0x3F && r.Length >= 4)
        {
            byte b0 = r[1], b1 = r[2];
            if (kind == PadKind.Nintendo)
            {
                if ((b0 & 0x01) != 0) state.Buttons |= A;
                if ((b0 & 0x02) != 0) state.Buttons |= B;
                if ((b0 & 0x04) != 0) state.Buttons |= X;
                if ((b0 & 0x08) != 0) state.Buttons |= Y;
                if ((b0 & 0x10) != 0) state.Buttons |= LB;
                if ((b0 & 0x20) != 0) state.Buttons |= RB;
                if ((b0 & 0x40) != 0) state.LT = 255;
                if ((b0 & 0x80) != 0) state.RT = 255;
                state.Buttons |= Hat(r[3]);
                if (r.Length >= 12)
                {
                    // Sticks sur 16 bits, centre vers 32768, bas positif
                    state.LX = S16(r[4] | (r[5] << 8), false); state.LY = S16(r[6] | (r[7] << 8), true);
                    state.RX = S16(r[8] | (r[9] << 8), false); state.RY = S16(r[10] | (r[11] << 8), true);
                }
                SharedButtons(ref state, b1, rightStick: 0x08, leftStick: 0x04);
            }
            else
            {
                // Joy-Con seul, tenu en long : seuls −, + et Home comptent (même octet pour les deux)
                SharedButtons(ref state, b1, rightStick: 0, leftStick: 0);
            }
            return true;
        }
        return false;
    }

    // Sans le calibrage d'usine (il faudrait l'écrire à la manette), le centre varie d'une manette à
    // l'autre (2253/1833 mesurés au repos sur une Pro Controller) : zone morte large, puis pleine course.
    private static short S12(int v) => Dead((v - 2048) / 1500.0);
    private static short S16(int v, bool invert) => Dead((v - 32768) / 32768.0 * (invert ? -1 : 1));
    private static short Dead(double d)
    {
        const double dz = 0.22;
        double a = Math.Abs(d);
        if (a < dz) return 0;
        return (short)Math.Round(Math.Sign(d) * Math.Min(1, (a - dz) / (1 - dz)) * 32767);
    }

    private static void SharedButtons(ref HidGamepads.XState state, byte shared, byte rightStick, byte leftStick)
    {
        if ((shared & 0x01) != 0) state.Buttons |= BACK;   // −
        if ((shared & 0x02) != 0) state.Buttons |= START;  // +
        if ((shared & 0x10) != 0) state.Buttons |= GUIDE;  // Home
        if (rightStick != 0 && (shared & rightStick) != 0) state.Buttons |= RS;
        if (leftStick != 0 && (shared & leftStick) != 0) state.Buttons |= LS;
    }
}
