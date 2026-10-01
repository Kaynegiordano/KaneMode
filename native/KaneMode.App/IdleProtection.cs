namespace KaneMode;

/// <summary>Protection temporaire de la session : aucun réglage Windows n’est modifié.</summary>
internal sealed class IdleProtection : IDisposable
{
    private bool _requested;
    private bool _inputFailed;

    public void Update(bool active)
    {
        // Le bureau sécurisé (verrouillage, UAC) ne reçoit jamais d’entrée simulée.
        active = active && Native.InteractiveDesktop();
        if (active != _requested)
        {
            if (!Native.KeepAwake(active))
            {
                Log.Write("Protection contre l’inactivité : demande Windows refusée");
                return;
            }
            _requested = active;
        }
        if (!active || Native.IdleMilliseconds() < 15000) return;
        // Les manettes ne réinitialisent pas toujours l’inactivité Windows. Un mouvement nul
        // remet ce compteur à zéro sans déplacer le curseur, cliquer ou envoyer une touche au jeu.
        bool ok = Native.ResetIdle();
        if (!ok && !_inputFailed) Log.Write("Protection contre le verrouillage : Windows refuse la réinitialisation de l’inactivité");
        _inputFailed = !ok;
    }

    public void Dispose()
    {
        if (_requested) Native.KeepAwake(false);
        _requested = false;
    }
}
