using System.Windows;

namespace KaneMode;

/// <summary>
/// Point d'entrée : une seule instance à la fois. Un deuxième lancement (par exemple par le
/// mode Xbox alors que KaneMode tourne déjà) ramène simplement la fenêtre existante au premier plan.
/// Exception : la relance voulue par KaneMode lui-même (après KanePlay, voir Restart), qui attend
/// que l'ancienne instance soit fermée.
/// </summary>
public partial class App : Application
{
    private Mutex? _single;
    private const string RestartSignal = "KaneMode-Relance";

    /// <summary>Instance lancée par Restart : pas de logo de démarrage.</summary>
    public static bool Restarted { get; private set; }

    protected override void OnStartup(StartupEventArgs e)
    {
        _single = new Mutex(true, "KaneMode-InstanceUnique", out bool first);
        if (!first)
        {
            // Relance demandée par l'instance en cours : on attend qu'elle se ferme (une seule instance
            // consomme le signal ; le mode Xbox peut aussi relancer l'app d'accueil au même moment)
            using var restart = new EventWaitHandle(false, EventResetMode.AutoReset, RestartSignal);
            bool owned = false;
            if (restart.WaitOne(0))
            {
                try { owned = _single.WaitOne(TimeSpan.FromSeconds(15)); }
                catch (AbandonedMutexException) { owned = true; }
            }
            if (!owned)
            {
                Native.BringToFront(KaneMode.MainWindow.WindowTitle);
                Shutdown();
                return;
            }
            Restarted = true;
            Log.Write("Relance de KaneMode");
        }

        DispatcherUnhandledException += (_, args) =>
        {
            Log.Write("Erreur non gérée : " + args.Exception);
            args.Handled = true;
        };

        base.OnStartup(e);
        // Le curseur du mode souris est une autre fenêtre : fermer KaneMode doit quand même quitter
        ShutdownMode = ShutdownMode.OnMainWindowClose;
        new MainWindow().Show();
    }

    /// <summary>
    /// Relance complète de KaneMode (nouveau processus, nouvel hôte, nouveau WebView2) : lance une
    /// nouvelle instance, qui attend la fermeture de celle-ci.
    /// </summary>
    public static bool Restart()
    {
        try
        {
            using var restart = new EventWaitHandle(false, EventResetMode.AutoReset, RestartSignal);
            restart.Set();
            // Paquet : par son identifiant d'application (l'Explorateur la lance dans son paquet)
            if (Paths.AppUserModelId is string aumid)
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("explorer.exe", $"shell:AppsFolder\\{aumid}") { UseShellExecute = false });
            else
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false });
            return true;
        }
        catch (Exception ex)
        {
            Log.Write("Relance impossible : " + ex.Message);
            return false;
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try { _single?.ReleaseMutex(); } catch (ApplicationException) { }
        _single?.Dispose();
        base.OnExit(e);
    }
}
