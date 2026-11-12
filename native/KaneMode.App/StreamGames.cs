using System.Text.Json;
using System.Windows.Threading;

namespace KaneMode;

/// <summary>
/// Jeux lancés par Sunshine pour une console qui streame ce PC (lanceur native/KaneMode.Stream) : la demande
/// passe par l'interface, qui lance le jeu comme depuis la bibliothèque ; le lanceur de Sunshine
/// demande ensuite son état jusqu'à sa fin, et « stream-stop » le ferme quand la console quitte.
/// </summary>
public partial class MainWindow
{
    private sealed class StreamRequest
    {
        public string Id = "";
        public DateTime At = DateTime.UtcNow;
        public bool Seen, Failed;
    }

    private StreamRequest? _stream;
    // Délai pour qu'un jeu demandé apparaisse (Steam qui se met à jour, émulateur téléchargé…)
    private const int StreamStartSeconds = 180;

    private string? StreamGameMessage(string type, string id)
    {
        if (string.IsNullOrEmpty(id)) return JsonSerializer.Serialize(new { ok = false });
        var s = _stream;
        switch (type)
        {
            case "stream-game":
                if (!_ready) return JsonSerializer.Serialize(new { ok = false });
                // Le lanceur redemande tant qu'il n'a pas de réponse : une seule demande par jeu
                if (s != null && s.Id == id && !s.Failed && (s.Seen || (DateTime.UtcNow - s.At).TotalSeconds < StreamStartSeconds))
                    return JsonSerializer.Serialize(new { ok = true });
                _stream = new StreamRequest { Id = id };
                Log.Write($"Sunshine : lancement demandé par une console en streaming : {id}");
                Show();
                Native.ForceForeground(Hwnd);
                Post(new { type = "stream-launch", id });
                return JsonSerializer.Serialize(new { ok = true });

            case "stream-game-state":
                var g = _game;
                if (g != null && g.Id == id)
                {
                    if (s != null && s.Id == id) s.Seen = true;
                    return JsonSerializer.Serialize(new { state = "running" });
                }
                bool starting = s != null && s.Id == id && !s.Seen && !s.Failed && (DateTime.UtcNow - s.At).TotalSeconds < StreamStartSeconds;
                return JsonSerializer.Serialize(new { state = starting ? "starting" : "ended" });

            case "stream-launch-failed":
                if (s != null && s.Id == id) { s.Failed = true; Log.Write($"Sunshine : lancement impossible : {id}"); }
                return null;

            case "stream-stop":
                // La console a quitté la session : le jeu se ferme (fenêtre fermée, puis forcé après 4 s)
                if (s != null && s.Id == id) _stream = null;
                var game = _game;
                if (game == null || game.Id != id) return JsonSerializer.Serialize(new { ok = true });
                Log.Write($"Sunshine : session quittée, fermeture de {id}");
                if (id.StartsWith("rom:", StringComparison.Ordinal)) Post(new { type = "game-quitting", id, full = false });
                StopGame(game.Id, game.Dir, force: false);
                var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };
                timer.Tick += (_, _) =>
                {
                    timer.Stop();
                    if (_game != game) return;
                    string? d = GameDir(game.Dir);
                    bool alive = (d != null && Native.ProcessesIn(d).Count > 0) || (game.Pid != 0 && Native.ProcessRunning(game.Pid));
                    if (alive) StopGame(game.Id, game.Dir, force: true);
                };
                timer.Start();
                return JsonSerializer.Serialize(new { ok = true });
        }
        return null;
    }
}
