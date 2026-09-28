using System.Diagnostics;
using System.Net.Http.Json;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Microsoft.Win32;
using Windows.Management.Deployment;

namespace KaneMode.Setup;

/// <summary>
/// Étapes de l'installation. Chacune dit ce qu'elle fait (journal) et s'arrête proprement en cas d'échec.
/// </summary>
public sealed class Installer
{
    public const string ToolReleasesApi = "https://api.github.com/repos/8bit2qubit/XboxFullScreenExperienceTool/releases/latest";
    public static readonly string ToolDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "8bit2qubit", "Xbox FullScreen Experience Tool");
    private const string DevModeKey = @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock";
    private const string OemKey = @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\OEM";
    private const string CvKey = @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion";

    private readonly IProgress<string> _log;
    private readonly string _work = Path.Combine(Path.GetTempPath(), "KaneMode-Setup-" + Guid.NewGuid().ToString("N")[..8]);

    public Installer(IProgress<string> log) { _log = log; }

    public bool RestartNeeded { get; private set; }

    // ---------------------------------------------------------------- état du PC
    public static bool DevModeOn => Registry.GetValue(DevModeKey, "AllowDevelopmentWithoutDevLicense", 0) is int v && v == 1;

    public static bool XboxModeOn =>
        Registry.GetValue(OemKey, "DeviceForm", null) is int f && f == 0x2E && File.Exists(Path.Combine(ToolDir, "DeviceForm.bak"));

    /// <summary>Même seuils que XboxFullScreenExperienceTool (méthode native ou ancienne).</summary>
    public static bool XboxModeCompatible
    {
        get
        {
            int.TryParse(Registry.GetValue(CvKey, "CurrentBuild", "0")?.ToString(), out int b);
            int ubr = Registry.GetValue(CvKey, "UBR", 0) is int u ? u : 0;
            bool native = ((b == 26100 || b == 26200) && ubr >= 8328) || (b == 26220 && ubr >= 7271) || (b > 26220 && b != 28000);
            bool legacy = (b == 26100 && ubr >= 7019) || (b == 26200 && ubr >= 7015) || (b == 26220 && ubr >= 6972) || (b == 28000 && ubr >= 1450);
            return native || legacy;
        }
    }

    public static string WindowsVersion =>
        $"{Registry.GetValue(CvKey, "DisplayVersion", "")} (build {Registry.GetValue(CvKey, "CurrentBuild", "?")}.{Registry.GetValue(CvKey, "UBR", 0)})";

    public static string Version => Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "?";

    // ---------------------------------------------------------------- étapes
    public void EnableDevMode()
    {
        if (DevModeOn) { _log.Report("Mode développeur : déjà activé."); return; }
        Registry.SetValue(DevModeKey, "AllowDevelopmentWithoutDevLicense", 1, RegistryValueKind.DWord);
        _log.Report("Mode développeur activé.");
    }

    /// <summary>Le paquet est signé par « CN=KaneMode » : Windows doit faire confiance à ce certificat.</summary>
    public void TrustCertificate()
    {
        using var cert = new X509Certificate2(Resource("KaneMode.cer"));
        using var store = new X509Store(StoreName.TrustedPeople, StoreLocation.LocalMachine);
        store.Open(OpenFlags.ReadWrite);
        if (store.Certificates.Find(X509FindType.FindByThumbprint, cert.Thumbprint, false).Count == 0)
        {
            store.Add(cert);
            _log.Report($"Certificat KaneMode approuvé ({cert.Thumbprint[..8]}…).");
        }
        else _log.Report("Certificat KaneMode : déjà approuvé.");
    }

    public async Task InstallAppAsync()
    {
        Directory.CreateDirectory(_work);
        string msix = Path.Combine(_work, "KaneMode.msix");
        await File.WriteAllBytesAsync(msix, Resource("KaneMode.msix"));
        _log.Report("Installation de l’app KaneMode…");
        var pm = new PackageManager();
        var result = await pm.AddPackageAsync(new Uri(msix), null,
            DeploymentOptions.ForceApplicationShutdown | DeploymentOptions.ForceUpdateFromAnyVersion).AsTask();
        if (result.ExtendedErrorCode != null)
            throw new InvalidOperationException($"Windows a refusé le paquet : {result.ErrorText} (0x{result.ExtendedErrorCode.HResult:X8})");
        _log.Report("App KaneMode installée.");
        AllowWidgetLoopback();
    }

    /// <summary>
    /// Le widget Game Bar de KaneMode est une application UWP, isolée du réseau local : pour régler
    /// la console, il doit joindre l'hôte KaneMode sur cette machine (127.0.0.1). Exemption de
    /// bouclage pour le paquet, comme « CheckNetIsolation LoopbackExempt -a », conservée aux mises à jour.
    /// </summary>
    private void AllowWidgetLoopback()
    {
        string? family = null;
        foreach (var p in new PackageManager().FindPackagesForUser(string.Empty))
            if (p.Id.Name == "KaneMode") family = p.Id.FamilyName;
        if (family == null) return;
        try
        {
            var psi = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "CheckNetIsolation.exe"), $"LoopbackExempt -a -n={family}")
            { CreateNoWindow = true, UseShellExecute = false };
            using var proc = Process.Start(psi);
            proc?.WaitForExit(15000);
            _log.Report(proc?.ExitCode == 0 ? "Widget Game Bar : autorisé à joindre KaneMode." : "Widget Game Bar : autorisation réseau refusée par Windows.");
        }
        catch (Exception ex) { _log.Report("Widget Game Bar : " + ex.Message); }
    }

    /// <summary>Installe au besoin l'outil officiel puis active le mode Xbox sans interface.</summary>
    public async Task EnableXboxModeAsync()
    {
        if (XboxModeOn) { _log.Report("Mode Xbox : déjà activé."); return; }
        if (!XboxModeCompatible) { _log.Report($"Mode Xbox : Windows {WindowsVersion} n’est pas compatible, faites les mises à jour Windows puis relancez l’installateur."); return; }

        if (!File.Exists(Path.Combine(ToolDir, "XboxFullScreenExperienceTool.exe"))) await InstallToolAsync();

        Directory.CreateDirectory(_work);
        string enabler = Path.Combine(_work, "XboxModeEnabler.exe");
        await File.WriteAllBytesAsync(enabler, Resource("XboxModeEnabler.exe"));
        _log.Report("Activation du mode Xbox…");
        using var p = Process.Start(new ProcessStartInfo(enabler, $"/silentenable \"/installpath={ToolDir}\"") { UseShellExecute = false, CreateNoWindow = true })!;
        await p.WaitForExitAsync();
        switch (p.ExitCode)
        {
            case 0: _log.Report("Mode Xbox activé : un redémarrage est nécessaire."); RestartNeeded = true; break;
            case 2: _log.Report("Mode Xbox : build Windows non compatible."); break;
            case 3: throw new InvalidOperationException($"Outil Xbox introuvable dans {ToolDir}");
            default: throw new InvalidOperationException($"Échec de l’activation du mode Xbox (code {p.ExitCode}), journal : %TEMP%\\KaneMode-XboxMode.log");
        }
    }

    private async Task InstallToolAsync()
    {
        _log.Report("Téléchargement de Xbox Full Screen Experience Tool (8bit2qubit, GitHub)…");
        using var http = new HttpClient();
        http.DefaultRequestHeaders.UserAgent.ParseAdd("KaneMode-Setup");
        var release = await http.GetFromJsonAsync<JsonElement>(ToolReleasesApi);
        JsonElement? asset = null;
        foreach (var a in release.GetProperty("assets").EnumerateArray())
            if (a.GetProperty("name").GetString()!.EndsWith("-Full.msi", StringComparison.OrdinalIgnoreCase)) asset = a;
        if (asset is not JsonElement msi) throw new InvalidOperationException("Installateur de l’outil Xbox introuvable sur GitHub");

        string file = Path.Combine(_work, msi.GetProperty("name").GetString()!);
        Directory.CreateDirectory(_work);
        byte[] data = await http.GetByteArrayAsync(msi.GetProperty("browser_download_url").GetString());
        // GitHub publie l'empreinte de chaque fichier : on la vérifie quand elle est fournie
        if (msi.TryGetProperty("digest", out var digest) && digest.GetString() is string d && d.StartsWith("sha256:"))
        {
            string hash = Convert.ToHexString(SHA256.HashData(data));
            if (!hash.Equals(d[7..], StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Empreinte de l’outil Xbox incorrecte : téléchargement rejeté");
        }
        await File.WriteAllBytesAsync(file, data);
        _log.Report($"Installation de {Path.GetFileName(file)}…");
        using var p = Process.Start(new ProcessStartInfo("msiexec.exe", $"/i \"{file}\" /qn /norestart") { UseShellExecute = false })!;
        await p.WaitForExitAsync();
        if (p.ExitCode != 0 && p.ExitCode != 3010) throw new InvalidOperationException($"Échec de l’installation de l’outil Xbox (code {p.ExitCode})");
        _log.Report("Outil Xbox installé.");
    }

    public void Cleanup()
    {
        try { if (Directory.Exists(_work)) Directory.Delete(_work, true); } catch { /* fichiers temporaires */ }
    }

    private static byte[] Resource(string name)
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"Fichier « {name} » absent de l’installateur (compilation incomplète)");
        using var m = new MemoryStream();
        s.CopyTo(m);
        return m.ToArray();
    }

    /// <summary>Lanceur de l'app installée : shell:AppsFolder\&lt;famille du paquet&gt;!App.</summary>
    public static string? AppTarget()
    {
        foreach (var p in new PackageManager().FindPackagesForUser(string.Empty))
            if (p.Id.Name == "KaneMode") return $"shell:AppsFolder\\{p.Id.FamilyName}!App";
        return null;
    }

    public static bool HasPayload(string name) => Assembly.GetExecutingAssembly().GetManifestResourceNames().Contains(name);

    /// <summary>Ouvre une page des Paramètres ou lance l'app (sans droits administrateur via l'Explorateur).</summary>
    public static void Open(string target) => Process.Start(new ProcessStartInfo("explorer.exe", target) { UseShellExecute = false });
}
