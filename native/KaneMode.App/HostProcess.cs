using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;

namespace KaneMode;

/// <summary>
/// Démarre l'hôte KaneMode (host\server.js) en arrière-plan sur un port libre et attend qu'il réponde.
/// L'hôte est rattaché à l'app : il s'arrête avec elle, même en cas de plantage.
/// </summary>
public sealed class HostProcess : IDisposable
{
    private Process? _process;

    public int Port { get; private set; }
    public string Url => $"http://127.0.0.1:{Port}";

    public async Task StartAsync(CancellationToken token = default)
    {
        string node = Paths.Node ?? throw new InvalidOperationException("Node.js est introuvable. Installez-le (winget install OpenJS.NodeJS.LTS).");
        string server = Path.Combine(Paths.Root, "host", "server.js");
        if (!File.Exists(server)) throw new FileNotFoundException("Fichiers de KaneMode introuvables", server);

        Port = FreePort();
        var psi = new ProcessStartInfo(node, $"\"{server}\"")
        {
            WorkingDirectory = Paths.Root,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.Environment["PORT"] = Port.ToString();
        psi.Environment["KANEMODE_DATA"] = Paths.Data;
        psi.Environment["KANEMODE_NATIVE"] = "1";
        // Version de l'app installée : l'hôte la compare aux versions publiées (mises à jour)
        psi.Environment["KANEMODE_VERSION"] = typeof(App).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
        psi.Environment["KANEMODE_PACKAGED"] = Paths.Packaged ? "1" : "0";

        Log.Write($"Hôte : {node} {server} (port {Port})");
        _process = Process.Start(psi) ?? throw new InvalidOperationException("Impossible de démarrer l'hôte");
        Native.TieToApp(_process);
        _process.OutputDataReceived += (_, e) => { if (e.Data != null) Log.Write("[hôte] " + e.Data); };
        _process.ErrorDataReceived += (_, e) => { if (e.Data != null) Log.Write("[hôte:erreur] " + e.Data); };
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(1) };
        var deadline = DateTime.UtcNow.AddSeconds(20);
        while (DateTime.UtcNow < deadline)
        {
            token.ThrowIfCancellationRequested();
            if (_process.HasExited) throw new InvalidOperationException($"L'hôte s'est arrêté (code {_process.ExitCode}). Détails : {Log.FilePath}");
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, Url + "/api/status");
                req.Headers.Add("X-KaneMode", "1");
                using var res = await http.SendAsync(req, token);
                if (res.StatusCode == HttpStatusCode.OK) return;
            }
            catch (HttpRequestException) { /* pas encore prêt */ }
            catch (TaskCanceledException) when (!token.IsCancellationRequested) { }
            await Task.Delay(150, token);
        }
        throw new TimeoutException("L'hôte KaneMode ne répond pas.");
    }

    private static int FreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    public void Dispose()
    {
        try { if (_process is { HasExited: false }) _process.Kill(); }
        catch (InvalidOperationException) { /* déjà arrêté */ }
        _process?.Dispose();
    }
}
