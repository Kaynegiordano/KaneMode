namespace KaneMode;

/// <summary>
/// Souris globale : aucune dépendance au premier plan de KaneMode, boutons relâchés à l'arrêt.
/// A : clic gauche (maintenu : glisser) ; B : précédent ; Y : clic droit ; LB : clic du milieu ; RB : suivant ;
/// X maintenu : le stick fait défiler au lieu de déplacer le curseur ; croix : molette par crans.
/// </summary>
internal sealed class GamepadMouse
{
    private const ushort A = 0x1000, B = 0x2000, X = 0x4000, Y = 0x8000, LB = 0x100, RB = 0x200,
        UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8, MOUSE_BUTTONS = A | B | X | Y | LB | RB;
    // Défilement au stick : unités de molette (120 = un cran) par pas, relativement à la courbe du curseur
    private const double SCROLL_GAIN = 1.5;
    private const int SCROLL_STEP = 20;
    private readonly Func<uint, int, int, int, bool> _send;
    private readonly object _lock = new();
    private bool _active, _neutral;
    private ushort _held, _pad, _rejected;
    private double _restX, _restY, _scrollX, _scrollY;
    private long _wheelNext, _lastFailure = -30000;
    private long _movesAccepted, _movesRejected;
    public (long Accepted, long Rejected) MovementCounts { get { lock (_lock) return (_movesAccepted, _movesRejected); } }
    public GamepadMouse(Func<uint, int, int, int, bool> send) { _send = send; }
    public void SetActive(bool active)
    {
        lock (_lock)
        {
            if (active == _active) return;
            _active = active; _neutral = true; _restX = _restY = _scrollX = _scrollY = 0;
            if (!active) Release();
        }
    }
    public void Pause() { lock (_lock) { Release(); _neutral = true; _restX = _restY = _scrollX = _scrollY = 0; } }
    public void Step(ushort buttons, int sx, int sy, long now, double dt, bool interactive, bool buttonsEnabled = true)
    {
        lock (_lock)
        {
            if (!_active || !interactive) { Release(); _neutral = true; return; }
            // Pas de clic ni de défilement tenu provenant de l'activation ou du verrouillage : il faut d'abord
            // avoir vu les boutons relâchés.
            if (buttonsEnabled && (buttons & (MOUSE_BUTTONS | 15)) == 0) _neutral = false;
            bool scrolling = buttonsEnabled && !_neutral && (buttons & X) != 0;
            if (scrolling)
            {
                _restX = _restY = 0; // le curseur reste en place
                Scroll(sx, sy, dt, now);
            }
            else
            {
                _scrollX = _scrollY = 0;
                _restX += Speed(sx) * Math.Clamp(dt, 0, 50) / 50;
                _restY -= Speed(sy) * Math.Clamp(dt, 0, 50) / 50;
                int dx = (int)_restX, dy = (int)_restY;
                _restX -= dx; _restY -= dy;
                if (dx != 0 || dy != 0) Send(Native.MOUSE_MOVE, dx, dy, 0, now);
            }
            // Dans KaneMode, les boutons servent à naviguer : aucun second clic ou défilement.
            if (!buttonsEnabled) { Release(); _neutral = true; return; }
            if (_neutral) buttons = 0;
            _rejected &= buttons;
            buttons = (ushort)(buttons & ~_rejected); // Un clic refusé attend un nouvel appui volontaire.
            Button(buttons, A, Native.LEFT_DOWN, Native.LEFT_UP, 0, now);
            Button(buttons, Y, Native.RIGHT_DOWN, Native.RIGHT_UP, 0, now);
            Button(buttons, LB, Native.MIDDLE_DOWN, Native.MIDDLE_UP, 0, now);
            Button(buttons, B, Native.X_DOWN, Native.X_UP, 1, now);
            Button(buttons, RB, Native.X_DOWN, Native.X_UP, 2, now);
            ushort pad = (ushort)(buttons & 15);
            bool fresh = (pad & ~_pad) != 0;
            if (pad == 0) _wheelNext = 0;
            else if (fresh || now >= _wheelNext)
            {
                if ((pad & UP) != 0) Send(Native.WHEEL, 0, 0, 120, now);
                if ((pad & DOWN) != 0) Send(Native.WHEEL, 0, 0, -120, now);
                if ((pad & RIGHT) != 0) Send(Native.HWHEEL, 0, 0, 120, now);
                if ((pad & LEFT) != 0) Send(Native.HWHEEL, 0, 0, -120, now);
                _wheelNext = now + (fresh ? 350 : 90);
            }
            _pad = pad;
        }
    }
    /// <summary>X maintenu : le stick fait défiler (haut : le contenu monte), de plus en plus vite quand on pousse.</summary>
    private void Scroll(int sx, int sy, double dt, long now)
    {
        double step = Math.Clamp(dt, 0, 50) / 50 * SCROLL_GAIN;
        _scrollY += Speed(sy) * step;
        _scrollX += Speed(sx) * step;
        int y = (int)_scrollY, x = (int)_scrollX;
        if (Math.Abs(y) >= SCROLL_STEP) { Send(Native.WHEEL, 0, 0, y, now); _scrollY -= y; }
        if (Math.Abs(x) >= SCROLL_STEP) { Send(Native.HWHEEL, 0, 0, x, now); _scrollX -= x; }
    }
    private static double Speed(int raw)
    {
        double v = Math.Pow(Math.Clamp(raw, -32767, 32767) / 32767.0 * 4, 3);
        return Math.Abs(v) > 2 ? v - Math.Sign(v) * 2 : 0;
    }
    private bool Send(uint flags, int dx, int dy, int data, long now)
    {
        bool ok = _send(flags, dx, dy, data);
        if (flags == Native.MOUSE_MOVE && (dx != 0 || dy != 0)) { if (ok) _movesAccepted++; else _movesRejected++; }
        if (!ok && now - _lastFailure >= 30000) { _lastFailure = now; Log.Write("Mode souris : Windows a refusé une entrée (droits de la fenêtre ou bureau sécurisé)"); }
        return ok;
    }
    private void Button(ushort buttons, ushort bit, uint down, uint up, int data, long now)
    {
        bool pressed = (buttons & bit) != 0;
        if (pressed == ((_held & bit) != 0)) return;
        if (Send(pressed ? down : up, 0, 0, data, now)) _held = (ushort)(pressed ? _held | bit : _held & ~bit);
        else if (pressed) _rejected |= bit;
    }
    private void Release()
    {
        long now = Environment.TickCount64;
        Button(0, A, Native.LEFT_DOWN, Native.LEFT_UP, 0, now);
        Button(0, Y, Native.RIGHT_DOWN, Native.RIGHT_UP, 0, now);
        Button(0, LB, Native.MIDDLE_DOWN, Native.MIDDLE_UP, 0, now);
        Button(0, B, Native.X_DOWN, Native.X_UP, 1, now);
        Button(0, RB, Native.X_DOWN, Native.X_UP, 2, now);
        _pad = 0; _wheelNext = 0; _scrollX = _scrollY = 0;
    }
}
