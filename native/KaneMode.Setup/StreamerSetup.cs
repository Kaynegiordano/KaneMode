using System.Diagnostics;
using System.Management;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace KaneMode.Setup;

/// <summary>
/// À quoi sert ce PC, choisi au début de l'installation : jouer (console, PC portable), streamer
/// (le PC qui diffuse avec Sunshine) ou les deux.
/// </summary>
public enum Role { Play, Stream, Both }

/// <summary>
/// Réglages d'un PC qui diffuse, faits par l'installateur (il a déjà les droits d'administrateur) :
/// manette de Sunshine en automatique, autorisation pour que KaneMode propose ses jeux aux consoles
/// (comme setup/sunshine-jeux/Autoriser.ps1), option « Proposer mes jeux aux consoles » activée,
/// complément d'échelle installé. Rien n'est téléchargé : sans Sunshine, l'installateur le dit.
/// </summary>
public sealed class StreamerSetup
{
    public static readonly string SunshineDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Sunshine");
    private const string Service = "SunshineService";
    private readonly IProgress<string> _log;

    public StreamerSetup(IProgress<string> log) { _log = log; }

    public static bool SunshineInstalled => File.Exists(Path.Combine(SunshineDir, "sunshine.exe"));

    /// <summary>
    /// Rôle proposé d'après la machine : une carte graphique dédiée (GeForce, Radeon RX / Pro, Arc)
    /// peut diffuser, donc « les deux » ; sinon (console portable, puce intégrée) « jouer ».
    /// </summary>
    public static Role SuggestedRole()
    {
        try
        {
            using var s = new ManagementObjectSearcher("SELECT Name FROM Win32_VideoController");
            foreach (ManagementObject o in s.Get())
                if (Regex.IsMatch(o["Name"]?.ToString() ?? "", @"GeForce|Quadro|NVIDIA RTX|Radeon\s*(RX|Pro)|Arc\s*[AB]\d", RegexOptions.IgnoreCase)) return Role.Both;
        }
        catch { /* WMI indisponible */ }
        return Role.Play;
    }

    public void Run()
    {
        if (!SunshineInstalled)
        {
            _log.Report("Sunshine n’est pas installé : installez-le depuis github.com/LizardByte/Sunshine, puis relancez cet installateur");
            _log.Report("(ou activez « Proposer mes jeux aux consoles » dans Paramètres → Streaming de KaneMode).");
            return;
        }
        string config = Path.Combine(SunshineDir, "config");
        string apps = AppsFile(config);
        var user = InteractiveUser();
        if (user == null) throw new InvalidOperationException("Compte Windows de l’utilisateur introuvable");

        // 1. Manette : la console qui streame donne son type (PlayStation, Xbox…)
        string conf = Path.Combine(config, "sunshine.conf");
        string before = File.Exists(conf) ? File.ReadAllText(conf) : "";
        string after = WithAutoGamepad(before, ViGEmInstalled());
        if (after != before)
        {
            if (File.Exists(conf)) File.Copy(conf, conf + ".avant-kanemode.bak", true);
            File.WriteAllText(conf, after);
            _log.Report("Sunshine : manette en automatique (type de la manette de la console).");
        }
        else _log.Report("Sunshine : manette déjà en automatique.");

        // 2. Autorisation : KaneMode met à jour les applis de Sunshine et redémarre son service
        if (File.Exists(apps))
        {
            Exec("icacls.exe", $"\"{apps}\" /grant *{user.Value.Sid}:(M)");
            string sd = Exec("sc.exe", $"sdshow {Service}").Replace("\r", "").Replace("\n", "").Trim();
            string ace = $"(A;;RPWPLCLO;;;{user.Value.Sid})";
            if (sd.StartsWith("D:") && !sd.Contains(ace))
            {
                int i = sd.IndexOf("S:", StringComparison.Ordinal);
                Exec("sc.exe", $"sdset {Service} {(i >= 0 ? sd[..i] + ace + sd[i..] : sd + ace)}");
            }
            _log.Report("Sunshine : KaneMode autorisé à proposer ses jeux aux consoles.");
        }

        // 3. Option « Proposer mes jeux aux consoles » (KaneMode publie la liste à son démarrage)
        string? data = KaneModeData(user.Value.Sid);
        if (data != null)
        {
            Directory.CreateDirectory(data);
            string file = Path.Combine(data, "config.json");
            JsonObject cfg;
            try { cfg = JsonNode.Parse(File.ReadAllText(file)) as JsonObject ?? new JsonObject(); }
            catch { cfg = new JsonObject(); }
            cfg["sunshineGames"] = true;
            File.WriteAllText(file, cfg.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            _log.Report("KaneMode : jeux proposés aux consoles en streaming.");
        }

        // 4. Complément d'échelle (variantes « [150 %] ») : script embarqué dans l'app installée
        string? scale = Installer.AppFile(@"app\setup\hote-echelle\Installer.ps1");
        if (scale != null)
        {
            var p = Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -ExecutionPolicy Bypass -File \"{scale}\"") { UseShellExecute = false, CreateNoWindow = true });
            p!.WaitForExit(120000);
            _log.Report(p.ExitCode == 0 ? "Sunshine : complément d’échelle installé." : $"Complément d’échelle : échec (code {p.ExitCode}).");
        }

