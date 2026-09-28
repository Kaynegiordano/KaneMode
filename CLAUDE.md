# KaneMode : notes pour Claude Code

Ce fichier résume le projet pour reprendre le travail sans contexte. **Répondre à l'utilisateur en
français.** Tout le texte visible (interface, messages, notes de version) et les commentaires du code
sont en français. Les messages de commit sont en anglais.

## Le projet

KaneMode est une interface console façon **SteamOS / Big Picture** pour le **mode Xbox (plein écran)
de Windows 11**, pensée d'abord pour les consoles portables (l'utilisateur a une **ROG Ally X** ; son
PC de développement est une tour Ryzen 7 9800X3D + RTX 5080). Elle est installée comme
« application d'accueil » du mode Xbox.

Elle regroupe :
- une bibliothèque multi-boutiques (Steam, Epic, GOG, Ubisoft, EA, Battle.net, Xbox, Amazon…) et
  l'émulation ;
- les visuels SteamGridDB, sans clé ;
- le streaming **KanePlay** (fork de Moonlight) intégré ;
- un accès rapide qui règle vraiment le système : son, écran, réseau, énergie, TDP ;
- les boutons dédiés de la ROG Ally (Command Center, Armoury Crate) ;
- les mises à jour officielles du constructeur (BIOS et pilotes ASUS) ;
- des mises à jour intégrées.

- Dépôt public (GPL v3) : https://github.com/Kaynegiordano/KaneMode (branche `main`)
- Sous-module streaming : https://github.com/Kaynegiordano/KanePlay (`engine/KanePlay`, branche `main`)
- Version courante : fichier `VERSION` (x.y.z). Les notes de chaque version sont dans `native/out/notes-x.y.z.md` (non versionné).

## Architecture

```
Interface (ui/, HTML/JS sans framework) ── HTTP local ──▶ Hôte Node (host/server.js)
     ▲  WebView2                                              │ PowerShell persistants / ponctuels
     │                                                        ▼
App native WPF (native/KaneMode.App) : fenêtre plein écran, veille, premier plan, boutons ASUS
                                                              ▲ lance KanePlay.exe (env KANEPLAY_EMBEDDED)
                                                              KanePlay (engine/, Qt 6)
```

### `host/` : l'hôte (Node, sans dépendances npm)
- `server.js` : API `/api/*`, qui n'accepte que les requêtes locales portant l'en-tête `X-KaneMode: 1`. Il sert aussi `ui/`.
  - Routes principales : bibliothèque et visuels (`/art/...`), lancement, `/api/sys` (+ `/live`), `/api/power/*` (modes et profils batterie/secteur), `/api/update*`, `/api/stream*`, `/api/device`, `/api/drivers*`.
  - Au démarrage, il préchauffe `device.info()` et `sysctl.state()`.
- `syscontrol.ps1` : service PowerShell **persistant** (JSON-RPC, une ligne par commande) avec du C# compilé.
  - La dll est mise en cache dans `%TEMP%\kanemode-syscontrol-<hash>.dll`.
  - Commandes : `state`, `live`, volume, mute, brightness, powermode, refresh, resolution, radio (Wi-Fi/BT), vendor, tdp, cpumax, boost, chargelimit.
  - ASUS (ROG Ally) : `\\.\ATKACPI` en DeviceIoControl. Throttle `0x00120075`, PPT `0x001200A3`/`A0`/`C1`, limite de charge `0x00120057`.
  - Lenovo : WMI `LENOVO_GAMEZONE_DATA` / `LENOVO_OTHER_METHOD`.
  - Processeur : powrprof (PROCTHROTTLEMAX, PERFBOOSTMODE).
  - Mesures en direct : PDH avec noms anglais (`\Processor Information(_Total)\% Processor Performance`) et IOCTL batterie (watts).
- `lib/syscontrol.js` : client du service ; `apply(profile)`.
- `server.js`, modes de performance :
  - `perfPreset()` et `POST /api/power/mode` ; **Économie, Équilibré et Performance** règlent d'un coup le mode d'alimentation Windows, la limite et le turbo CPU, et le profil constructeur.
  - `config.perfMode` passe à `custom` dès qu'un réglage est changé à la main.
  - Le « mode d'alimentation Windows » n'est plus exposé séparément dans l'interface : doublon.
