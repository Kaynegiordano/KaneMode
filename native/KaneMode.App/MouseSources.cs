namespace KaneMode;

/// <summary>La dernière commande réelle choisit la source ; être connecté ne suffit pas.</summary>
internal sealed class MouseSources
{
    internal readonly record struct Sample(ushort Buttons, int X, int Y);
    private readonly Sample[] _samples;
    private readonly bool[] _available;
    private readonly long[] _revision;
    private long _next;
    public int Selected { get; private set; } = -1;
    public MouseSources(int slots) { _samples = new Sample[slots]; _available = new bool[slots]; _revision = new long[slots]; }
    private static int Axis(int value) => Math.Abs(value) <= 10321 ? 0 : (int)Math.Round(value / 512.0);
    private static Sample Intent(Sample s) => new((ushort)(s.Buttons & 0xF30F), Axis(s.X), Axis(s.Y));
    public void Update(int slot, bool available, Sample sample)
    {
        var previous = _available[slot] ? Intent(_samples[slot]) : default;
        var current = Intent(sample);
        _available[slot] = available; _samples[slot] = sample;
        if (!available) { if (Selected == slot) Selected = -1; return; }
        // Une source muette ne prend pas la main. Une remise au neutre réelle arrête aussi
        // une copie retardée de la même manette, sans deviner son identité d'après son nom.
        if (current != previous) { Selected = slot; _revision[slot] = ++_next; }
    }
    public Sample Current
    {
        get
        {
            if (Selected < 0)
                for (int i = 0; i < _samples.Length; i++)
                    if (_available[i] && Intent(_samples[i]) != default && (Selected < 0 || _revision[i] > _revision[Selected])) Selected = i;
            return Selected >= 0 && _available[Selected] ? _samples[Selected] : default;
        }
    }
}
