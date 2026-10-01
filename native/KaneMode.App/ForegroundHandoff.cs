namespace KaneMode;

/// <summary>Une ouverture demandée par l’utilisateur suspend toute reprise automatique du focus.</summary>
internal sealed class ForegroundHandoff
{
    private volatile bool _active;
    private bool _left;
    public bool Active => _active;
    public void Begin() { _left = false; _active = true; }
    public void End() { _active = false; _left = false; }
    public void Observe(bool ours)
    {
        if (!_active) return;
        if (!ours) _left = true;
        else if (_left) End();
    }
}
