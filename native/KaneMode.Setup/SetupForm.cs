using System.Drawing;

namespace KaneMode.Setup;

/// <summary>
/// Fenêtre de l'installateur : à quoi sert ce PC (jouer, streamer, les deux), les options qui en
/// découlent (cochées d'après ce choix, modifiables), puis le journal.
/// </summary>
public sealed class SetupForm : Form
{
    private static readonly Color Bg = Color.FromArgb(14, 17, 23), Panel = Color.FromArgb(24, 29, 38), Text1 = Color.FromArgb(230, 233, 238), Muted = Color.FromArgb(140, 149, 163), Accent = Color.FromArgb(26, 159, 255);

    private readonly CheckBox _xbox, _dev, _launch;
    private readonly RadioButton _play, _stream, _both;
    private readonly Label _roleInfo;
    private readonly Button _install, _close, _restart;
    private readonly ListBox _log;
    private readonly Label _intro;
    private readonly bool _xboxCompatible;
    private bool _busy;

    public SetupForm(Setup.Role? forced = null)
    {
        Text = $"Installer KaneMode {Installer.Version}";
        ClientSize = new Size(720, 640);
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

        // ---- À quoi sert ce PC
        var roleTitle = new Label { Text = "Ce PC sert à…", Font = new Font("Segoe UI Semibold", 10.5f), AutoSize = true, Location = new Point(30, 124) };
        _play = RoleButton("Jouer", 30);
        _stream = RoleButton("Streamer", 200);
        _both = RoleButton("Les deux", 370);
        _roleInfo = new Label { ForeColor = Muted, Location = new Point(30, 182), Size = new Size(660, 44), Font = new Font("Segoe UI", 9.5f) };

        _xboxCompatible = Installer.XboxModeCompatible;
        _xbox = Option("Activer le mode Xbox (plein écran) de Windows",
            Installer.XboxModeOn ? "Déjà activé sur ce PC."
            : _xboxCompatible ? "Installe l’outil Xbox Full Screen Experience Tool (8bit2qubit) et l’active sans fenêtre. Redémarrage nécessaire."
            : $"Windows {Installer.WindowsVersion} n’est pas encore compatible : faites les mises à jour Windows.", 232);
        Lock(_xbox, !_xboxCompatible || Installer.XboxModeOn, Installer.XboxModeOn);

        _dev = Option("Activer le mode développeur de Windows",
            Installer.DevModeOn ? "Déjà activé sur ce PC."
            : "Nécessaire pour que KaneMode puisse être choisi comme application d’accueil du mode Xbox (son autorisation n’est pas signée par Microsoft).", 304);
        Lock(_dev, Installer.DevModeOn, Installer.DevModeOn);

        _launch = new CheckBox { Text = "Lancer KaneMode à la fin", Checked = true, AutoSize = true, Location = new Point(30, 378), ForeColor = Text1 };

        _log = new ListBox
        {
            Location = new Point(30, 412), Size = new Size(660, 160), BackColor = Panel, ForeColor = Text1,
            BorderStyle = BorderStyle.None, IntegralHeight = false, HorizontalScrollbar = true,
        };
        _log.Items.Add("L’app, son moteur .NET et le moteur de streaming sont inclus : aucun autre téléchargement,");
        _log.Items.Add("sauf l’outil Xbox s’il n’est pas encore installé.");

        _install = MakeButton("Installer", true, new Point(530, 586));
        _close = MakeButton("Annuler", false, new Point(400, 586));
        _restart = MakeButton("Redémarrer", true, new Point(270, 586));
        _restart.Visible = false;
        _install.Click += async (_, _) => await RunAsync();
        _close.Click += (_, _) => Close();
        _restart.Click += (_, _) => System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("shutdown.exe", "/r /t 0") { UseShellExecute = false, CreateNoWindow = true });
        FormClosing += (_, e) => { if (_busy) e.Cancel = true; };

        Controls.AddRange(new Control[] { title, _intro, roleTitle, _play, _stream, _both, _roleInfo, _xbox, _dev, _launch, _log, _install, _close, _restart });
        AcceptButton = _install;

        // Choix proposé d'après la machine (carte graphique dédiée : les deux), modifiable
        Setup.Role suggested = forced ?? StreamerSetup.SuggestedRole();
        (suggested == Setup.Role.Play ? _play : suggested == Setup.Role.Stream ? _stream : _both).Checked = true;
        ApplyRole();

