using System.Runtime.InteropServices;
using System.Text;

namespace KaneMode;

/// <summary>
/// Manettes XInput (manette de la ROG Ally, manettes Xbox et compatibles) lues directement par l'app.
/// L'API Gamepad de WebView2 ne les voyait plus toujours après un passage par une autre application
/// (retour de KanePlay : manette ignorée par l'interface). Tant que KaneMode a la main, l'état des
/// manettes est envoyé à l'interface à chaque changement (ui/js/nav.js, setNativePads).
///
/// Mode souris (comme dans KanePlay) : Start maintenu 1 s bascule la manette en souris. Stick :
/// curseur ; A : clic ; B : clic droit ; X : clic du milieu ; LB / RB : précédent / suivant ; croix :
/// molette. Il marche dans toutes les fenêtres (lanceurs, fenêtres de connexion…), jusqu'à un nouvel
/// appui long sur Start.
/// </summary>
public sealed class XInputPads : IDisposable
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Gamepad { public ushort Buttons; public byte LeftTrigger, RightTrigger; public short ThumbLX, ThumbLY, ThumbRX, ThumbRY; }
    [StructLayout(LayoutKind.Sequential)]
    private struct State { public uint Packet; public Gamepad Pad; }
    [DllImport("xinput1_4.dll")]
    private static extern int XInputGetState(int index, out State state);

    /// <summary>Qui a la main, vu de KaneMode (lu hors du fil de l'interface).</summary>
    public enum Focus
    {
        /// <summary>KaneMode masqué, réduit ou pas prêt.</summary>
        Hidden,
        /// <summary>KaneMode au premier plan.</summary>
        Ours,
        /// <summary>KaneMode affiché, premier plan à personne (fenêtre fermée ou masquée, bureau).</summary>
        Orphan,
        /// <summary>Une autre fenêtre (jeu, Game Bar, vue des tâches…).</summary>
        Other,
        /// <summary>KaneMode en arrière-plan derrière une fenêtre ordinaire (bureau, lanceur) : seul Start maintenu compte.</summary>
        Desktop,
    }

    /// <summary>État des manettes en JSON (tableau), à chaque changement ; « [] » quand KaneMode n'a plus la main.</summary>
    public event Action<string>? Changed;
    /// <summary>Bouton pressé alors que le premier plan n'est à personne : KaneMode doit le reprendre.</summary>
    public event Action? Reclaim;
    /// <summary>Bouton pressé alors qu'une autre fenêtre a la main et que KaneMode est affiché (journal).</summary>
    public event Action? Knock;
    /// <summary>Mode souris activé ou désactivé.</summary>
    public event Action<bool>? MouseModeChanged;

    private const ushort START = 0x10, A = 0x1000, B = 0x2000, X = 0x4000, LB = 0x100, RB = 0x200,
        UP = 0x1, DOWN = 0x2, LEFT = 0x4, RIGHT = 0x8;
    private const int HOLD_MS = 1000; // Start maintenu : bascule du mode souris

    private readonly Func<Focus> _focus;
    private readonly CancellationTokenSource _stop = new();
    // Emplacements : 0-3 XInput, 4-7 manettes HID (voir HidGamepads), 8 manette vue par l'interface
    private const int SLOTS = 9, HID0 = 4, UI = 8;
    private readonly bool[] _connected = new bool[SLOTS];
    private readonly long[] _nextScan = new long[4];
    private readonly bool[] _announced = new bool[4];
    private readonly State[] _state = new State[SLOTS];
    private readonly long[] _startSince = new long[SLOTS];
    private readonly bool[] _startUsed = new bool[SLOTS];
    private readonly HidGamepads _hid = new();
    private State _ui;
    private long _uiAt = -1000;

    private volatile bool _mouse;
    private ushort _mouseButtons;       // boutons de souris tenus (bits de la manette)
    private double _restX, _restY;      // fractions de pixel accumulées
    private long _wheelNext;            // répétition de la molette
    private ushort _prevAll;

    /// <param name="focus">Qui a la main (KaneMode, personne, une autre fenêtre).</param>
    public XInputPads(Func<Focus> focus) { _focus = focus; }

    public bool MouseMode => _mouse;

    /// <summary>Quitte le mode souris (lancement d'un jeu : la manette est à lui).</summary>
    public void StopMouseMode() { if (_mouse) SetMouseMode(false, "lancement"); }

    private long _lastToggle;
    /// <summary>Moment du dernier changement de mode (Environment.TickCount64).</summary>
    public long LastToggle => _lastToggle;

    /// <summary>
    /// Active ou coupe le mode souris (Start maintenu, interface, widget Game Bar). Un Start encore
    /// tenu à ce moment ne compte plus jusqu'à son relâchement : il ne rebascule pas une seconde après.
    /// </summary>
    public void SetMouseMode(bool on, string why)
    {
        _lastToggle = Environment.TickCount64;
        for (int i = 0; i < SLOTS; i++) { _startUsed[i] = true; _startSince[i] = 1; }
        if (on == _mouse) return;
        _restX = _restY = 0;
        _mouse = on;
        Log.Write(on ? $"Mode souris activé ({why})" : $"Mode souris désactivé ({why})");
    }

    public void Start()
    {
        var thread = new Thread(Loop) { IsBackground = true, Name = "Manettes XInput", Priority = ThreadPriority.AboveNormal };
        thread.Start();
        _hid.Start();
    }

    /// <summary>
    /// Déconnexion puis reconnexion de toutes les manettes, côté KaneMode (retour de KanePlay, ou
    /// « Reconnecter les manettes ») : manettes HID rouvertes, XInput réinterrogé.
    /// </summary>
    public void Reconnect()
    {
        for (int i = 0; i < 4; i++) { _connected[i] = false; _announced[i] = false; _nextScan[i] = 0; }
        _hid.Reconnect();
    }

    /// <summary>Manette vue par l'interface (API Gamepad de WebView2), relayée pendant le mode souris.</summary>
    public void SetUiPad(ushort buttons, double lx, double ly, double rx, double ry)
    {
        static short A(double v) => (short)Math.Round(Math.Clamp(v, -1, 1) * 32767);
        _ui = new State { Pad = new Gamepad { Buttons = buttons, ThumbLX = A(lx), ThumbLY = A(-ly), ThumbRX = A(rx), ThumbRY = A(-ry) } };
        _uiAt = Environment.TickCount64;
    }

    private void Loop()
    {
        string last = "";
        bool dllMissing = false, mouseShown = false;
        long lastTick = Environment.TickCount64, lastKnock = 0;
        while (!_stop.IsCancellationRequested)
        {
            long t = Environment.TickCount64;
            double dt = Math.Min(50, t - lastTick);
            lastTick = t;
            Focus focus = _focus();
            bool ours = focus == Focus.Ours || focus == Focus.Orphan;
            string now = "[]";
            if (ours || _mouse || focus == Focus.Other || focus == Focus.Desktop)
            {
                try
                {
                    if (!dllMissing) ReadAll(t);
                    ReadOthers(t);
                    ushort all = 0;
                    for (int i = 0; i < SLOTS; i++) if (_connected[i]) all |= _state[i].Pad.Buttons;
                    bool pressed = (all & ~_prevAll) != 0;
                    _prevAll = all;
                    // Start maintenu : seulement quand KaneMode a la main (ou pour quitter le mode souris)
                    if (ours || _mouse || focus == Focus.Desktop) CheckHold(t);
                    if (_mouse) MouseStep(t, dt);
                    else if (ours) now = Json();
                    if (pressed && !_mouse)
                    {
                        if (focus == Focus.Orphan) Reclaim?.Invoke();
                        else if (focus == Focus.Other && t - lastKnock > 3000) { lastKnock = t; Knock?.Invoke(); }
                    }
                }
                catch (DllNotFoundException) { dllMissing = true; Log.Write("XInput absent : manettes lues par WebView2 seulement"); }
            }
            if (!_mouse && _mouseButtons != 0) ReleaseMouse();
            if (_mouse != mouseShown) { mouseShown = _mouse; MouseModeChanged?.Invoke(_mouse); }
            if (now != last) { last = now; Changed?.Invoke(now); }
            // KaneMode ou mode souris : lecture à 125 Hz ; autre fenêtre : un coup d'œil (journal) ; sinon rien
            // (derrière une fenêtre ordinaire : 20 fois par seconde, assez pour un appui long sur Start)
            // Mode souris : 125 Hz (curseur fluide) ; interface : 60 Hz, assez pour naviguer et deux fois
            // moins de réveils du processeur
            Thread.Sleep(_mouse ? 8 : ours ? 16 : focus == Focus.Desktop ? 50 : 150);
        }
        if (_mouseButtons != 0) ReleaseMouse();
    }

    private void ReadAll(long t)
    {
        for (int i = 0; i < 4; i++)
        {
            // Un emplacement vide est lent à interroger : revu toutes les 2 s seulement
            if (!_connected[i] && t < _nextScan[i]) continue;
            bool ok = XInputGetState(i, out _state[i]) == 0;
            // Branchement et débranchement notés dans le journal (diagnostic sur la console)
            if (ok != _connected[i] && (ok || _announced[i])) { _announced[i] = ok; Log.Write($"XInput : manette {i} {(ok ? "détectée" : "retirée")}"); }
            _connected[i] = ok;
            if (!ok) _nextScan[i] = t + 2000;
        }
    }

    /// <summary>Manettes HID et manette de l'interface, au format XInput.</summary>
    private void ReadOthers(long t)
    {
        for (int k = 0; k < HidGamepads.Max; k++)
        {
            bool ok = _hid.Connected[k];
            _connected[HID0 + k] = ok;
            if (!ok) continue;
            var h = _hid.States[k];
            _state[HID0 + k] = new State { Pad = new Gamepad { Buttons = h.Buttons, ThumbLX = h.LX, ThumbLY = h.LY, ThumbRX = h.RX, ThumbRY = h.RY } };
        }
        // Relais de l'interface : seulement pendant le mode souris, et s'il est récent
        _connected[UI] = _mouse && t - _uiAt < 400;
        _state[UI] = _ui;
    }

    private string Json()
    {
        var sb = new StringBuilder("[");
        for (int i = 0; i < UI; i++)
        {
            if (!_connected[i]) continue;
            var p = _state[i].Pad;
            if (sb.Length > 1) sb.Append(',');
            // Axes arrondis au centième : pas de message pour un tremblement du stick
            sb.Append($"{{\"i\":{i},\"b\":{p.Buttons},\"lt\":{p.LeftTrigger},\"rt\":{p.RightTrigger},\"lx\":{Axis(p.ThumbLX)},\"ly\":{Axis((short)-Math.Max(p.ThumbLY, (short)-32767))},\"rx\":{Axis(p.ThumbRX)},\"ry\":{Axis((short)-Math.Max(p.ThumbRY, (short)-32767))}}}");
        }
        return sb.Append(']').ToString();
    }

    private static string Axis(short v) => (Math.Round(v / 32767.0, 2)).ToString(System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>Start maintenu 1 s sur une manette : bascule le mode souris (une fois par appui).</summary>
    private void CheckHold(long t)
    {
        for (int i = 0; i < SLOTS; i++)
        {
            bool down = _connected[i] && (_state[i].Pad.Buttons & START) != 0;
            if (!down) { _startSince[i] = 0; _startUsed[i] = false; continue; }
            if (_startSince[i] == 0) _startSince[i] = t;
            if (_startUsed[i] || t - _startSince[i] < HOLD_MS) continue;
            SetMouseMode(!_mouse, "Start maintenu");
            return;
        }
    }

    private void MouseStep(long t, double dt)
    {
        // Toutes les manettes branchées pilotent la souris ; le stick le plus poussé déplace le curseur
        ushort buttons = 0;
        int sx = 0, sy = 0, best = 0;
        for (int i = 0; i < SLOTS; i++)
        {
            if (!_connected[i]) continue;
            var p = _state[i].Pad;
            buttons |= p.Buttons;
            foreach (var (x, y) in new[] { (p.ThumbLX, p.ThumbLY), (p.ThumbRX, p.ThumbRY) })
            {
                int m = Math.Abs((int)x) + Math.Abs((int)y);
                if (m > best) { best = m; sx = x; sy = y; }
            }
        }
        // Même courbe que KanePlay : lent près du centre, rapide en butée (environ 1 250 px/s)
        double dx = Speed(sx) * dt / 50, dy = -Speed(sy) * dt / 50;
        _restX += dx; _restY += dy;
        int mx = (int)_restX, my = (int)_restY;
        _restX -= mx; _restY -= my;
        if (mx != 0 || my != 0) Native.Mouse(Native.MOUSE_MOVE, mx, my);

        Button(buttons, A, Native.LEFT_DOWN, Native.LEFT_UP, 0);
        Button(buttons, B, Native.RIGHT_DOWN, Native.RIGHT_UP, 0);
        Button(buttons, X, Native.MIDDLE_DOWN, Native.MIDDLE_UP, 0);
        Button(buttons, LB, Native.X_DOWN, Native.X_UP, 1);
        Button(buttons, RB, Native.X_DOWN, Native.X_UP, 2);

        // Croix : molette, répétée tant qu'elle est tenue
        ushort pad = (ushort)(buttons & (UP | DOWN | LEFT | RIGHT));
        bool fresh = (pad & ~_mouseButtons & (UP | DOWN | LEFT | RIGHT)) != 0;
        if (pad == 0) _wheelNext = 0;
        else if (fresh || t >= _wheelNext)
        {
            if ((pad & UP) != 0) Native.Mouse(Native.WHEEL, data: 120);
            if ((pad & DOWN) != 0) Native.Mouse(Native.WHEEL, data: -120);
            if ((pad & RIGHT) != 0) Native.Mouse(Native.HWHEEL, data: 120);
            if ((pad & LEFT) != 0) Native.Mouse(Native.HWHEEL, data: -120);
            _wheelNext = t + (fresh ? 350 : 90);
        }
        _mouseButtons = (ushort)((_mouseButtons & ~(UP | DOWN | LEFT | RIGHT)) | pad);
    }

    private static double Speed(int raw)
    {
        double v = Math.Pow(raw / 32766.0 * 4, 3);
        return Math.Abs(v) > 2 ? v - Math.Sign(v) * 2 : 0;
    }

    private void Button(ushort buttons, ushort bit, uint down, uint up, int data)
    {
        bool now = (buttons & bit) != 0, was = (_mouseButtons & bit) != 0;
        if (now == was) return;
        Native.Mouse(now ? down : up, data: data);
        _mouseButtons = (ushort)(now ? _mouseButtons | bit : _mouseButtons & ~bit);
    }

    /// <summary>Relâche les boutons de souris encore tenus (sortie du mode souris).</summary>
    private void ReleaseMouse()
    {
        Button(0, A, Native.LEFT_DOWN, Native.LEFT_UP, 0);
        Button(0, B, Native.RIGHT_DOWN, Native.RIGHT_UP, 0);
        Button(0, X, Native.MIDDLE_DOWN, Native.MIDDLE_UP, 0);
        Button(0, LB, Native.X_DOWN, Native.X_UP, 1);
        Button(0, RB, Native.X_DOWN, Native.X_UP, 2);
        _mouseButtons = 0;
    }

    public void Dispose() => _stop.Cancel();
}