        // 5. Sunshine relit ses réglages (pas pendant un streaming : au prochain démarrage)
        if (StreamActive(Path.Combine(config, "sunshine.log"))) _log.Report("Streaming en cours : Sunshine prendra ses réglages à son prochain démarrage.");
        else Restart();
    }

    /// <summary>sunshine.conf avec « gamepad = auto » ; pilote ViGEmBus ajouté s'il est là et que rien n'est choisi.</summary>
    public static string WithAutoGamepad(string conf, bool vigem)
    {
        var lines = conf.Replace("\r\n", "\n").Split('\n').Where(l => l.Length > 0 && !Regex.IsMatch(l, @"^\s*gamepad\s*=")).ToList();
        lines.Insert(0, "gamepad = auto");
        if (vigem && !lines.Any(l => Regex.IsMatch(l, @"^\s*gamepad_driver\s*="))) lines.Add("gamepad_driver = vigembus");
        string result = string.Join(Environment.NewLine, lines) + Environment.NewLine;
        // Rien à changer : on garde le fichier tel quel
        return Normalize(result) == Normalize(conf) ? conf : result;
    }

    private static string Normalize(string s) => s.Replace("\r\n", "\n").TrimEnd('\n');

    /// <summary>Streaming en cours : dernière connexion d'un client sans déconnexion après.</summary>
    public static bool StreamActive(string log)
    {
        try
        {
            using var f = new FileStream(log, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            long len = Math.Min(f.Length, 512 * 1024);
            f.Seek(-len, SeekOrigin.End);
            var buf = new byte[len];
            f.ReadExactly(buf);
            string text = System.Text.Encoding.UTF8.GetString(buf);
            // Fin de session : console déconnectée, ou jeu fermé (« Process terminated »)
            int ended = Math.Max(text.LastIndexOf("CLIENT DISCONNECTED", StringComparison.Ordinal), text.LastIndexOf("Process terminated", StringComparison.Ordinal));
            return text.LastIndexOf("CLIENT CONNECTED", StringComparison.Ordinal) > ended;
        }
        catch { return false; }
    }

    private static string AppsFile(string config)
    {
        string file = Path.Combine(config, "apps.json");
        try
        {
            var m = Regex.Match(File.ReadAllText(Path.Combine(config, "sunshine.conf")), @"^\s*file_apps\s*=\s*(.+?)\s*$", RegexOptions.Multiline);
            if (m.Success) file = Path.IsPathRooted(m.Groups[1].Value) ? m.Groups[1].Value : Path.Combine(config, m.Groups[1].Value);
        }
        catch { /* pas de sunshine.conf */ }
        return file;
    }

    private static bool ViGEmInstalled()
    {
        try { using var s = new ServiceController("ViGEmBus"); _ = s.Status; return true; }
        catch { return false; }
    }

    /// <summary>
    /// Compte de la personne connectée (celui de KaneMode), pas forcément celui de l'administrateur
    /// qui a accepté la demande de Windows.
    /// </summary>
    private static (string Sid, string Name)? InteractiveUser()
    {
        try
        {
            using var s = new ManagementObjectSearcher("SELECT UserName FROM Win32_ComputerSystem");
            foreach (ManagementObject o in s.Get())
                if (o["UserName"]?.ToString() is string name && name.Length > 0)
                    return (((SecurityIdentifier)new NTAccount(name).Translate(typeof(SecurityIdentifier))).Value, name);
        }
        catch { /* session distante, WMI indisponible */ }
        var me = WindowsIdentity.GetCurrent();
        return me.User != null ? (me.User.Value, me.Name) : null;
    }

    /// <summary>Dossier de données de KaneMode de ce compte (%LOCALAPPDATA%\KaneMode\data).</summary>
    private static string? KaneModeData(string sid)
    {
        string? profile = Registry.GetValue($@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\{sid}", "ProfileImagePath", null) as string;
        return profile == null ? null : Path.Combine(Environment.ExpandEnvironmentVariables(profile), "AppData", "Local", "KaneMode", "data");
    }

    private void Restart()
    {
        try
        {
            using var s = new ServiceController(Service);
            if (s.Status == ServiceControllerStatus.Running) { s.Stop(); s.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(20)); }
            s.Start();
            s.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(20));
            _log.Report("Sunshine redémarré avec ses nouveaux réglages.");
        }
        catch (Exception ex) { _log.Report("Redémarrage de Sunshine impossible : " + ex.Message); }
    }

    private static string Exec(string exe, string args)
    {
        var p = Process.Start(new ProcessStartInfo(exe, args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true })!;
        string output = p.StandardOutput.ReadToEnd();
        p.WaitForExit(30000);
        if (p.ExitCode != 0) throw new InvalidOperationException($"{exe} : code {p.ExitCode} {output.Trim()}");
        return output;
    }
}
