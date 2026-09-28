using System.Drawing;

namespace KaneMode.Setup;

/// <summary>Fenêtre de l'installateur : ce qui va être fait, les options, puis le journal.</summary>
public sealed class SetupForm : Form
{
    private static readonly Color Bg = Color.FromArgb(14, 17, 23), Panel = Color.FromArgb(24, 29, 38), Text1 = Color.FromArgb(230, 233, 238), Muted = Color.FromArgb(140, 149, 163), Accent = Color.FromArgb(26, 159, 255);

    private readonly CheckBox _xbox, _dev, _launch;
    private readonly Button _install, _close, _restart;
    private readonly ListBox _log;
    private readonly Label _intro;
    private bool _busy;

    public SetupForm()
    {
        Text = $"Installer KaneMode {Installer.Version}";
        ClientSize = new Size(720, 560);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Bg;
        ForeColor = Text1;
        Font = new Font("Segoe UI", 10.5f);
        try { Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!); } catch { /* icône facultative */ }

        var title = new Label { Text = "KaneMode", Font = new Font("Segoe UI Semibold", 22f), AutoSize = true, Location = new Point(28, 20) };
        _intro = new Label
        {
            Text = "L’interface console façon SteamOS pour Windows, avec ses jeux de toutes les boutiques, l’émulation et le streaming. "
                 + "Elle devient l’application d’accueil du mode Xbox (plein écran) de Windows 11.",
            ForeColor = Muted, Location = new Point(30, 70), Size = new Size(660, 48),
        };

        bool compatible = Installer.XboxModeCompatible;
        _xbox = Option("Activer le mode Xbox (plein écran) de Windows",
            Installer.XboxModeOn ? "Déjà activé sur ce PC."
            : compatible ? "Installe l’outil Xbox Full Screen Experience Tool (8bit2qubit) et l’active sans fenêtre. Redémarrage nécessaire."
            : $"Windows {Installer.WindowsVersion} n’est pas encore compatible : faites les mises à jour Windows.", 130);
        _xbox.Checked = compatible && !Installer.XboxModeOn;
        _xbox.Enabled = compatible && !Installer.XboxModeOn;

        _dev = Option("Activer le mode développeur de Windows",
            Installer.DevModeOn ? "Déjà activé sur ce PC."
            : "Nécessaire pour que KaneMode puisse être choisi comme application d’accueil du mode Xbox (son autorisation n’est pas signée par Microsoft).", 205);
        _dev.Checked = true;
        _dev.Enabled = !Installer.DevModeOn;

        _launch = new CheckBox { Text = "Lancer KaneMode à la fin", Checked = true, AutoSize = true, Location = new Point(30, 280), ForeColor = Text1 };

        _log = new ListBox
        {
            Location = new Point(30, 315), Size = new Size(660, 170), BackColor = Panel, ForeColor = Text1,
            BorderStyle = BorderStyle.None, IntegralHeight = false, HorizontalScrollbar = true,
        };
        _log.Items.Add("L’app, son moteur .NET et le moteur de streaming sont inclus : aucun autre téléchargement,");
        _log.Items.Add("sauf l’outil Xbox s’il n’est pas encore installé.");

        _install = MakeButton("Installer", true, new Point(530, 505));
        _close = MakeButton("Annuler", false, new Point(400, 505));
        _restart = MakeButton("Redémarrer", true, new Point(270, 505));
        _restart.Visible = false;
        _install.Click += async (_, _) => await RunAsync();
        _close.Click += (_, _) => Close();
        _restart.Click += (_, _) => System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("shutdown.exe", "/r /t 0") { UseShellExecute = false, CreateNoWindow = true });
        FormClosing += (_, e) => { if (_busy) e.Cancel = true; };

        Controls.AddRange(new Control[] { title, _intro, _xbox, _dev, _launch, _log, _install, _close, _restart });
        AcceptButton = _install;

        if (!Installer.HasPayload("KaneMode.msix"))
        {
            _log.Items.Add("Cet installateur est incomplet (compilé sans le paquet KaneMode).");
            _install.Enabled = false;
        }
    }

    private CheckBox Option(string title, string desc, int y)
    {
        var box = new CheckBox { Text = title, AutoSize = true, Location = new Point(30, y), ForeColor = Text1, Font = new Font("Segoe UI Semibold", 10.5f) };
        Controls.Add(new Label { Text = desc, ForeColor = Muted, Location = new Point(50, y + 26), Size = new Size(640, 42), Font = new Font("Segoe UI", 9.5f) });
        return box;
    }

    private Button MakeButton(string text, bool primary, Point at)
    {
        var b = new Button
        {
            Text = text, Location = at, Size = new Size(160, 38), FlatStyle = FlatStyle.Flat,
            BackColor = primary ? Accent : Panel, ForeColor = primary ? Color.White : Text1, Cursor = Cursors.Hand,
        };
        b.FlatAppearance.BorderSize = 0;
        return b;
    }

    private void Log(string line)
    {
        _log.Items.Add(line);
        _log.TopIndex = Math.Max(0, _log.Items.Count - 1);
    }

    private async Task RunAsync()
    {
        _busy = true;
        _install.Enabled = _close.Enabled = _xbox.Enabled = _dev.Enabled = _launch.Enabled = false;
        _log.Items.Clear();
        var installer = new Installer(new Progress<string>(Log));
        bool ok = false;
        try
        {
            if (_dev.Checked) installer.EnableDevMode();
            installer.TrustCertificate();
            await installer.InstallAppAsync();
            if (_xbox.Checked) await installer.EnableXboxModeAsync();
            ok = true;
        }
        catch (Exception ex)
        {
            Log("ÉCHEC : " + ex.Message);
        }
        finally
        {
            installer.Cleanup();
            _busy = false;
        }

        _close.Text = "Fermer";
        _close.Enabled = true;
        if (!ok) return;

        Log("");
        Log("Terminé. Pour faire de KaneMode l’écran d’accueil :");
        Log("Paramètres > Jeux > Mode Xbox > Choisir l’application d’accueil > KaneMode.");
        if (installer.RestartNeeded)
        {
            Log("Redémarrez d’abord : le mode Xbox s’active au prochain démarrage.");
            _restart.Visible = true;
        }
        else Installer.Open("ms-settings:gaming-fullscreen");
        if (_launch.Checked && Installer.AppTarget() is string app) Installer.Open(app);
    }
}