- `lib/device.js` : console reconnue (catalogue `HANDHELDS`) + `device.ps1` (WMI). Résultat mis en cache dans `DATA/device.json` et servi immédiatement au démarrage.
- `lib/kaneplay.js` : trouve `KanePlay.exe`, lit les PC appairés, prépare l'environnement (`KANEMODE_COMMAND`, accent…).
- `lib/update.js` : GitHub Releases (canaux stable/bêta), vérification SHA256SUMS ; `apply-update.ps1` installe hors du paquet puis relance.
- `lib/sgdb.js` : SteamGridDB par l'API publique, sans clé.
- `lib/oem.js` + `inventory.ps1` : mises à jour officielles du constructeur (ASUS seulement pour l'instant).
  - API publique du site ROG (`rog.asus.com/support/webapi/product/GetPDBIOS` et `GetPDDrivers`, `osid=52`, `systemCode=rog`), celle de G-Helper. Modèle = début de la version du BIOS (`RC72LA.312` → `RC72LA`, BIOS 312).
  - Versions installées : `Win32_PnPSignedDriver` (identifiants matériels sans `&REV_`). Résultat dans `DATA/oem.json`, vérifié une fois par jour à l'ouverture des réglages.
  - KaneMode n'installe rien : il ouvre le téléchargement officiel (URL `*.asus.com`, autorisée par `/api/device/open`).

### `ui/` : l'interface (modules ES, sans build)
- `js/nav.js` : moteur de navigation. Il gère :
  - le focus spatial, avec des zones `data-zone` et une mémoire de position par `.row` ou zone ;
  - le défilement quand plus rien n'est focalisable ;
  - la manette (API Gamepad) : **Select = menu, Start = accès rapide**, inversable avec `settings.padSwap`. Un bouton encore enfoncé au retour de focus est ignoré ;
  - le clavier : M = menu, Q = accès rapide, Échap = retour. B sur l'accueil ouvre le menu.
- `js/core.js` : `api`, `settings` (localStorage `km.settings`), `applyTheme` (CSS `--zoom`/`--vh` pour que l'interface agrandie ne déborde pas), `native` (messages WebView2).
- `js/main.js` : menus, accès rapide, relais « par-dessus KanePlay » (`overlay`), mises à jour (vérification au démarrage, au retour d'un jeu, au réveil et toutes les heures, au plus une fois par heure ; entrée « Mise à jour disponible » dans le menu), démarrage.
- `js/qam.js` : accès rapide (sections ordonnables), bandeau en direct `/api/sys/live`, modes avec leurs watts (`PROFILE_WATTS` par console).
- `js/boot.js` : sons **synthétisés et calculés hors ligne** (OfflineAudioContext) ; le logo apparaît sur le pic du son (`playSynced`, horodatage de sortie audio).
  - Son perso : analysé, et copié par l'hôte dans `DATA/bootsound.*`.
  - Le son de démarrage par défaut est grave, **sans notes aiguës** (demande de l'utilisateur).
  - **Le vrai son PS2 ne doit jamais être intégré** : il est protégé (Sony). L'utilisateur l'utilise en « Son perso ».
- `js/pages/settings.js` : catégories à gauche (zone `side`) et réglages à droite (zone `content`). La catégorie s'affiche au survol, B revient à la liste.
- `app.css` :
  - effets coûteux remplacés par des transformations et de l'opacité ;
  - option `lowFx` (« Effets allégés »), activée d'office sur console portable.

### `native/`
- `KaneMode.App` (WPF, .NET 8) : fenêtre plein écran + WebView2. L'hôte et WebView2 démarrent **en parallèle**. Autres rôles :
  - la veille (`Native.cs`) ;
  - `GiveForeground` (message `foreground` : KaneMode cède le premier plan et ramène lui-même la fenêtre KanePlay) ;
  - `WM_COPYDATA` « open\tqam|menu » envoyé par KanePlay (Select/Start), puis retour à KanePlay à la fermeture ;
  - le premier plan de KanePlay (`WatchForeground`) : pendant 15 s, KaneMode, encore au premier plan, guette la fenêtre « KaneMode · KanePlay » et la met lui-même devant (`Native.ForceForeground`, avec `AttachThreadInput`). Si plus aucun `KanePlay.exe` ne tourne après 1,5 s (commande partie vers une instance qui se fermait : `returnToKaneMode` masque la fenêtre puis quitte), il envoie `foreground-lost` et l'interface relance une fois ;
  - le retour au bureau : en mode Xbox (`IsGamingFullScreenExperienceActive`, api-ms-win-gaming-experience-l1-1-0), Windows relance l'app d'accueil qui se ferme. KaneMode envoie d'abord Windows + F11 (sortie du mode Xbox), attend jusqu'à 30 s qu'il soit quitté, puis se ferme ; sinon il reste ouvert (`desktop-failed`).
- `KaneMode.App/GameWatch.cs` : jeu lancé depuis KaneMode (message `launch`, envoyé par `game.js` après `/api/launch`).
  - Écran de lancement **par-dessus tout** (`Topmost`) : Steam qui démarre reste caché. Il se retire dès qu'une nouvelle fenêtre (absente au lancement) d'un programme qui n'est ni une boutique (`Stores`) ni Windows (`Shell`) prend le premier plan ou couvre la moitié de l'écran ; au bout de 25 s, il se retire et met devant une nouvelle fenêtre du jeu ou de Steam. B (`launch-cancel`) le retire aussi.
  - Le jeu est ensuite suivi (fenêtres de son processus, successeur pour un lanceur, `HKCU\Software\Valve\Steam\RunningAppID` pour Steam). À sa fermeture, KaneMode revient au premier plan, y compris sur le bureau, et insiste 5 s si Steam repasse devant (`game-ended`).
  - Fond de l'écran : une image « hero » du jeu tirée au hasard sur SteamGridDB (`/api/launch/wallpaper`, préparée à l'ouverture de la fiche).
  - Double lancement : l'hôte ignore un 2e `/api/launch` de la même entrée dans les 30 s (effacé par `/api/launch/ended`) ou d'un jeu Steam déjà en cours (`already`/`running` → `game-front`). Chaque lancement est noté dans `kanemode.log`.
- `KaneMode.App/AllyButtons.cs` : boutons de la ROG Ally lus sur la manette interne ASUS (HID VID 0B05, PID 1ABE/1B4C, collection qui accepte le rapport de fonction 0x5A). Rapport d'entrée 0x5A, 2e octet : 166 = Command Center, 56 = Armoury Crate, 167/168 = appui long/relâché (codes de Handheld Companion). Lecture partagée avec les services ASUS.
  - Actions (`buttons`, envoyé par l'interface) : `gamebar` (Windows + G), `qam`/`menu` (par-dessus la fenêtre active, `toggle` si KaneMode est devant), `home`, `taskview`, `screenshot`, `none`. Par défaut : Command Center = `taskview` (comme un appui long sur la touche Xbox, migration `btnCCTaskView` en 1.3.1), Armoury Crate = `gamebar`, appui long = `home`.
  - Invite « installer Armoury Crate SE » : pendant 4,5 s après l'appui, les nouvelles fenêtres sont notées dans le journal et celles d'ASUS/Armoury Crate ou du Microsoft Store sont fermées (`WM_CLOSE`). Le processus exact qui affiche l'invite reste à confirmer dans `kanemode.log`.
- `package/AppxManifest.xml` :
  - app `App` (WPF, full trust, `windows.gamingApp`, capacité `gamingHome`). Le widget Game Bar a été abandonné après la 1.2.0 (trop compliqué pour l'instant).
- `build.ps1` : compile et assemble le paquet dans `native/out/layout`, ou `layout-release` avec `-Release` pour ne pas écraser une version de développement installée. Options :
  - `-Register` : installation de développement ;
  - `-Pack` : msix signé ;
  - `-NoKanePlay`.
- `release.ps1 -Publish [-Beta] -Notes <md>` : msix autonome + installateur + SHA256SUMS, puis Release GitHub (`gh`, dépôt forcé).
- `KaneMode.Setup` : installateur unique `KaneMode-Setup-x.y.z.exe` (WinForms, administrateur). Il active le mode développeur, approuve le certificat, installe le paquet, installe l'outil Xbox FSE (8bit2qubit) et active le mode Xbox sans fenêtre (`/silentenable`).
- `certificate.ps1 -Backup|-Restore` : sauvegarde du certificat de signature `CN=KaneMode` (empreinte `0B133FEE…086FE`, valide jusqu'en 2036). Par défaut `%USERPROFILE%\KaneMode-signature.pfx` : Documents/OneDrive est bloqué par « Dossiers contrôlés ».
  - **Le .pfx et son mot de passe ne sont jamais dans le dépôt.**
  - Le mot de passe est choisi et saisi par l'utilisateur ; Claude ne le voit pas.

### `engine/` : KanePlay
- `build-engine.ps1` : Qt 6.11.3 msvc2022_64, VS 18. Sortie dans `engine/out` (non versionné), embarquée dans le paquet (`kaneplay\`).
- Mode intégré (`KANEPLAY_EMBEDDED`) :
  - instance unique (QLocalServer « KaneMode.Streaming.<user> ») ;
  - réglages séparés (`HKCU\Software\KaneMode\Streaming`) ;
  - couleurs de KaneMode ;
  - B sur l'accueil : retour à KaneMode **et fermeture de KanePlay** (une session en pause continue sur le PC hôte) ;
  - Select/Start : menu et accès rapide de KaneMode par-dessus (`KaneModeBridge::openInKaneMode`).
- Pause en jeu : LB+RB+Select+Y.

## Travailler sur le projet

- Interface seule, dans un navigateur : lancer la commande ci-dessous puis ouvrir http://localhost:5173 (réglages simulés quand ils sont impossibles).

  ```
  node host/server.js
  ```

- Vérifier la syntaxe : `node --check host/server.js`. Pour l'app native : `dotnet build -c Release` dans `native/KaneMode.App`.
- Publier : bumper `VERSION`, écrire `native/out/notes-x.y.z.md`, committer, pousser, puis lancer la commande ci-dessous. **Toujours demander l'accord de l'utilisateur avant de publier.**

  ```
  powershell -File native\release.ps1 -Publish -Notes native\out\notes-x.y.z.md
  ```

- Piège : un guillemet égaré dans PATH (`GitHub CLI"`) fait échouer vcvarsall (« \Windows était inattendu »). Les scripts nettoient PATH.
- Piège (Claude Desktop) : les commandes lancées par Claude tournent dans un paquet MSIX, avec registre et LOCALAPPDATA virtualisés. Pour agir ou vérifier « pour de vrai », il faut lancer via WMI :

  ```
  Invoke-CimMethod Win32_Process -MethodName Create -Arguments @{CommandLine=...}
  ```

  C'est aussi le cas pour installer un paquet, lire les journaux ou lancer l'app dans son paquet (`Invoke-CommandInDesktopPackage`).
- Données : `data/` (développement) ou `%LOCALAPPDATA%\KaneMode\data` (app installée). `data/` et `extras/` (fichiers personnels, dont la vidéo et le son PS2 de l'utilisateur) sont exclus du dépôt.

## État et suites possibles

- Non testé sur la vraie console :
  - réglages ASUS/Lenovo (TDP, profils) ;
  - watts sur batterie ;
  - boutons Select/Start dans KanePlay ;
  - boutons Command Center / Armoury Crate (codes HID repris de Handheld Companion) et fermeture de l'invite Armoury Crate SE ;
  - sortie du mode Xbox par Windows + F11 ;
  - suivi des jeux (`GameWatch`) avec un vrai jeu Steam : testé seulement avec un faux jeu (charmap) sur le PC de développement ;
  - mises à jour ASUS : l'API n'a pas pu être appelée depuis l'environnement de développement (proxy), format repris de G-Helper.
- Idées demandées ou à explorer :
  - KanePlay : fermer son QLocalServer dès `returnToKaneMode` (avant de quitter) éviterait qu'une relance parte vers l'instance qui se ferme ;
  - mises à jour officielles pour Lenovo (Legion Go) et MSI (Claw) ;
  - limite d'images par seconde, fonctions AMD (RSR, AFMF, Anti-Lag via ADLX), courbe de ventilateur ;
  - superposition transparente par-dessus les jeux.
- Historique récent :
  - 1.0.1 : navigation, Select/Start, modes de performance ;
  - 1.0.2 : son synthétisé, mesures en direct, KanePlay se ferme ;
  - 1.1.0 : premier widget Game Bar ;
  - 1.2.0 : widget façon Winhanced via le tube nommé, KanePlay au premier plan, démarrage plus rapide, effets allégés, mises à jour signalées dans le menu, B = menu sur l'accueil, son de démarrage grave ;
  - 1.3.0 : widget Game Bar retiré, boutons Command Center / Armoury Crate de l'Ally, sortie du mode Xbox avant de quitter, KanePlay au premier plan même à la relance, mises à jour officielles ASUS (BIOS, pilotes) ;
  - 1.3.1 : double lancement bloqué, écran de lancement par-dessus Steam avec un fond SteamGridDB au hasard, retour systématique à KaneMode quand le jeu se ferme, Command Center = vue des tâches.
