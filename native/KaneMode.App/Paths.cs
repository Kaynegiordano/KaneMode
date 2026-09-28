using System.IO;

namespace KaneMode;

/// <summary>
/// Emplacements utilisés par l'app. Deux cas :
/// - installée (paquet MSIX) : l'interface et l'hôte sont dans &lt;app&gt;\app, Node dans &lt;app&gt;\node ;
/// - développement : l'exe tourne depuis native\...\bin et le dépôt KaneMode est un dossier parent.
/// Les données vont toujours dans %LOCALAPPDATA%\KaneMode, le dossier d'installation étant en lecture seule.
/// </summary>
public static class Paths
{
    public static string AppDir { get; } = AppContext.BaseDirectory;

    /// <summary>Vrai quand l'app tourne depuis son paquet MSIX installé (identité de paquet).</summary>
    public static bool Packaged { get; } = HasPackageIdentity();

    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern int GetCurrentPackageFullName(ref int length, System.Text.StringBuilder? name);

    private static bool HasPackageIdentity()
    {
        int length = 0;
        // APPMODEL_ERROR_NO_PACKAGE (15700) : pas de paquet ; ERROR_INSUFFICIENT_BUFFER (122) : paquet
        return GetCurrentPackageFullName(ref length, null) == 122;
    }

    /// <summary>Dossier contenant host\server.js et ui\.</summary>
    public static string Root { get; } = FindRoot();

    public static string LocalRoot { get; } = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KaneMode");

    public static string Data => System.IO.Path.Combine(LocalRoot, "data");
    public static string WebViewData => System.IO.Path.Combine(LocalRoot, "webview");
    public static string Logs => System.IO.Path.Combine(LocalRoot, "logs");

    /// <summary>Node fourni avec l'app, sinon celui installé sur le PC.</summary>
    public static string? Node
    {
        get
        {
            string bundled = System.IO.Path.Combine(AppDir, "node", "node.exe");
            if (File.Exists(bundled)) return bundled;
            foreach (string dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
            {
                try
                {
                    string candidate = System.IO.Path.Combine(dir.Trim(), "node.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch (ArgumentException) { /* entrée de PATH invalide */ }
            }
            return null;
        }
    }

    private static string FindRoot()
    {
        string packaged = System.IO.Path.Combine(AppDir, "app");
        if (File.Exists(System.IO.Path.Combine(packaged, "host", "server.js"))) return packaged;
        for (var dir = new DirectoryInfo(AppDir); dir != null; dir = dir.Parent)
        {
            if (File.Exists(System.IO.Path.Combine(dir.FullName, "host", "server.js"))) return dir.FullName;
        }
        return packaged;
    }

    /// <summary>
    /// Premier lancement : reprend la bibliothèque et les réglages du prototype (dossier data du dépôt),
    /// dont le chemin est noté à la compilation dans app\source-root.txt.
    /// </summary>
    public static void ImportPrototypeData()
    {
        Directory.CreateDirectory(Data);
        if (File.Exists(System.IO.Path.Combine(Data, "library.json"))) return;
        string? source = null;
        string marker = System.IO.Path.Combine(Root, "source-root.txt");
        if (File.Exists(marker)) source = System.IO.Path.Combine(File.ReadAllText(marker).Trim(), "data");
        else if (Directory.Exists(System.IO.Path.Combine(Root, "data"))) source = System.IO.Path.Combine(Root, "data");
        if (source == null || !File.Exists(System.IO.Path.Combine(source, "library.json"))) return;

        foreach (string file in Directory.GetFiles(source, "*.json"))
        {
            File.Copy(file, System.IO.Path.Combine(Data, System.IO.Path.GetFileName(file)), overwrite: false);
        }
        foreach (string sub in new[] { "icons", "art" })
        {
            string from = System.IO.Path.Combine(source, sub);
            if (!Directory.Exists(from)) continue;
            string to = System.IO.Path.Combine(Data, sub);
            Directory.CreateDirectory(to);
            foreach (string file in Directory.GetFiles(from))
            {
                string dest = System.IO.Path.Combine(to, System.IO.Path.GetFileName(file));
                if (!File.Exists(dest)) File.Copy(file, dest);
            }
        }
        Log.Write($"Données du prototype importées depuis {source}");
    }
}
