namespace KaneMode;

internal static class Native
{
    public static bool Interactive = true, RequestOk = true, InputOk = true;
    public static uint Idle;
    public static int Pulses;
    public static List<bool> Requests = new();
    public static bool InteractiveDesktop() => Interactive;
    public static bool KeepAwake(bool active) { Requests.Add(active); return RequestOk; }
    public static uint IdleMilliseconds() => Idle;
    public static bool ResetIdle() { Pulses++; if (InputOk) Idle = 0; return InputOk; }
}
internal static class Log
{
    public static List<string> Lines = new();
    public static void Write(string value) => Lines.Add(value);
}
internal static class Program
{
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    public static void Main()
    {
        using var guard = new IdleProtection();
        guard.Update(true);
        Check(Native.Requests.SequenceEqual(new[]{true}) && Native.Pulses == 0, "Activation sans fausse activité");
        Native.Idle=15000; guard.Update(true); guard.Update(true);
        Check(Native.Pulses==1 && Native.Requests.Count==1, "Réinitialisation seulement après inactivité");
        guard.Update(false);
        Check(Native.Requests.Last()==false, "Libération en arrière-plan ou avant veille");
        Native.Interactive=false; Native.Idle=60000; guard.Update(true);
        Check(Native.Pulses==1 && Native.Requests.Count==2, "Le verrouillage manuel reste intact");
        Native.Interactive=true; Native.RequestOk=false; guard.Update(true);
        Check(Native.Pulses==1, "Une demande refusée ne produit pas de faux succès");
        Native.RequestOk=true; guard.Update(true);
        Check(Native.Pulses==2, "Nouvel essai possible après un refus");
        Native.InputOk=false; Native.Idle=60000; int logs=Log.Lines.Count;
        guard.Update(true); guard.Update(true);
        Check(Log.Lines.Count==logs+1, "Pas de journal rempli de refus répétés");
        guard.Dispose(); int requests=Native.Requests.Count; guard.Dispose();
        Check(Native.Requests.Last()==false && Native.Requests.Count==requests, "Fermeture idempotente sans requête persistante");
        Console.WriteLine("PASS Protection Windows : activation, inactivité, arrière-plan, veille, bureau sécurisé, refus et fermeture.");
        var handoff=new ForegroundHandoff();
        handoff.Begin();handoff.Observe(true);
        Check(handoff.Active,"Le programme n’a pas encore pris le focus : conserver la protection");
        handoff.Observe(false);handoff.Observe(false);
        Check(handoff.Active,"La boutique ouverte garde la main");
        handoff.Observe(true);Check(!handoff.Active,"Le retour volontaire rend la manette à KaneMode");
        handoff.Begin();handoff.End();Check(!handoff.Active,"Un lancement refusé rend immédiatement la navigation");
        handoff.Begin();handoff.Observe(false);handoff.Begin();handoff.Observe(true);Check(handoff.Active,"Une nouvelle ouverture ne reprend pas l’ancien état de retour");
        Console.WriteLine("PASS Premier plan : ouverture, attente, boutique, retour, refus et demandes successives.");
    }
}
