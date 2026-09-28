// Xbox Full Screen Experience Tool — ajout KaneMode
// Mode silencieux « /silentenable » : active le mode Xbox (Full Screen Experience) complet sans
// interface, avec exactement la même logique que le bouton « Enable » de l'outil.
//
// Ce fichier modifie un programme sous licence GNU GPL v3 : il est distribué sous la même licence.
//
// Usage (administrateur) :
//   XboxFullScreenExperienceTool.exe /silentenable /installpath="C:\Program Files\8bit2qubit\Xbox FullScreen Experience Tool"
// /installpath doit désigner l'installation officielle (PhysPanelCS.exe, DeviceForm.bak).
// Codes de sortie : 0 = activé (redémarrage requis), 1 = erreur, 2 = build Windows non compatible,
//                   3 = chemin d'installation invalide.

using Albacore.ViVe;
using Albacore.ViVe.NativeEnums;
using Albacore.ViVe.NativeStructs;
using Microsoft.Win32;
using PhysPanelLib;
using XboxFullScreenExperienceTool.Helpers;

namespace XboxFullScreenExperienceTool
{
    internal static class KaneModeCli
    {
        public static int SilentEnable(string[] args)
        {
            string logPath = Path.Combine(Path.GetTempPath(), "KaneMode-XboxMode.log");
            void Log(string msg)
            {
                try { File.AppendAllText(logPath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {msg}{Environment.NewLine}"); }
                catch { /* journal facultatif */ }
            }

            string installPath = args.FirstOrDefault(a => a.StartsWith("/installpath=", StringComparison.OrdinalIgnoreCase))?
                .Substring("/installpath=".Length).Trim('"') ?? "";
            if (string.IsNullOrEmpty(installPath) || !Directory.Exists(installPath))
            {
                Log($"Chemin d'installation invalide : '{installPath}'");
                return 3;
            }
            AppPathManager.InstallPath = installPath;
            Log($"Activation silencieuse (installpath={installPath})");

            try { return MainForm.KaneModeSilent.Enable(Log); }
            catch (Exception ex)
            {
                Log($"ERREUR : {ex}");
                return 1;
            }
        }
    }

    public partial class MainForm
    {
        /// <summary>
        /// Reprend le déroulé de btnEnable_Click sans aucune interface.
        /// En mode Legacy, la méthode de contournement retenue est PhysPanelCS (tâche planifiée),
        /// le choix par défaut de l'outil : le pilote PhysPanelDrv n'est jamais installé ici.
        /// </summary>
        public static class KaneModeSilent
        {
            public static int Enable(Action<string> log)
            {
                if (!IsCompatibleBuild())
                {
                    log("Build Windows non compatible.");
                    return 2;
                }

                // 1. Sauvegarde puis réglage de DeviceForm (même format de sauvegarde que l'outil)
                if (!File.Exists(BackupFilePath))
                {
                    object? current = Registry.GetValue($"HKEY_LOCAL_MACHINE\\{REG_PATH}", REG_VALUE, null);
                    File.WriteAllText(BackupFilePath, current?.ToString() ?? "DELETE_ON_RESTORE");
                    log($"Sauvegarde DeviceForm : {current?.ToString() ?? "(absent)"}");
                }
                Registry.SetValue($"HKEY_LOCAL_MACHINE\\{REG_PATH}", REG_VALUE, 0x2E, RegistryValueKind.DWord);

                // 2. Fonctionnalités Windows (ViVe), choisies selon la build et l'écran
                bool isNative = IsNativeSupportBuild();
                bool isOverridePresent = TaskSchedulerManager.SetPanelDimensionsTaskExists() || DriverManager.IsDriverServiceInstalled();
                var (success, size) = PanelManager.GetDisplaySize();
                double diagonalInches = (success && (size.WidthMm > 0 || size.HeightMm > 0))
                    ? Math.Sqrt((size.WidthMm * size.WidthMm) + (size.HeightMm * size.HeightMm)) / INCHES_TO_MM
                    : 0;
                uint[] ids = GetRequiredFeatureIds(isNative, diagonalInches, isOverridePresent);
                Apply(ALL_FEATURE_IDS, RTL_FEATURE_ENABLED_STATE.Default, RTL_FEATURE_CONFIGURATION_OPERATION.ResetState);
                Apply(ids, RTL_FEATURE_ENABLED_STATE.Enabled, RTL_FEATURE_CONFIGURATION_OPERATION.FeatureState | RTL_FEATURE_CONFIGURATION_OPERATION.VariantState);
                log($"Fonctionnalités activées : {string.Join(", ", ids)} (Native={isNative}, écran={diagonalInches:F1}\")");

                // 3. Contournement de la taille d'écran si nécessaire
                if (DriverManager.IsDriverServiceInstalled()) DriverManager.UninstallDriver(log, isSilent: true);
                if (isNative)
                {
                    if (TaskSchedulerManager.SetPanelDimensionsTaskExists()) TaskSchedulerManager.DeleteSetPanelDimensionsTask();
                    if (isOverridePresent || !IsHandheldDevice(diagonalInches))
                    {
                        // Dans l'UE, Windows masque le mode Xbox des PC de bureau : l'outil simule alors un écran de 7".
                        bool eu = RegionHelper.IsEuRegion();
                        TaskSchedulerManager.CreateSetPanelDimensionsTask(regOnly: !eu);
                        log($"Tâche SetPanelDimensions créée (UE={eu}).");
                    }
                }
                else
                {
                    bool undefinedSize = !success || (size.WidthMm == 0 && size.HeightMm == 0);
                    if (undefinedSize || diagonalInches > MAX_DIAGONAL_INCHES)
                    {
                        if (TaskSchedulerManager.SetPanelDimensionsTaskExists()) TaskSchedulerManager.DeleteSetPanelDimensionsTask();
                        TaskSchedulerManager.CreateSetPanelDimensionsTask();
                        log("Tâche SetPanelDimensions créée (mode Legacy, PhysPanelCS).");
                    }
                }

                log("Activation terminée : un redémarrage est nécessaire.");
                return 0;
            }

            private static void Apply(uint[] ids, RTL_FEATURE_ENABLED_STATE state, RTL_FEATURE_CONFIGURATION_OPERATION operation)
            {
                var updates = Array.ConvertAll(ids, id => new RTL_FEATURE_CONFIGURATION_UPDATE
                {
                    FeatureId = id,
                    EnabledState = state,
                    Operation = operation,
                    Priority = RTL_FEATURE_CONFIGURATION_PRIORITY.User
                });
                FeatureManager.SetFeatureConfigurations(updates, RTL_FEATURE_CONFIGURATION_TYPE.Runtime);
                FeatureManager.SetFeatureConfigurations(updates, RTL_FEATURE_CONFIGURATION_TYPE.Boot);
            }

            /// <summary>Mêmes seuils que le README de l'outil (Native + Legacy).</summary>
            private static bool IsCompatibleBuild()
            {
                if (IsNativeSupportBuild()) return true;
                string? b = Registry.GetValue($@"HKEY_LOCAL_MACHINE\{REG_PATH_PARENT}", "CurrentBuild", null)?.ToString();
                string? r = Registry.GetValue($@"HKEY_LOCAL_MACHINE\{REG_PATH_PARENT}", "UBR", null)?.ToString();
                if (!int.TryParse(b, out int build) || !int.TryParse(r, out int rev)) return false;
                return (build == 26100 && rev >= 7019) || (build == 26200 && rev >= 7015)
                    || (build == 26220 && rev >= 6972) || (build == 28000 && rev >= 1450);
            }
        }
    }
}
