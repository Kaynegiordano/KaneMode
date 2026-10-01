using KaneMode.LibraryBridge;
using Moq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Playnite.SDK;
using Playnite.SDK.Data;
using Playnite.SDK.Models;
using Playnite.SDK.Plugins;
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Threading;

internal static class Program
{
    private static void Check(bool value, string why) { if (!value) throw new Exception(why); }
    [STAThread]
    private static int Main()
    {
        var dispatcher = Dispatcher.CurrentDispatcher;
        var serializer = new Mock<IDataSerializer>();
        serializer.Setup(s => s.ToJson(It.IsAny<object>(), It.IsAny<bool>())).Returns((object obj, bool formatted) => JsonConvert.SerializeObject(obj));
        serializer.Setup(s => s.FromJson<LibraryBridge.Config>(It.IsAny<string>())).Returns((string text) => JsonConvert.DeserializeObject<LibraryBridge.Config>(text));
        serializer.Setup(s => s.FromJson<LibraryBridge.Request>(It.IsAny<string>())).Returns((string text) => JsonConvert.DeserializeObject<LibraryBridge.Request>(text));
        typeof(Serialization).GetField("serializer", BindingFlags.Static | BindingFlags.NonPublic).SetValue(null, serializer.Object);
        var api = new Mock<IPlayniteAPI>();
        var main = new Mock<IMainViewAPI>();main.SetupGet(m => m.UIDispatcher).Returns(dispatcher);api.SetupGet(a => a.MainView).Returns(main.Object);
        var plugin = new FixtureLibrary(api.Object);
        var games = Enumerable.Range(1, 1200).Select(n => new Game { Id = Guid.NewGuid(), PluginId = plugin.Id, GameId = n.ToString(), Name = "Fixture " + n, IsInstalled = n == 1, IsInstalling = n == 3 }).ToList();
        games.Add(new Game { Id = Guid.NewGuid(), Name = "Entrée manuelle hors connecteur" });
        var collection = new Mock<IItemCollection<Game>>();collection.Setup(c => c.GetEnumerator()).Returns(() => games.GetEnumerator());
        collection.Setup(c => c[It.IsAny<Guid>()]).Returns((Guid id) => games.FirstOrDefault(g => g.Id == id));
        var database = new Mock<IGameDatabaseAPI>();database.SetupGet(d => d.Games).Returns(collection.Object);api.SetupGet(a => a.Database).Returns(database.Object);
        var addons = new Mock<IAddons>();addons.SetupGet(a => a.Plugins).Returns(new List<Plugin> { plugin });api.SetupGet(a => a.Addons).Returns(addons.Object);
        string folder = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "fixture-data");Directory.CreateDirectory(folder);
        File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "bridge-config.json"), JsonConvert.SerializeObject(new { data = folder }));
        var bridge = new LibraryBridge(api.Object);bridge.OnApplicationStarted(null);
        int result = 1;
        var watchdog = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
        watchdog.Tick += (_, __) => { Console.WriteLine("FAIL Delai depasse"); dispatcher.BeginInvokeShutdown(DispatcherPriority.Normal); };watchdog.Start();
        Task.Run(async () => {
            try
            {
                var connection = JObject.Parse(File.ReadAllText(Path.Combine(folder, "connection.json")));
                Func<string, string, string, Task<JObject>> send = async (action, id, token) => {
                    using (var pipe = new NamedPipeClientStream(".", (string)connection["pipe"], PipeDirection.InOut, PipeOptions.Asynchronous)) {
                        await pipe.ConnectAsync(5000);
                        using (var writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, true) { AutoFlush = true })
                        using (var reader = new StreamReader(pipe, Encoding.UTF8, false, 4096, true)) {
                            await writer.WriteLineAsync(JsonConvert.SerializeObject(new { action, id, token }));
                            return JObject.Parse(await reader.ReadLineAsync());
                        }
                    }
                };
                string token = (string)connection["token"];
                Check(!(bool)(await send("snapshot", null, "incorrect"))["ok"], "Jeton refuse");
                var snapshot = await send("snapshot", null, token);
                Check((bool)snapshot["ok"] && snapshot["games"].Count() == 1200, "1200 fiches de comptes, aucune limite");
                Check(snapshot["games"].Count(g => !(bool)g["installed"]) == 1199, "Jeux jamais installes presents");
                Check(!(bool)snapshot["games"].First(g => (string)g["gameId"] == "2")["canInstall"], "Installation non prise en charge signalee");
                Check((bool)(await send("install", games[3].Id.ToString(), token))["ok"], "Installation via SDK");
                api.Verify(a => a.InstallGame(games[3].Id), Times.Once);
                Check((bool)(await send("install", games[2].Id.ToString(), token))["already"], "Installation deja en cours non repetee");
                Check((bool)(await send("start", games[0].Id.ToString(), token))["ok"], "Lancement via SDK");api.Verify(a => a.StartGame(games[0].Id), Times.Once);
                Check(!(bool)(await send("uninstall", games[0].Id.ToString(), token))["ok"], "Desinstallation jamais exposee");
                Check(!(bool)(await send("start", Guid.NewGuid().ToString(), token))["ok"], "Jeu inconnu refuse");
                Check((bool)(await send("settings", plugin.Id.ToString(), token))["ok"], "Configuration du connecteur");
                await Task.Delay(100);main.Verify(m => m.OpenPluginSettings(plugin.Id), Times.Once);
                result = 0;Console.WriteLine("PASS SDK et pipe Windows reels : 1200 jeux, installation, lancement, connexion, refus et absence de desinstallation.");
            }
            catch (Exception ex) { Console.WriteLine("FAIL " + ex); }
            finally { bridge.Dispose();dispatcher.BeginInvokeShutdown(DispatcherPriority.Normal); }
        });
        Dispatcher.Run();watchdog.Stop();bridge.Dispose();return result;
    }
    private sealed class FixtureLibrary : LibraryPlugin
    {
        public override Guid Id => new Guid("10000000-0000-0000-0000-000000000001");public override string Name => "Steam";
        public FixtureLibrary(IPlayniteAPI api) : base(api) { Properties = new LibraryPluginProperties { HasSettings = true }; }
        public override IEnumerable<InstallController> GetInstallActions(GetInstallActionsArgs args) => args.Game.GameId == "2" ? new InstallController[0] : new[] { new FixtureInstall(args.Game) };
    }
    private sealed class FixtureInstall : InstallController
    {
        public FixtureInstall(Game game) : base(game) { }
        public override void Install(InstallActionArgs args) { }
    }
}