        if (!Installer.HasPayload("KaneMode.msix"))
        {
            _log.Items.Add("Cet installateur est incomplet (compilé sans le paquet KaneMode).");
            _install.Enabled = false;
        }
    }

    private Setup.Role SelectedRole => _stream.Checked ? Setup.Role.Stream : _both.Checked ? Setup.Role.Both : Setup.Role.Play;

    private RadioButton RoleButton(string text, int x)
    {
        var r = new RadioButton { Text = text, AutoSize = true, Location = new Point(x, 150), ForeColor = Text1, Font = new Font("Segoe UI Semibold", 10.5f) };
        r.CheckedChanged += (_, _) => { if (r.Checked) ApplyRole(); };
        return r;
    }

    /// <summary>Options cochées selon le rôle ; l'explication dit ce qui sera réglé.</summary>
    private void ApplyRole()
    {
        Setup.Role role = SelectedRole;
        bool console = role != Setup.Role.Stream;
        if (_xbox.AutoCheck) _xbox.Checked = console;
        if (_dev.AutoCheck) _dev.Checked = console;
        string sunshine = StreamerSetup.SunshineInstalled ? "Sunshine : manette automatique, jeux de KaneMode proposés aux consoles, complément d’échelle."
            : "Sunshine n’est pas installé sur ce PC : installez-le d’abord pour diffuser (rien n’est téléchargé ici).";
        _roleInfo.Text = role switch
        {
            Setup.Role.Play => "Console ou PC portable : KaneMode en plein écran au démarrage, et le streaming vers vos autres PC (leurs jeux s’ajoutent dans Paramètres → Streaming).",
            Setup.Role.Stream => "PC qui diffuse vers vos consoles. " + sunshine,
            _ => "Ce PC joue et diffuse. " + sunshine,
        };
    }

    /// <summary>
    /// Option qu'on ne peut pas changer (déjà faite, ou Windows pas compatible) : verrouillée mais
    /// lisible (une case désactivée s'écrit en gris foncé, illisible sur ce fond).
    /// </summary>
    private static void Lock(CheckBox box, bool locked, bool done)
    {
        if (!locked) return;
        box.AutoCheck = false;
        box.Checked = done;
        box.ForeColor = Muted;
        box.Cursor = Cursors.Default;
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
        Setup.Role role = SelectedRole;
        _install.Enabled = _close.Enabled = _xbox.Enabled = _dev.Enabled = _launch.Enabled = false;
        _play.Enabled = _stream.Enabled = _both.Enabled = false;
        _log.Items.Clear();
        var progress = new Progress<string>(Log);
        var installer = new Installer(progress);
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

        // PC qui diffuse : Sunshine réglé ; un échec ici n'empêche pas d'utiliser KaneMode
        if (ok && role != Setup.Role.Play)
        {
            try { await Task.Run(() => new StreamerSetup(progress).Run()); }
            catch (Exception ex) { Log("Réglages du streaming : " + ex.Message + " (à refaire dans Paramètres → Streaming)"); }
        }
        installer.Cleanup();
        _busy = false;

        _close.Text = "Fermer";
        _close.Enabled = true;
        if (!ok) return;

        Log("");
        if (_xbox.Checked || Installer.XboxModeOn)
        {
            Log("Terminé. Pour faire de KaneMode l’écran d’accueil :");
            Log("Paramètres > Jeux > Mode Xbox > Choisir l’application d’accueil > KaneMode.");
        }
        else Log("Terminé.");
        if (installer.RestartNeeded)
        {
            Log("Redémarrez d’abord : le mode Xbox s’active au prochain démarrage.");
            _restart.Visible = true;
        }
        else if (_xbox.Checked) Installer.Open("ms-settings:gaming-fullscreen");
        if (_launch.Checked && Installer.AppTarget() is string app) Installer.Open(app);
    }

    /// <summary>Image de la fenêtre sans l'afficher (vérification, option --apercu).</summary>
    public void SaveImage(string png)
    {
        // Affichée hors de l'écran (jamais visible), le temps que ses contrôles se dessinent
        StartPosition = FormStartPosition.Manual;
        Location = new Point(-20000, -20000);
        ShowInTaskbar = false;
        Show();
        Application.DoEvents();
        using var bmp = new Bitmap(Width, Height);
        DrawToBitmap(bmp, new Rectangle(0, 0, Width, Height));
        bmp.Save(png, System.Drawing.Imaging.ImageFormat.Png);
    }
}
