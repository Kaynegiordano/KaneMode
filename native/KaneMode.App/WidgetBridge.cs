using System.IO;
using System.IO.Pipes;
using System.Net.Http;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace KaneMode;

/// <summary>
/// Canal entre le widget Game Bar et KaneMode. Le widget est une application UWP, isolée du réseau
/// local : il ne peut pas joindre l'hôte sur 127.0.0.1 sans autorisation administrateur. Il passe
/// donc par un tube nommé que l'app crée dans l'espace de noms du conteneur de son paquet (le
/// widget l'ouvre sous le nom \\.\pipe\LOCAL\kanemode-widget). Une requête JSON par connexion :
/// - { method, path, body } : relayée à l'API de l'hôte, réponse { status, body } ;
/// - { native: { type, … } } : message pour l'app elle-même (veille, retour à KaneMode…), comme
///   ceux de son interface ; réponse { status: 200 }.
/// </summary>
public static class WidgetBridge
{
    public const string PipeName = "kanemode-widget";

    /// <summary>
    /// Message « natif » du widget (JSON d'un message de l'interface) ; renvoie le corps JSON de la
    /// réponse, ou null. Appelé hors du fil de l'interface.
    /// </summary>
    public static Func<string, string?>? NativeMessage;

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };
    private static string? _host;
    private static bool _started, _connected;

    /// <summary>Ouvre le canal (app installée seulement) ; `host` est l'adresse de l'hôte.</summary>
    public static void Start(string host)
    {
        _host = host;
        if (_started) return;
        try
        {
            // Famille du paquet (« KaneMode_… ») : le conteneur du widget porte ce nom
            string? family = Paths.AppUserModelId?.Split('!')[0];
            if (string.IsNullOrEmpty(family)) return; // pas de paquet (développement)
            var container = new SecurityIdentifier(ContainerSid(family));

            var security = new PipeSecurity();
            security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User!, PipeAccessRights.FullControl, AccessControlType.Allow));
            security.AddAccessRule(new PipeAccessRule(container, PipeAccessRights.ReadWrite, AccessControlType.Allow));
            // Nom complet du tube vu du conteneur : \Sessions\<session>\AppContainerNamedObjects\<SID>\...
            string name = $@"Sessions\{System.Diagnostics.Process.GetCurrentProcess().SessionId}\AppContainerNamedObjects\{container.Value}\{PipeName}";
            _started = true;
            // Plusieurs connexions à la fois : l'accès rapide lit les mesures pendant qu'on règle
            for (int i = 0; i < 4; i++) _ = Task.Run(() => ServeAsync(name, security));
            Log.Write("Canal du widget Game Bar ouvert");
        }
        catch (Exception ex) { Log.Write("Canal du widget Game Bar : " + ex.Message); }
    }

    /// <summary>
    /// SID du conteneur d'un paquet : « S-1-15-2- » suivi des 7 premiers mots de 32 bits du SHA-256 de
    /// son nom de famille en minuscules (UTF-16), comme DeriveAppContainerSidFromAppContainerName
    /// (qui plante lorsqu'on l'appelle depuis l'app installée).
    /// </summary>
    private static string ContainerSid(string family)
    {
        byte[] hash = System.Security.Cryptography.SHA256.HashData(Encoding.Unicode.GetBytes(family.ToLowerInvariant()));
        var parts = new uint[7];
        for (int i = 0; i < 7; i++) parts[i] = BitConverter.ToUInt32(hash, i * 4);
        return "S-1-15-2-" + string.Join("-", parts);
    }

    private static async Task ServeAsync(string name, PipeSecurity security)
    {
        while (true)
        {
            try
            {
                using var pipe = NamedPipeServerStreamAcl.Create(name, PipeDirection.InOut, NamedPipeServerStream.MaxAllowedServerInstances,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 0, 0, security);
                await pipe.WaitForConnectionAsync();
                if (!_connected) { _connected = true; Log.Write("Widget Game Bar : première requête reçue"); }
                using var reader = new StreamReader(pipe, new UTF8Encoding(false), false, 4096, leaveOpen: true);
                string? line = await reader.ReadLineAsync();
                string answer = line == null ? Error(400, "Requête vide") : await HandleAsync(line);
                byte[] bytes = Encoding.UTF8.GetBytes(answer + "\n");
                await pipe.WriteAsync(bytes);
                await pipe.FlushAsync();
                pipe.WaitForPipeDrain();
            }
            catch (Exception ex)
            {
                Log.Write("Canal du widget : " + ex.Message);
                await Task.Delay(500);
            }
        }
    }

    private static async Task<string> HandleAsync(string line)
    {
        try
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            if (root.TryGetProperty("native", out var native) && native.ValueKind == JsonValueKind.Object)
            {
                string body = NativeMessage?.Invoke(native.GetRawText()) ?? "{}";
                return $"{{\"status\":200,\"body\":{body}}}";
            }
            string method = root.GetProperty("method").GetString()?.ToUpperInvariant() switch { "POST" => "POST", "DELETE" => "DELETE", _ => "GET" };
            string path = root.GetProperty("path").GetString() ?? "";
            // Seulement l'API de l'hôte (réglages, énergie, jeux…)
            if (!path.StartsWith("/api/") || path.Contains("..") || _host == null) return Error(403, "Refusé");
            using var req = new HttpRequestMessage(new HttpMethod(method), _host + path);
            req.Headers.Add("X-KaneMode", "1");
            if (method == "POST")
                req.Content = new StringContent(root.TryGetProperty("body", out var b) && b.ValueKind != JsonValueKind.Null ? b.GetRawText() : "{}", Encoding.UTF8, "application/json");
            using var res = await Http.SendAsync(req);
            string text = await res.Content.ReadAsStringAsync();
            try { JsonDocument.Parse(text).Dispose(); } catch (JsonException) { text = JsonSerializer.Serialize(new { error = text }); }
            return $"{{\"status\":{(int)res.StatusCode},\"body\":{text}}}";
        }
        catch (Exception ex) when (ex is JsonException or HttpRequestException or TaskCanceledException or KeyNotFoundException or InvalidOperationException)
        {
            return Error(502, ex.Message);
        }
    }

    private static string Error(int status, string message) =>
        $"{{\"status\":{status},\"body\":{JsonSerializer.Serialize(new { error = message })}}}";
}
