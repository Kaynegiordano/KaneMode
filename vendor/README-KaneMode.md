# Code tiers : XboxFullScreenExperienceTool

Copie du code source de [XboxFullScreenExperienceTool](https://github.com/8bit2qubit/XboxFullscreenExperienceTool) 0.9.4 (© 8bit2qubit), sous licence **GNU GPL v3** (voir `XboxFullScreenExperienceTool/LICENSE`).

## Modifications apportées pour KaneMode

- `XboxFullScreenExperienceTool/MainForm.KaneMode.cs` (nouveau) : mode `/silentenable`, qui active le mode Xbox complet sans interface avec la même logique que le bouton « Enable » de l'outil (sauvegarde et réglage de `DeviceForm`, fonctionnalités ViVe, contournement de la taille d'écran, y compris dans l'UE).
- `XboxFullScreenExperienceTool/Program.cs` : branchement de ce mode (quelques lignes).

Tout le reste est inchangé. Le programme modifié reste un exécutable séparé, sous GPL v3, appelé par `setup/install.ps1`. Si vous redistribuez KaneMode avec ce composant, fournissez aussi ce code source.

## Compilation

`setup/build-xbox-enabler.ps1`, qui demande git et le SDK .NET 8. La dépendance ViVe (sous-module Git du projet d'origine) est téléchargée automatiquement.
