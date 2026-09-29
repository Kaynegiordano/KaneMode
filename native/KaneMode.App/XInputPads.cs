using System.Runtime.InteropServices;
using System.Text;

namespace KaneMode;

/// <summary>
/// Manettes XInput (manette de la ROG Ally, manettes Xbox et compatibles) lues directement par l'app.
/// L'API Gamepad de WebView2 ne les voyait plus toujours après un passage par une autre application
/// (retour de KanePlay : manette ignorée par l'interface). Tant que KaneMode est au premier plan,
/// l'état des manettes est envoyé à l'interface à chaque changement ; elle le préfère alors à l'API
/// Gamepad pour ces manettes (ui/js/nav.js, setNativePads).
/// </summary>
public sealed class XInputPads : IDisposable
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Gamepad { public ushort Buttons; public byte LeftTrigger, RightTrigger; public short ThumbLX, ThumbLY, ThumbRX, ThumbRY; }
    [StructLayout(LayoutKind.Sequential)]
    private struct State { public uint Packet; public Gamepad Pad; }
    [DllImport("xinput1_4.dll")]
    private static extern int XInputGetState(int index, out State state);

    /// <summary>État des manettes en JSON (tableau), à chaque changement ; « [] » quand KaneMode passe en arrière-plan.</summary>
    public event Action<string>? Changed;

    private readonly Func<bool> _active;
    private readonly CancellationTokenSource _stop = new();
    private readonly bool[] _connected = new bool[4];
    private readonly long[] _nextScan = new long[4];
    private readonly bool[] _announced = new bool[4];

    /// <param name="active">Vrai quand KaneMode est au premier plan (lu hors du fil de l'interface).</param>
    public XInputPads(Func<bool> active) { _active = active; }

    public void Start()
    {
        var thread = new Thread(Loop) { IsBackground = true, Name = "Manettes XInput", Priority = ThreadPriority.AboveNormal };
        thread.Start();
    }

    private void Loop()
    {
        string last = "";
        bool dllMissing = false;
        while (!_stop.IsCancellationRequested)
        {
            string now;
            if (dllMissing || !_active()) now = "[]";
            else
            {
                try { now = Read(); }
                catch (DllNotFoundException) { dllMissing = true; Log.Write("XInput absent : manettes lues par WebView2 seulement"); now = "[]"; }
            }
            if (now != last) { last = now; Changed?.Invoke(now); }
            // Au premier plan : lecture à 125 Hz ; sinon, un coup d'œil de temps en temps
            Thread.Sleep(now == "[]" && !_active() ? 150 : 8);
        }
    }

    private string Read()
    {
        long t = Environment.TickCount64;
        var sb = new StringBuilder("[");
        for (int i = 0; i < 4; i++)
        {
            // Un emplacement vide est lent à interroger : revu toutes les 2 s seulement
            if (!_connected[i] && t < _nextScan[i]) continue;
            bool ok = XInputGetState(i, out State s) == 0;
            // Branchement et débranchement notés dans le journal (diagnostic sur la console)
            if (ok != _connected[i] && (ok || _announced[i])) { _announced[i] = ok; Log.Write($"XInput : manette {i} {(ok ? "détectée" : "retirée")}"); }
            _connected[i] = ok;
            if (!ok) { _nextScan[i] = t + 2000; continue; }
            var p = s.Pad;
            if (sb.Length > 1) sb.Append(',');
            // Axes arrondis au centième : pas de message pour un tremblement du stick
            sb.Append($"{{\"i\":{i},\"b\":{p.Buttons},\"lt\":{p.LeftTrigger},\"rt\":{p.RightTrigger},\"lx\":{Axis(p.ThumbLX)},\"ly\":{Axis((short)-Math.Max(p.ThumbLY, (short)-32767))},\"rx\":{Axis(p.ThumbRX)},\"ry\":{Axis((short)-Math.Max(p.ThumbRY, (short)-32767))}}}");
        }
        return sb.Append(']').ToString();
    }

    private static string Axis(short v) => (Math.Round(v / 32767.0, 2)).ToString(System.Globalization.CultureInfo.InvariantCulture);

    public void Dispose() => _stop.Cancel();
}
