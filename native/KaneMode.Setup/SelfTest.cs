namespace KaneMode.Setup;

/// <summary>Vérifications des réglages de Sunshine sans rien toucher (KaneMode-Setup.exe --test).</summary>
internal static class SelfTest
{
    public static int Run()
    {
        int failed = 0;
        void Check(bool ok, string what) { if (!ok) { failed++; Console.Error.WriteLine("ÉCHEC : " + what); } }
        string nl = Environment.NewLine;

        Check(StreamerSetup.WithAutoGamepad("gamepad = x360\ngamepad_driver = vigembus\n", true) == $"gamepad = auto{nl}gamepad_driver = vigembus{nl}", "x360 → auto, pilote gardé");
        string same = $"gamepad = auto{nl}gamepad_driver = vigembus{nl}";
        Check(ReferenceEquals(StreamerSetup.WithAutoGamepad(same, true), same), "déjà en automatique : fichier inchangé");
        Check(StreamerSetup.WithAutoGamepad("", true) == $"gamepad = auto{nl}gamepad_driver = vigembus{nl}", "fichier vide : auto + ViGEmBus");
        Check(StreamerSetup.WithAutoGamepad("port = 47989\n", false) == $"gamepad = auto{nl}port = 47989{nl}", "sans ViGEmBus : pilote non imposé, autres réglages gardés");
        Check(StreamerSetup.WithAutoGamepad("gamepad = ds4\ngamepad_driver = virtualhid\n", true).Contains("gamepad_driver = virtualhid"), "pilote choisi par l’utilisateur gardé");

        string dir = Path.Combine(Path.GetTempPath(), "kanemode-setup-test-" + Guid.NewGuid().ToString("N")[..6]);
        Directory.CreateDirectory(dir);
        string log = Path.Combine(dir, "sunshine.log");
        File.WriteAllText(log, "CLIENT CONNECTED\nCLIENT DISCONNECTED\n");
        Check(!StreamerSetup.StreamActive(log), "session terminée");
        File.AppendAllText(log, "CLIENT CONNECTED\n");
        Check(StreamerSetup.StreamActive(log), "streaming en cours");
        Check(!StreamerSetup.StreamActive(Path.Combine(dir, "absent.log")), "pas de journal");
        Directory.Delete(dir, true);

        Console.WriteLine(failed == 0 ? "Vérifications réussies" : $"{failed} échec(s)");
        Console.WriteLine("Rôle proposé pour ce PC : " + StreamerSetup.SuggestedRole());
        return failed == 0 ? 0 : 1;
    }
}
