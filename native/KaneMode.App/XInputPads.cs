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
        /// <summary>KaneMode en arrière-plan devant le bureau Windows (bureau, Explorateur) : seul Start maintenu compte.</summary>
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
    public event Action<string>? MouseDiagnosticChanged;
    private long _diagnosticAt, _acceptedBefore, _rejectedBefore;
    private string _diagnosticKey = "";

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
    private readonly int[] _xinputResult = new int[4];
    private long _sourcesAt, _sourcesLogged;
    private readonly State[] _state = new State[SLOTS];
    private readonly long[] _startSince = new long[SLOTS];
    private readonly bool[] _startUsed = new bool[SLOTS];
    private readonly HidGamepads _hid = new();
    private State _ui;
    private readonly object _uiLock = new();
    private long _uiAt = -1000;
    private readonly MouseSources _mouseSources = new(SLOTS);

    private volatile bool _mouse;
    private readonly GamepadMouse _mouseInput = new((flags, dx, dy, data) => Native.Mouse(flags, dx, dy, data));
    private volatile bool _mousePaused;
    private bool _interactive = true;
    private long _desktopChecked;
    private ushort _prevAll;

    /// <param name="focus">Qui a la main (KaneMode, personne, une autre fenêtre).</param>
    public XInputPads(Func<Focus> focus) { _focus = focus; }

    public bool MouseMode => _mouse;

    /// <summary>Pause pendant la veille ou le verrouillage, sans changer le choix de l'utilisateur.</summary>
    public void PauseMouse(bool paused) { _mousePaused = paused; if (paused) _mouseInput.Pause(); }

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
        _mouseInput.SetActive(on);
        _mouse = on;
        if (on) { _sourcesAt = 0; _sourcesLogged = 0; }
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
    public void SetUiPad(ushort buttons, double lx, double ly, double rx, double ry, string source = "", bool connected = true)
    {
        static short A(double v) => (short)Math.Round(Math.Clamp(v, -1, 1) * 32767);
        lock (_uiLock)
        {
            _ui = new State { Pad = new Gamepad { Buttons = buttons, ThumbLX = A(lx), ThumbLY = A(-ly), ThumbRX = A(rx), ThumbRY = A(-ry) } };
            _uiAt = connected ? Environment.TickCount64 : -1000;
        }
    }

    private void Loop()
    {
        string last = "";
        bool dllMissing = false, mouseShown = false;
        long lastTick = Environment.TickCount64, lastKnock = 0, lastError = -10000;
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
                    now = NavigationJson(focus);
                    if (pressed && !_mouse)
                    {
                        if (focus == Focus.Orphan) Reclaim?.Invoke();
                        else if (focus == Focus.Other && t - lastKnock > 3000) { lastKnock = t; Knock?.Invoke(); }
                    }
                }
                catch (DllNotFoundException) { dllMissing = true; Log.Write("XInput absent : manettes lues par WebView2 seulement"); }
                // Cette boucle fait aussi vivre le mode souris : une erreur isolée ne doit pas l'arrêter
                // (un thread qui lève une exception ferme tout KaneMode). Journal limité à une ligne par 10 s.
                catch (Exception ex) when (ex is not ThreadAbortException)
                {
                    if (t - lastError > 10000) { lastError = t; Log.Write("Manettes : erreur de lecture (" + ex.GetType().Name + " : " + ex.Message + ")"); }
                }
            }
            if (!_mouse) _mouseInput.Step(0, 0, 0, t, 0, false);
            if (_mouse != mouseShown) { mouseShown = _mouse; MouseModeChanged?.Invoke(_mouse); }
            if (now != last) { last = now; Changed?.Invoke(now); }
            // KaneMode ou mode souris : lecture à 125 Hz ; autre fenêtre : un coup d'œil (journal) ; sinon rien
            // (derrière une fenêtre ordinaire : 20 fois par seconde, assez pour un appui long sur Start)
            // Mode souris : 125 Hz (curseur fluide) ; interface : 60 Hz, assez pour naviguer et deux fois
            // moins de réveils du processeur
            Thread.Sleep(_mouse ? 8 : ours ? 16 : focus == Focus.Desktop ? 50 : 150);
        }
        _mouseInput.SetActive(false);
    }

    private void ReadAll(long t)
    {
        for (int i = 0; i < 4; i++)
        {
            // Un emplacement vide est lent à interroger : revu toutes les 2 s seulement
            if (!_connected[i] && t < _nextScan[i]) continue;
            int result = XInputGetState(i, out _state[i]);
            _xinputResult[i] = result;
            bool ok = result == 0;
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
            bool ok = _hid.Snapshot(k, out var h);
            _connected[HID0 + k] = ok;
            if (!ok) continue;
            _state[HID0 + k] = new State { Pad = new Gamepad { Buttons = h.Buttons, LeftTrigger = h.LT, RightTrigger = h.RT, ThumbLX = h.LX, ThumbLY = h.LY, ThumbRX = h.RX, ThumbRY = h.RY } };
        }
        // Relais de l'interface : seulement pendant le mode souris, et s'il est récent
        // Une connexion native ne garantit pas que ses axes soient lisibles (mode Xbox).
        // La fraîcheur est bornée côté interface et ici ; aucun veto fondé sur la marque.
        lock (_uiLock)
        {
            _connected[UI] = _mouse && t - _uiAt < 400;
            _state[UI] = _ui;
        }
    }

    private string Json()
    {
        var sb = new StringBuilder("[");
        for (int i = 0; i < UI; i++)
        {
            if (!_connected[i]) continue;
            var p = _state[i].Pad;
            if (sb.Length > 1) sb.Append(',');
            string kind = i >= HID0 && _hid.SonySlot(i - HID0) ? "ps" : "xbox";
            // Axes arrondis au centième : pas de message pour un tremblement du stick
            sb.Append($"{{\"i\":{i},\"kind\":\"{kind}\",\"b\":{p.Buttons},\"lt\":{p.LeftTrigger},\"rt\":{p.RightTrigger},\"lx\":{Axis(p.ThumbLX)},\"ly\":{Axis((short)-Math.Max(p.ThumbLY, (short)-32767))},\"rx\":{Axis(p.ThumbRX)},\"ry\":{Axis((short)-Math.Max(p.ThumbRY, (short)-32767))}}}");
        }
        return sb.Append(']').ToString();
    }

    // Le mode souris ajoute le curseur ; il ne coupe pas la manette de l'interface au premier plan.
    private string NavigationJson(Focus focus) => focus is Focus.Ours or Focus.Orphan ? Json() : "[]";

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
        bool ours = _focus() is Focus.Ours or Focus.Orphan;
        for (int i = 0; i < SLOTS; i++)
        {
            var p = _state[i].Pad;
            int sx = p.ThumbRX, sy = p.ThumbRY;
            if (!ours && Math.Abs((int)p.ThumbLX) + Math.Abs((int)p.ThumbLY) > Math.Abs(sx) + Math.Abs(sy)) { sx = p.ThumbLX; sy = p.ThumbLY; }
            _mouseSources.Update(i, _connected[i], new(p.Buttons, sx, sy));
        }
        if (t - _desktopChecked >= 250)
        {
            _desktopChecked = t;
            _interactive = Native.InteractiveDesktop();
        }
        LogSources(t);
        var selected = _mouseSources.Current;
        _mouseInput.Step(selected.Buttons, selected.X, selected.Y, t, dt, _interactive && !_mousePaused, buttonsEnabled: !ours);
        if (t - _diagnosticAt >= 500)
        {
            _diagnosticAt = t;
            var counts = _mouseInput.MovementCounts;
            int count = _connected.Count(c => c), slot = _mouseSources.Selected;
            string source = slot == UI ? "WebView2" : slot >= HID0 ? "HID " + (slot - HID0) : slot >= 0 ? "XInput " + slot : "";
            string status = _mousePaused ? "suspended" : !_interactive ? "desktop" : counts.Rejected > _rejectedBefore ? "rejected" : counts.Accepted > _acceptedBefore ? "moving" : count == 0 ? "no-controller" : "idle";
            _acceptedBefore = counts.Accepted; _rejectedBefore = counts.Rejected;
            MouseDiagnosticChanged?.Invoke(System.Text.Json.JsonSerializer.Serialize(new { type = "mouse-diagnostic", status, source, controllers = count, x = selected.X, y = selected.Y, accepted = counts.Accepted, rejected = counts.Rejected }));
            string key = status + ":" + source;
            if (key != _diagnosticKey) { _diagnosticKey = key; Log.Write($"Souris : état={status}, source={source}, axes={selected.X}/{selected.Y}, acceptés={counts.Accepted}, refusés={counts.Rejected}"); }
        }
    }

    /// <summary>
    /// Diagnostic du mode souris : toutes les 5 s (40 lignes au plus par activation), ce que chaque source
    /// reçoit réellement et qui a le premier plan. Sert à savoir quelle source est muette sur une console.
    /// </summary>
    private void LogSources(long t)
    {
        if (t - _sourcesAt < 5000 || _sourcesLogged >= 40) return;
        _sourcesAt = t; _sourcesLogged++;
        var sb = new StringBuilder($"Sources (premier plan : {_focus()}) : ");
        for (int i = 0; i < 4; i++)
            sb.Append(_xinputResult[i] == 0 ? $"XInput{i}=ok paquet {_state[i].Packet} G{_state[i].Pad.ThumbLX}/{_state[i].Pad.ThumbLY} D{_state[i].Pad.ThumbRX}/{_state[i].Pad.ThumbRY} " : $"XInput{i}=code {_xinputResult[i]} ");
        for (int k = 0; k < HidGamepads.Max; k++)
            if (_hid.Snapshot(k, out _)) sb.Append($"HID{k}[{_hid.Describe(k)}] ");
        long age = Environment.TickCount64 - _uiAt;
        sb.Append(_connected[UI] ? $"WebView2=actif ({age} ms)" : "WebView2=aucun relais");
        Log.Write(sb.ToString());
    }

    public void Dispose() { _mouseInput.SetActive(false); _stop.Cancel(); _hid.Dispose(); }
}
