using Playnite.SDK;
using Playnite.SDK.Data;
using Playnite.SDK.Events;
using Playnite.SDK.Models;
using Playnite.SDK.Plugins;
using System;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace KaneMode.LibraryBridge
{
    // Les comptes et mots de passe restent dans leurs connecteurs Playnite.
    // La passerelle expose seulement les fiches de bibliothèque et trois actions du SDK.
    public sealed class LibraryBridge : GenericPlugin
    {
        public override Guid Id => new Guid("32f12f91-43d3-4b3b-a51a-d94217fe9104");
        private readonly CancellationTokenSource stopped = new CancellationTokenSource();
        private NamedPipeServerStream current;
        private string data, pipe, token;
        public LibraryBridge(IPlayniteAPI api) : base(api) { Properties = new GenericPluginProperties(); }

        public override void OnApplicationStarted(OnApplicationStartedEventArgs args)
        {
            string folder = Path.GetDirectoryName(typeof(LibraryBridge).Assembly.Location);
            var config = Serialization.FromJson<Config>(File.ReadAllText(Path.Combine(folder, "bridge-config.json")));
            data = Path.GetFullPath(config.data);
            pipe = "KaneMode.LibraryBridge." + Guid.NewGuid().ToString("N");
            token = Guid.NewGuid().ToString("N");
            Directory.CreateDirectory(data);
            File.WriteAllText(Path.Combine(data, "connection.json"), Serialization.ToJson(new { pipe, token }), new UTF8Encoding(false));
            Task.Run(Listen);
        }

        private async Task Listen()
        {
            while (!stopped.IsCancellationRequested)
            {
                try
                {
                    var security = new PipeSecurity();
                    security.SetAccessRuleProtection(true, false);
                    security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
                    using (var server = new NamedPipeServerStream(pipe, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536, security))
                    {
                        current = server;
                        await server.WaitForConnectionAsync(stopped.Token);
                        using (var reader = new StreamReader(server, Encoding.UTF8, false, 65536, true))
                        using (var writer = new StreamWriter(server, new UTF8Encoding(false), 65536, true) { AutoFlush = true })
                        {
                            var pending = reader.ReadLineAsync();
                            if (await Task.WhenAny(pending, Task.Delay(10000, stopped.Token)) != pending) continue;
                            string text = await pending;
                            if (text == null || text.Length > 8192) continue;
                            var request = Serialization.FromJson<Request>(text);
                            object response;
                            if (request.token != token) response = new { ok = false, error = "Accès à la passerelle refusé" };
                            else
                            {
                                try { response = await PlayniteApi.MainView.UIDispatcher.InvokeAsync(() => Handle(request)); }
                                catch { response = new { ok = false, error = "La boutique a refusé cette action. Vérifiez sa connexion dans Playnite." }; }
                            }
                            await writer.WriteLineAsync(Serialization.ToJson(response));
                        }
                    }
                }
                catch (Exception) { if (!stopped.IsCancellationRequested) await Task.Delay(1000); }
            }
        }

        private object Handle(Request request)
        {
            if (request.action == "ping") return new { ok = true };
            if (request.action == "snapshot")
            {
                var plugins = PlayniteApi.Addons.Plugins.OfType<LibraryPlugin>().ToDictionary(p => p.Id);
                var games = PlayniteApi.Database.Games.Where(g => plugins.ContainsKey(g.PluginId)).Select(g => {
                    var plugin = plugins[g.PluginId];
                    bool installable;
                    try { installable = g.IsInstalled || plugin.GetInstallActions(new GetInstallActionsArgs { Game = g }).Any(); }
                    catch { installable = false; }
                    return new {
                        id = g.Id.ToString(), provider = g.PluginId.ToString(), providerName = plugin.Name,
                        gameId = g.GameId, name = g.Name, installed = g.IsInstalled, installing = g.IsInstalling,
                        canInstall = installable, installDir = g.InstallDirectory, hidden = g.Hidden,
                        lastPlayed = g.LastActivity.HasValue ? new DateTimeOffset(g.LastActivity.Value).ToUnixTimeSeconds() : 0,
                        playtime = g.Playtime / 60,
                        art = new { portrait = Art(g.CoverImage), hero = Art(g.BackgroundImage), icon = Art(g.Icon) }
                    };
                }).ToArray();
                return new { ok = true, schema = 1, updated = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), games,
                    providers = plugins.Values.Select(p => new { id = p.Id.ToString(), name = p.Name, settings = p.Properties.HasSettings }).ToArray() };
            }
            Guid id;
            if (request.action == "settings" && Guid.TryParse(request.id, out id))
            {
                if (!PlayniteApi.Addons.Plugins.OfType<LibraryPlugin>().Any(p => p.Id == id)) throw new InvalidOperationException();
                // L'ouverture est programmée après la réponse : la connexion peut prendre plusieurs minutes.
                PlayniteApi.MainView.UIDispatcher.BeginInvoke(new Action(() => {
                    try { PlayniteApi.MainView.OpenPluginSettings(id); }
                    catch { PlayniteApi.Dialogs.ShowErrorMessage("Impossible d’ouvrir la connexion à cette boutique.", "KaneMode"); }
                }));
                return new { ok = true };
            }
            if ((request.action == "install" || request.action == "start") && Guid.TryParse(request.id, out id))
            {
                var game = PlayniteApi.Database.Games[id];
                if (game == null || !PlayniteApi.Addons.Plugins.OfType<LibraryPlugin>().Any(p => p.Id == game.PluginId)) throw new InvalidOperationException();
                if (request.action == "install")
                {
                    if (game.IsInstalled || game.IsInstalling) return new { ok = true, already = true };
                    var plugin = PlayniteApi.Addons.Plugins.OfType<LibraryPlugin>().First(p => p.Id == game.PluginId);
                    if (!plugin.GetInstallActions(new GetInstallActionsArgs { Game = game }).Any()) return new { ok = false, error = "Ce connecteur ne propose pas l’installation de ce jeu sur Windows" };
                    PlayniteApi.InstallGame(id);
                }
                else { if (!game.IsInstalled) throw new InvalidOperationException(); PlayniteApi.StartGame(id); }
                return new { ok = true };
            }
            return new { ok = false, error = "Action de bibliothèque inconnue" };
        }

        private string Art(string value)
        {
            if (string.IsNullOrEmpty(value)) return null;
            try { string file = PlayniteApi.Database.GetFullFilePath(value); return File.Exists(file) ? file : null; }
            catch { return null; }
        }

        public override void OnApplicationStopped(OnApplicationStoppedEventArgs args) { stopped.Cancel(); current?.Dispose(); }
        public override void Dispose() { stopped.Cancel(); current?.Dispose(); base.Dispose(); }
        public sealed class Config { public string data { get; set; } }
        public sealed class Request { public string token { get; set; } public string action { get; set; } public string id { get; set; } }
    }
}
