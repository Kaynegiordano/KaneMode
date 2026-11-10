// Lanceur des jeux de KaneMode pour Sunshine (streaming vers une console), en C# 5 / .NET Framework 4
// (fourni avec Windows) : un petit exécutable ordinaire, copié par KaneMode dans
// %LOCALAPPDATA%\KaneMode\bin. Sunshine lance ses applis dans un groupe de processus (job), d'où
// l'alias de l'app installée (KaneMode.exe, paquet MSIX) était refusé : « Failed to launch process: 5 ».
//   KaneModeStream.exe --stream-game <id> --app <AUMID>   demande le jeu au KaneMode ouvert (ou qu'il
//       ouvre), puis attend sa fin : Sunshine arrête alors le streaming
//   KaneModeStream.exe --stop-game <id> --app <AUMID>     ferme le jeu (fin de session sur la console)
// Dialogue par le canal du widget Game Bar de KaneMode (native/KaneMode.App/WidgetBridge.cs).
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

static class KaneModeStream
{
    static int Main(string[] args)
    {
        string mode = null, id = null, aumid = null;
        for (int i = 0; i + 1 < args.Length; i++)
        {
            if (args[i] == "--stream-game" || args[i] == "--stop-game") { mode = args[i]; id = args[i + 1]; }
            else if (args[i] == "--app") aumid = args[i + 1];
        }
        if (mode == null || id == null || aumid == null) return 2;
        string pipe = PipeName(aumid.Split('!')[0]);

        if (mode == "--stop-game") { Ask(pipe, "stream-stop", id); return 0; }

        // KaneMode fermé : il s'ouvre (comme depuis le menu Démarrer), puis reçoit la demande
        if (Ask(pipe, "stream-game", id) == null) StartKaneMode(aumid);
        DateTime until = DateTime.UtcNow.AddSeconds(120);
        while (true)
        {
            string r = Ask(pipe, "stream-game", id);
            if (r != null && r.Contains("\"ok\":true")) break;
            if (DateTime.UtcNow > until) return 1;
            Thread.Sleep(1000);
        }

        // Fin du jeu (ou de KaneMode) : fin de ce processus, donc du streaming
        int failures = 0;
        while (true)
        {
            Thread.Sleep(2000);
            string r = Ask(pipe, "stream-game-state", id);
            if (r == null) { if (++failures >= 5) break; continue; }
            failures = 0;
            if (r.Contains("\"state\":\"ended\"")) break;
        }
        return 0;
    }

    // Nom du canal dans l'espace du conteneur du paquet : SID « S-1-15-2- » + 7 mots du SHA-256 du nom de famille
    static string PipeName(string family)
    {
        byte[] h;
        using (var sha = SHA256.Create()) h = sha.ComputeHash(Encoding.Unicode.GetBytes(family.ToLowerInvariant()));
        var sid = new StringBuilder("S-1-15-2");
        for (int i = 0; i < 7; i++) sid.Append('-').Append(BitConverter.ToUInt32(h, i * 4));
        return "Sessions\\" + Process.GetCurrentProcess().SessionId + "\\AppContainerNamedObjects\\" + sid + "\\kanemode-widget";
    }

    static string Ask(string pipe, string type, string id)
    {
        try
        {
            using (var client = new NamedPipeClientStream(".", pipe, PipeDirection.InOut))
            {
                client.Connect(3000);
                string json = "{\"native\":{\"type\":\"" + type + "\",\"id\":\"" + id.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"}}\n";
                byte[] bytes = new UTF8Encoding(false).GetBytes(json);
                client.Write(bytes, 0, bytes.Length);
                client.Flush();
                return new StreamReader(client, new UTF8Encoding(false)).ReadLine();
            }
        }
        catch (Exception) { return null; }
    }

    static void StartKaneMode(string aumid)
    {
        try { Process.Start(new ProcessStartInfo("explorer.exe", "shell:AppsFolder\\" + aumid) { UseShellExecute = false }); }
        catch (Exception) { /* KaneMode s'ouvrira peut-être autrement */ }
    }
}
