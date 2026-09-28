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
- un widget Game Bar ;
- des mises à jour intégrées.

- Dépôt public (GPL v3) : https://github.com/Kaynegiordano/KaneMode (branche `main`)
- Sous-module streaming : https://github.com/Kaynegiordano/KanePlay (`engine/KanePlay`, branche `main`)
- Version courante : fichier `VERSION` (x.y.z). Les notes de chaque version sont dans `native/out/notes-x.y.z.md` (non versionné).

## Architecture

```
Interface (ui/, HTML/JS sans framework) ── HTTP local ──▶ Hôte Node (host/server.js)
     ▲  WebView2                                              │ PowerShell persistants / ponctuels
     │                                                        ▼
App native WPF (native/KaneMode.App) : fenêtre plein écran, veille, premier plan, relais widget
     ▲ tube nommé privé du paquet                             ▲ lance KanePlay.exe (env KANEPLAY_EMBEDDED)
Widget Game Bar (native/KaneMode.Widget, UWP C++/WinRT)       KanePlay (engine/, Qt 6)
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

### `ui/` : l'interface (modules ES, sans build)
- `js/nav.js` : moteur de navigation. Il gère :
  - le focus spatial, avec des zones `data-zone` et une mémoire de position par `.row` ou zone ;
  - le défilement quand plus rien n'est focalisable ;
  - la manette (API Gamepad) : **Select = menu, Start = accès rapide**, inversable avec `settings.padSwap`. Un bouton encore enfoncé au retour de focus est ignoré ;
  - le clavier : M = menu, Q = accès rapide, Échap = retour. B sur l'accueil ouvre le menu.
- `js/core.js` : `api`, `settings` (localStorage `km.settings`), `applyTheme` (CSS `--zoom`/`--vh` pour que l'interface agrandie ne déborde pas), `native` (messages WebView2).
- `js/main.js` : menus, accès rapide, relais « par-dessus KanePlay » (`overlay`), mises à jour (vérification toutes les 6 h, entrée « Mise à jour disponible » dans le menu), démarrage.
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
  - `WidgetBridge.cs`.
- `KaneMode.App/WidgetBridge.cs` : **tube nommé** dans l'espace de noms du conteneur du paquet (`Sessions\<n>\AppContainerNamedObjects\<SID>\kanemode-widget`). Il relaie les requêtes JSON du widget à l'hôte.
  - Le SID du conteneur est **calculé** : SHA-256 du nom de famille en minuscules. `DeriveAppContainerSidFromAppContainerName` plante dans l'app installée.
  - Aucune autorisation administrateur n'est nécessaire, contrairement au bouclage réseau.
- `KaneMode.Widget` : widget Game Bar = app **UWP en C++/WinRT, interface construite en code**. Le gabarit des tuiles passe par `XamlReader`. Style inspiré du HUD de Winhanced :
  - pastille de watts ;
  - carte des mesures ;
  - tuiles de profil (Économie, Équilibré, Performance, Personnalisé) ;
  - catégories et tuiles « Toucher pour changer » (fréquence, résolution, luminosité, turbo, limite CPU, Wi-Fi, Bluetooth, limite de charge, volume, sourdine).

  Compilation : `build-widget.ps1` (vcvarsall `x64 uwp`, cppwinrt du SDK, NuGet `Microsoft.Gaming.XboxGameBar` 7.3.2607010 téléchargé dans `obj/`). Le runtime `Microsoft.VCLibs.140.00` est une dépendance du paquet ; il est présent partout où la Game Bar existe.
- `package/AppxManifest.xml` :
  - app `App` (WPF, full trust, `windows.gamingApp`, capacité `gamingHome`) ;
  - app `Widget` (extension `microsoft.gameBarUIExtension`) ;
  - classes du composant Game Bar + proxy/stub (copiés du readme du NuGet).
- `build.ps1` : compile et assemble le paquet dans `native/out/layout`, ou `layout-release` avec `-Release` pour ne pas écraser une version de développement installée. Options :
  - `-Register` : installation de développement ;
  - `-Pack` : msix signé ;
  - `-NoKanePlay`, `-NoWidget`.
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
  - widget Game Bar : le relais par le tube est vérifié ; l'affichage dans la Game Bar reste à confirmer à l'écran.
- Idées demandées ou à explorer :
  - boutons dédiés de l'Ally (Command Center / Armoury Crate) via le HID ASUS (VID 0B05, rapport 0x5A) pour ouvrir l'accès rapide ;
  - limite d'images par seconde, fonctions AMD (RSR, AFMF, Anti-Lag via ADLX), courbe de ventilateur ;
  - superposition transparente par-dessus les jeux.
- Historique récent :
  - 1.0.1 : navigation, Select/Start, modes de performance ;
  - 1.0.2 : son synthétisé, mesures en direct, KanePlay se ferme ;
  - 1.1.0 : premier widget Game Bar ;
  - 1.2.0 : widget façon Winhanced via le tube nommé, KanePlay au premier plan, démarrage plus rapide, effets allégés, mises à jour signalées dans le menu, B = menu sur l'accueil, son de démarrage grave.
