namespace KaneMode.Setup;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        // Vérifications sans rien installer : --apercu <png> [jouer|streamer|deux], --test
        if (args.Length >= 2 && args[0] == "--apercu")
        {
            Role? role = args.Length >= 3 ? args[2] switch { "jouer" => Role.Play, "streamer" => Role.Stream, _ => Role.Both } : null;
            using var form = new SetupForm(role);
            form.SaveImage(args[1]);
            return 0;
        }
        if (args.Length >= 1 && args[0] == "--test") return SelfTest.Run();
        Application.Run(new SetupForm());
        return 0;
    }
}
