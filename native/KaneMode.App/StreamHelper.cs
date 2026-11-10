using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace KaneMode;

/// <summary>
/// Jeu de KaneMode lancé par Sunshine, pour une console qui le streame (Ally, PC portable…).
/// Sunshine exécute « KaneMode.exe --stream-game &lt;id&gt; » (alias d'exécution du paquet) : ce
/// processus demande au KaneMode déjà ouvert (ou qu'il ouvre) de lancer le jeu comme depuis sa
/// bibliothèque (réglages, manette, écran de lancement), puis attend la fin du jeu. Sa fin dit à
/// Sunshine que l'appli est terminée : le streaming s'arrête et la console revient à son KaneMode.
/// Quand la console quitte la session, Sunshine arrête ce processus puis lance
/// « KaneMode.exe --stop-game &lt;id&gt; », qui ferme le jeu.
/// Le dialogue passe par le canal du widget Game Bar (WidgetBridge), messages « stream-* ».
/// </summary>
public static class StreamHelper
{
    public static bool IsHelperCall(string[] args) =>
        args.Length >= 2 && (args[0] == "--stream-game" || args[0] == "--stop-game");

    public static async Task<int> RunAsync(string[] args)
    {
        string mode = args[0], id = args[1];
        Log.Write($"Sunshine : {mode} {id}");
        string? pipe = PipePath();
        if (pipe == null) { Log.Write("Sunshine : pas de paquet, pas de canal"); return 2; }

        if (mode == "--stop-game")
        {
            await AskAsync(pipe, new { type = "stream-stop", id });
            return 0;
        }

        // KaneMode fermé : il s'ouvre (comme depuis le menu Démarrer), puis reçoit la demande
        if (!Running()) Start();
        DateTime until = DateTime.UtcNow.AddSeconds(120);
        while (true)
        {
            var r = await AskAsync(pipe, new { type = "stream-game", id });
            if (r is { } ok && ok.TryGetProperty("ok", out var v) && v.ValueKind == JsonValueKind.True) break;
            if (DateTime.UtcNow > until) { Log.Write("Sunshine : KaneMode ne répond pas, abandon"); return 1; }
            await Task.Delay(1000);
        }

        // Puis attente de la fin du jeu (KaneMode fermé : fin aussi)
        int failures = 0;
        while (true)
        {
            await Task.Delay(2000);
            var r = await AskAsync(pipe, new { type = "stream-game-state", id });
            if (r == null) { if (++failures >= 5) break; continue; }
            failures = 0;
            string state = r.Value.TryGetProperty("state", out var s) ? s.GetString() ?? "" : "";
            if (state == "ended") break;
        }
        Log.Write($"Sunshine : fin de {id}");
        return 0;
    }

    private static string? PipePath()
    {
        string? family = Paths.AppUserModelId?.Split('!')[0];
        if (string.IsNullOrEmpty(family)) return null;
        string sid = WidgetBridge.ContainerSid(family);
        return $@"Sessions\{Process.GetCurrentProcess().SessionId}\AppContainerNamedObjects\{sid}\{WidgetBridge.PipeName}";
    }

    private static bool Running()
    {
        try { using var m = Mutex.OpenExisting("KaneMode-InstanceUnique"); return true; }
        catch { return false; }
    }

    private static void Start()
    {
        try
        {
            Process.Start(new ProcessStartInfo("explorer.exe", @"shell:AppsFolder\" + Paths.AppUserModelId) { UseShellExecute = false });
            Log.Write("Sunshine : KaneMode ouvert pour le jeu demandé");
        }
        catch (Exception ex) { Log.Write("Sunshine : ouverture de KaneMode impossible : " + ex.Message); }
    }

    /// <summary>Message natif à KaneMode ; renvoie le corps JSON de la réponse, ou null.</summary>
    private static async Task<JsonElement?> AskAsync(string pipe, object message)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", pipe, PipeDirection.InOut, PipeOptions.Asynchronous);
            using var cts = new CancellationTokenSource(3000);
            await client.ConnectAsync(cts.Token);
            byte[] line = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { native = message }) + "\n");
            await client.WriteAsync(line, cts.Token);
            await client.FlushAsync(cts.Token);
            using var reader = new StreamReader(client, new UTF8Encoding(false));
            string? answer = await reader.ReadLineAsync(cts.Token);
            if (answer == null) return null;
            using var doc = JsonDocument.Parse(answer);
            return doc.RootElement.TryGetProperty("body", out var body) ? body.Clone() : null;
        }
        catch (Exception ex) when (ex is IOException or TimeoutException or OperationCanceledException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }
}
