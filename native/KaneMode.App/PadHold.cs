using System.Runtime.InteropServices;

namespace KaneMode;

/// <summary>
/// Start et Select maintenus pendant un jeu : KaneMode lit les manettes XInput (Xbox, manette
/// intégrée des consoles portables) même quand le jeu a le focus, et signale un appui long sur
/// l'un de ces boutons. Un appui court reste pour le jeu (pause, carte…).
/// </summary>
public sealed class PadHold : IDisposable
{
    [StructLayout(LayoutKind.Sequential)]
    private struct XINPUT_GAMEPAD { public ushort Buttons; public byte LeftTrigger, RightTrigger; public short ThumbLX, ThumbLY, ThumbRX, ThumbRY; }
    [StructLayout(LayoutKind.Sequential)]
    private struct XINPUT_STATE { public uint PacketNumber; public XINPUT_GAMEPAD Gamepad; }
    [DllImport("xinput1_4.dll")]
    private static extern uint XInputGetState(uint index, out XINPUT_STATE state);

    private const ushort Start = 0x0010, Back = 0x0020;

    /// <summary>Bouton maintenu : « start » ou « select ». Appelé sur un fil du pool.</summary>
    public event Action<string>? Held;

    /// <summary>Durée de l'appui long, en secondes ; 0 = désactivé.</summary>
    public double HoldSeconds { get; set; } = 1.5;

    private Timer? _timer;
    private readonly bool[] _connected = new bool[4];
    private int _tick;
    private DateTime? _startSince, _backSince;
    private bool _fired;

    public void Begin()
    {
        try { XInputGetState(0, out _); }
        catch (Exception e) when (e is DllNotFoundException or EntryPointNotFoundException)
        {
            Log.Write("Start / Select en jeu : XInput indisponible");
            return;
        }
        _timer = new Timer(_ => Poll(), null, 500, 50);
    }

    private int _busy;
    private void Poll()
    {
        // Un passage lent (manette qui se déconnecte) ne doit pas se superposer au suivant
        if (Interlocked.Exchange(ref _busy, 1) == 1) return;
        try { Check(); }
        finally { Volatile.Write(ref _busy, 0); }
    }

    private void Check()
    {
        if (HoldSeconds <= 0) { _startSince = _backSince = null; return; }
        ushort buttons = 0;
        // Une manette absente coûte cher à interroger : on ne revérifie les places vides que toutes les 2 s
        bool rescan = _tick++ % 40 == 0;
        for (uint i = 0; i < 4; i++)
        {
            if (!_connected[i] && !rescan) continue;
            _connected[i] = XInputGetState(i, out var st) == 0;
            if (_connected[i]) buttons |= st.Gamepad.Buttons;
        }
        var now = DateTime.UtcNow;
        bool start = (buttons & Start) != 0, back = (buttons & Back) != 0;
        _startSince = start ? _startSince ?? now : null;
        _backSince = back ? _backSince ?? now : null;
        if (!start && !back) { _fired = false; return; }
        // Les deux ensemble (combinaison d'un jeu ou de Steam) : on ne fait rien
        if (_fired || (start && back)) return;
        var since = start ? _startSince : _backSince;
        if ((now - since!.Value).TotalSeconds < HoldSeconds) return;
        _fired = true; // une fois par appui : il faut relâcher pour recommencer
        Held?.Invoke(start ? "start" : "select");
    }

    public void Dispose() => _timer?.Dispose();
}
