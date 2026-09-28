using System.Windows;

namespace KaneMode;

/// <summary>
/// Point d'entrée : une seule instance à la fois. Un deuxième lancement (par exemple par le
/// mode Xbox alors que KaneMode tourne déjà) ramène simplement la fenêtre existante au premier plan.
/// </summary>
public partial class App : Application
{
    private Mutex? _single;

    protected override void OnStartup(StartupEventArgs e)
    {
        _single = new Mutex(true, "KaneMode-InstanceUnique", out bool first);
        if (!first)
        {
            Native.BringToFront(KaneMode.MainWindow.WindowTitle);
            Shutdown();
            return;
        }

        DispatcherUnhandledException += (_, args) =>
        {
            Log.Write("Erreur non gérée : " + args.Exception);
            args.Handled = true;
        };

        base.OnStartup(e);
        new MainWindow().Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _single?.Dispose();
        base.OnExit(e);
    }
}
