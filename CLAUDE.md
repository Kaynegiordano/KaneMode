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
  - Commandes : `state` (avec `ac` : secteur ou batterie), `live`, `policy` (profil constructeur en cours et secteur, lecture ACPI instantanée), volume, mute, brightness, powermode, refresh, resolution, radio (Wi-Fi/BT), vendor (vérifié : relu après écriture, erreur si la console ne l'a pas pris), tdp, cpumax, boost, chargelimit.
  - ASUS (ROG Ally) : `\\.\ATKACPI` en DeviceIoControl. Throttle `0x00120075`, PPT `0x001200A3`/`A0`/`C1`, limite de charge `0x00120057`.
  - Lenovo : WMI `LENOVO_GAMEZONE_DATA` / `LENOVO_OTHER_METHOD`.
  - Processeur : powrprof (PROCTHROTTLEMAX, PERFBOOSTMODE).
  - Mesures en direct : PDH avec noms anglais (`\Processor Information(_Total)\% Processor Performance`) et IOCTL batterie (watts).
- `lib/syscontrol.js` : client du service ; `apply(profile)`.
- `server.js`, modes de performance :
  - `perfPreset()` et `POST /api/power/mode` ; **Économie, Équilibré et Performance** règlent d'un coup le mode d'alimentation Windows, la limite et le turbo CPU, et le profil constructeur.
  - Sur ROG Ally, le mode impose aussi la puissance (`ASUS_WATTS` : SPL = sPPT = fPPT, valeurs d'Armoury Crate ; Ally X 13 / 17 / 25 W, Turbo 30 W sur secteur). Avant la 1.7.0, seul le profil ACPI changeait : une puissance réglée à la main restait en place et « le mode ne changeait rien » (retour de l'utilisateur sur son Ally X).
  - **Mode tenu** (`keepPerf`) : toutes les 5 s, commande `policy` ; si le profil constructeur n'est plus celui du mode (Armoury Crate SE et ses profils par jeu, Legion Space), le mode est réappliqué et noté dans le journal. Plus de 4 corrections en 2 min : conflit, pause de 10 min, `modeConflict` dans `/api/sys` (avertissement dans l'accès rapide et le widget). Puissance remise au branchement / débranchement, à la sortie de veille (minuterie arrêtée > 30 s) et 8 s puis 25 s après un lancement de jeu. `keeperQuiet()` suspend les vérifications 4 s après chaque réglage manuel ou changement de mode. Puissance réglée à la main : `config.customTdp`, remise dans les mêmes cas.
  - `config.perfMode` passe à `custom` dès qu'un réglage est changé à la main.
  - Le « mode d'alimentation Windows » n'est plus exposé séparément dans l'interface : doublon.
- Bibliothèque à jour toute seule (`rescanLibrary` dans `server.js`) : `fs.watch` sur les `steamapps` de chaque bibliothèque Steam (seulement quand un jeu devient installé ou disparaît : bit 4 de `StateFlags`), les `shortcuts.vdf`, les manifestes Epic et les dossiers `XboxGames`. Analyse complète au démarrage, au retour sur KaneMode (`/api/library/refresh`, une fois par minute au plus) et toutes les 10 minutes. `scan.ps1` ignore un jeu Steam pas fini de télécharger.
- Performances de l'hôte (1.5.0) :
  - `allEntries` est gardé en mémoire (refait quand `version` change, au plus tard après 5 s) avec un index `byId` pour `findEntry` : chaque image `/art/…` reconstruisait toute la bibliothèque (171 jaquettes : 15,7 s → 0,17 s). **Toute écriture de `library.json`, `custom.json` ou `roms.json` doit faire `version++`.**
  - `sendFile` envoie un `ETag` (taille + date) et répond 304 : jaquettes et fichiers de l'interface ne sont plus retéléchargés à chaque affichage.
  - `steam.gridArt` lit le dossier `grid` une fois (cache par date du dossier) au lieu d'une vingtaine d'accès disque par jeu.
- `lib/amd.js` + `native/KaneMode.Amd` : réglages graphiques AMD par **ADLX** (bibliothèque du pilote, `amdadlx64.dll`). `kanemode-amd.exe` (C++, SDK ADLX 2.0 téléchargé par `build-amd.ps1`, commit fixé et empreinte vérifiée ; **le SDK a sa propre licence, il n'est pas dans le dépôt**) reste ouvert et lit une commande par ligne : `state`, `live`, `set <fonction> <valeur>`.
  - Fonctions : `fps` (limite d'images par seconde : Radeon Chill avec minimum = maximum, sinon Frame Rate Target Control ; 0 = aucune), `rsr`/`rsrsharp`, `afmf`, `antilag`, `ris`/`rissharp`. `live` : images par seconde du jeu au premier plan, charge, température, puissance et fréquence du GPU.
  - Routes `GET /api/amd` (`available:false` + `reason` sans GPU AMD), `GET /api/amd/live`, `POST /api/amd {feature, value}` (renvoie l'état complet : une fonction peut en couper une autre).
  - **Jamais testé sur un vrai GPU AMD** : le PC de développement a une RTX 5080 (ADLX se charge, « Pas de GPU AMD »).
- `lib/device.js` : console reconnue (catalogue `HANDHELDS`) + `device.ps1` (WMI). Résultat mis en cache dans `DATA/device.json` et servi immédiatement au démarrage.
- `lib/kaneplay.js` : trouve `KanePlay.exe`, lit les PC appairés, prépare l'environnement (`KANEMODE_COMMAND`, accent…).
- `lib/update.js` : GitHub Releases (canaux stable/bêta), vérification SHA256SUMS ; `apply-update.ps1` installe hors du paquet puis relance.
- `lib/sgdb.js` : SteamGridDB par l'API publique, sans clé. Les 3 pages de résultats sont demandées en parallèle (~0,3 s). Le CDN est lent (~1 s par vignette, 200 Ko ; image entière 2-3 Mo) : `artpicker.js` ne charge une vignette qu'à l'approche de l'écran (`IntersectionObserver`), précharge toutes les listes à l'ouverture des visuels et les premières vignettes des onglets voisins.
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
  - `openLayer`/`closeLayer` n'exigent plus `#scrim` (absent du widget).
- `js/core.js` : `api`, `settings` (localStorage `km.settings`), `applyTheme` (CSS `--zoom`/`--vh` pour que l'interface agrandie ne déborde pas ; le zoom est en plus réduit sous 1280 × 720 points CSS, pour garder la même mise en page quand la résolution baisse ; `main.js` le recalcule et redessine la page à chaque `resize`), `native` (messages WebView2), `sfx` : sons d'interface façon Switch 2, **doux** (demande de l'utilisateur) : « tocs » de marimba (partiel 4 à peine présent), attaque de 5 ms, clic très faible, passe-bas à 4,2 kHz, crêtes de 0,02 à 0,05 ; calculés une fois (`OfflineAudioContext`, table `SOUNDS`) puis rejoués.
- `js/pages/library.js` : tri par nom et au moins 40 jeux dans l'onglet (`MANY`) : la lettre en cours s'affiche sur le côté droit en changeant de rangée, à la hauteur qui correspond à la position dans la liste (`.letter-hint`, comme SteamOS) ; LT/RT sautent à la lettre suivante ou précédente.
- `js/pages/settings.js` : une catégorie s'affiche tout de suite ; les blocs lents (mises à jour, pilotes, ASUS) se remplissent ensuite, et « Console portable » lit la description en cache (l'analyse WMI est relancée en arrière-plan).
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
  - le changement de résolution (`SystemEvents.DisplaySettingsChanged`) : `Native.FillMonitor` remet la fenêtre à la taille de l'écran, sans l'activer (WPF laissait la fenêtre sans bordure agrandie à l'ancienne taille : interface inadaptée après un changement de résolution depuis le widget) ;
  - `GiveForeground` (message `foreground` : KaneMode cède le premier plan et ramène lui-même la fenêtre KanePlay) ;
  - `WM_COPYDATA` « open\tqam|menu » envoyé par KanePlay (Select/Start), puis retour à KanePlay à la fermeture ;
  - le premier plan de KanePlay (`WatchForeground`) : pendant 15 s, KaneMode, encore au premier plan, guette la fenêtre « KaneMode · KanePlay » et la met lui-même devant (`Native.ForceForeground`, avec `AttachThreadInput`). Si plus aucun `KanePlay.exe` ne tourne après 1,5 s (commande partie vers une instance qui se fermait : `returnToKaneMode` masque la fenêtre puis quitte), il envoie `foreground-lost` et l'interface relance une fois ;
  - le retour au bureau : en mode Xbox (`IsGamingFullScreenExperienceActive`, api-ms-win-gaming-experience-l1-1-0), Windows relance l'app d'accueil qui se ferme. KaneMode envoie d'abord Windows + F11 (sortie du mode Xbox), attend jusqu'à 30 s qu'il soit quitté, puis se ferme ; sinon il reste ouvert (`desktop-failed`).
- Start / Select maintenus en jeu (1.5.1, `PadHold.cs`) : **retirés en 1.6.0**. Afficher KaneMode par-dessus un jeu plein écran revient à changer de fenêtre ; le vrai « par-dessus le jeu », c'est le widget Game Bar.
- **Widget Game Bar** (1.6.0) : HUD façon Winhanced par-dessus les jeux.
  - `native/KaneMode.Widget/Widget.cpp` : app UWP C++/WinRT (sans XAML), un `WebView2` de **WinUI 2.8** qui affiche `ui/widget.html` lu dans le paquet (hôte virtuel `https://kanemode.widget/`, `SetVirtualHostNameToFolderMapping` sur `app\ui`). Journal : `%LOCALAPPDATA%\Packages\KaneMode_7gtma5f85sgk8\LocalState\widget.log` (à lire via WMI depuis Claude).
    - Pièges trouvés : `init_apartment()` **multithread** (un STA levait `RPC_E_CHANGED_MODE` avant tout, cause du plantage de l'ancien widget) ; l'app fournit `IXamlMetadataProvider` (`XamlControlsXamlMetaDataProvider`) et `XamlControlsResources` ; le composant WebView2 pour UWP est dans **`webview2-uwp\`** car il porte le même nom que la dll .NET de KaneMode.exe (l'écraser faisait planter KaneMode au démarrage ; `build.ps1` refuse désormais tout conflit de nom).
    - `build-widget.ps1` : NuGet Game Bar 7.3.2607010, WinUI 2.8.6 (paquet d'exécution `Microsoft.UI.Xaml.2.8` 8.2310.30001.0, dépendance du paquet, embarqué dans l'installateur), WebView2 1.0.2903.40 ; cppwinrt + `cl` (vcvarsall `x64 uwp`). `build.ps1` injecte dans le manifeste les classes WebView2 (`__WEBVIEW2_CLASSES__`) ; `-NoWidget` retire tout ce qui est entre les marqueurs `WIDGET`.
  - La page parle au widget par `postMessage` : `{type:'api', id, method, path, body}` → hôte ; `{type:'native', message}` → app (`toApp` dans `core.js`, mode `WIDGET` détecté par le chemin `widget.html`). Le widget relaie par le tube nommé (`WidgetBridge.cs`, conteneur du paquet, SID calculé) et renvoie `{type:'api-result', id, status, body}`.
  - Messages natifs permis au widget (`WidgetMessages`) : `widget-state` (jeu en cours), `game-stop`, `show` (ouvrir KaneMode, éventuellement sur une page), `power`, `lossless` (Ctrl + Alt + S).
  - `ui/js/widget.js` (refait en 1.7.0) : bandeau en direct (images/s et GPU par ADLX, CPU, batterie), jeu en cours (arrêt en deux appuis, puis forcé), profils Économie / Équilibré / Performance / Personnalisé avec leurs watts (Personnalisé ouvre le curseur de puissance), catégories sur une ligne défilante (Écran, Graphismes, Performance, Son, Réseau), raccourcis vers KaneMode. Tuiles de même hauteur : interrupteur (appui), ou **panneau** en bas (`openSheet`, une couche de `nav.js`) avec un curseur glissable au doigt (gauche/droite à la manette) ou une liste de choix. **Plus de flèches ◀ ▶** (l'utilisateur n'aimait pas). `GET /api/widget` : version, accent, Lossless Scaling. Le widget ne renvoie jamais son accent (`syncAccent` coupé).
  - Tester l'interface du widget sans toucher au système : une page de démo avec une API simulée (Ally X + Radeon) injectée avant `widget.js` ; ne **jamais** cliquer les tuiles sur `node host/server.js` (réglages réels du PC de l'utilisateur).
  - HDR : `syscontrol.ps1` classe `Hdr` (DisplayConfig, advanced color : lecture type 9, bascule type 10), commande `hdr`, `state.hdr` (-1 sans écran HDR).
  - Tester sur ce PC : paquet signé en version supérieure (`build.ps1 -Pack -Version 1.x.y.z`, installé via WMI), puis `explorer "ms-gamebar://launch/activate/KaneMode_7gtma5f85sgk8_Widget_KaneModeWidget"`. `-Register` est refusé par-dessus une version installée depuis un paquet signé.
  - La mise à jour intégrée n'installe pas WinUI 2.8 : un PC sans ce paquet échouerait (l'ancienne version reste). Il est présent partout où la Microsoft Store et la Game Bar sont à jour.
- `KaneMode.App/GameWatch.cs` : jeu lancé depuis KaneMode (message `launch` avec `id`, `steamAppId`, `dir`, envoyé par `game.js` après `/api/launch`).
  - « Le jeu tourne » = un processus dont l'exécutable est dans `dir` (`trackDir` de l'hôte : dossier d'installation, sinon dossier de l'exe ou de l'émulateur ; `GameDir` refuse une racine ou un dossier système), ou Steam qui le dit en cours (`RunningAppID`, `Apps\<id>\Running`). Sans dossier : ancienne méthode par fenêtres (nouvelle fenêtre d'un programme hors `Stores`/`Shell`, successeur).
  - Écran de lancement **par-dessus tout** (`Topmost`) : Steam qui démarre reste caché. Chaque **nouvelle** fenêtre du jeu est mise devant une fois (`ShowGame` : `Native.Raise` puis `PlaceBelow(KaneMode, jeu)`, car retirer `Topmost` remet KaneMode en tête des fenêtres normales, donc devant le jeu), et pendant 4 s KaneMode renvoie le jeu devant s'il reprend le focus (programme de démarrage qui se ferme, cas de FF7 Remake). Au bout de 25 s sans jeu, l'écran se retire et une nouvelle fenêtre de Steam est mise devant. B (`launch-cancel`) le retire aussi.
  - Steam en arrière-plan (surtout en mode Xbox, qui met sa fenêtre en avant) : l'hôte démarre Steam fermé avec `-silent` avant le lien du jeu (`startSteamSilently` : raccourci `DATA/steam-silent-*.lnk` ouvert par l'Explorateur, pour que Steam ne fasse pas partie du paquet MSIX). Pendant le lancement et les 90 premières secondes, une **grande** fenêtre de boutique qui passe devant est réduite (`SendStoreBack`, `SW_SHOWMINNOACTIVE`) ; ses petites fenêtres (questions de Steam) et l'overlay (`gameoverlayui`) restent.
  - À la fermeture, KaneMode revient devant **tout de suite** (`BackToKaneMode`), conclut après 3 s sans processus (`game-ended`), puis pendant 15 s réduit Steam ou reprend la main sur le bureau s'ils repassent devant.
  - Journal : chaque changement de premier plan pendant le suivi, et « mode Xbox » ou « bureau » au lancement. Premier endroit où regarder sur l'Ally (`%LOCALAPPDATA%\KaneMode\logs\kanemode.log`).
  - Messages : `game-query` (la fiche demande si le jeu tourne ; un jeu trouvé en cours est suivi), `game-front` (« Reprendre »), `game-stop` (`WM_CLOSE` aux fenêtres du jeu, ou `force` : arrêt de tous ses processus). Réponses : `game-state`, `game-started`, `game-ended`, `game-stop`, `game-front-failed`.
  - Fond de l'écran : une image « hero » du jeu tirée au hasard sur SteamGridDB (`/api/launch/wallpaper`, préparée à l'ouverture de la fiche).
  - Fiche du jeu : « Jouer » devient « Reprendre » (couleur d'accent) avec un bouton d'arrêt tant que le jeu tourne (`running` dans `game.js`) ; l'arrêt propose de forcer la fermeture au bout de 8 s.
  - Double lancement : l'hôte ignore un 2e `/api/launch` de la même entrée dans les 30 s (effacé par `/api/launch/ended`) ou d'un jeu Steam déjà en cours (`already`/`running` → `game-front`). Chaque lancement est noté dans `kanemode.log`.
- `KaneMode.App/AllyButtons.cs` : boutons de la ROG Ally lus sur la manette interne ASUS (HID VID 0B05, PID 1ABE/1B4C, collection qui accepte le rapport de fonction 0x5A). Rapport d'entrée 0x5A, 2e octet : 166 = Command Center, 56 = Armoury Crate, 167/168 = appui long/relâché (codes de Handheld Companion). Lecture partagée avec les services ASUS.
  - Actions (`buttons`, envoyé par l'interface) : `gamebar` (Windows + G), `qam`/`menu` (par-dessus la fenêtre active, `toggle` si KaneMode est devant), `home`, `taskview`, `screenshot`, `none`. Par défaut : Command Center = `taskview` (comme un appui long sur la touche Xbox, migration `btnCCTaskView` en 1.3.1), Armoury Crate = `gamebar`, appui long = `home`.
  - Invite « installer Armoury Crate SE » : pendant 4,5 s après l'appui, les nouvelles fenêtres sont notées dans le journal et celles d'ASUS/Armoury Crate ou du Microsoft Store sont fermées (`WM_CLOSE`). Le processus exact qui affiche l'invite reste à confirmer dans `kanemode.log`.
- `package/AppxManifest.xml` :
  - app `App` (WPF, full trust, `windows.gamingApp`, capacité `gamingHome`) ;
  - app `Widget` (UWP, extension `microsoft.gameBarUIExtension`), composants Game Bar et WebView2 pour UWP.
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
  - suivi des jeux (`GameWatch`) avec un vrai jeu Steam : testé avec de faux jeux (programme de démarrage puis jeu, arrêt poli et forcé) sur le PC de développement ; surveillance des dossiers des boutiques non testée avec une vraie installation ; comportement en mode Xbox (Steam réduit, retour sur KaneMode) testé seulement sur le bureau avec un faux Steam ;
  - mises à jour ASUS : l'API n'a pas pu être appelée depuis l'environnement de développement (proxy), format repris de G-Helper.
- Idées demandées ou à explorer :
  - KanePlay : fermer son QLocalServer dès `returnToKaneMode` (avant de quitter) éviterait qu'une relance parte vers l'instance qui se ferme ;
  - mises à jour officielles pour Lenovo (Legion Go) et MSI (Claw) ;
  - courbe de ventilateur ; limite d'images par seconde hors AMD (RTSS) ;
  - superposition transparente par-dessus les jeux.
- Historique récent :
  - 1.0.1 : navigation, Select/Start, modes de performance ;
  - 1.0.2 : son synthétisé, mesures en direct, KanePlay se ferme ;
  - 1.1.0 : premier widget Game Bar ;
  - 1.2.0 : widget façon Winhanced via le tube nommé, KanePlay au premier plan, démarrage plus rapide, effets allégés, mises à jour signalées dans le menu, B = menu sur l'accueil, son de démarrage grave ;
  - 1.3.0 : widget Game Bar retiré, boutons Command Center / Armoury Crate de l'Ally, sortie du mode Xbox avant de quitter, KanePlay au premier plan même à la relance, mises à jour officielles ASUS (BIOS, pilotes) ;
  - 1.3.1 : double lancement bloqué, écran de lancement par-dessus Steam avec un fond SteamGridDB au hasard, retour systématique à KaneMode quand le jeu se ferme, Command Center = vue des tâches ;
  - 1.4.0 : jeu suivi par son dossier d'installation, jeu toujours mis au premier plan, Reprendre / Arrêter sur la fiche, bibliothèque mise à jour toute seule ;
  - 1.4.1 : Steam reste en arrière-plan (démarrage `-silent`, fenêtre réduite si elle passe devant), retour immédiat sur KaneMode à la fin du jeu, journal des changements de premier plan (mode Xbox à valider sur l'Ally) ;
  - 1.5.0 : hôte beaucoup plus rapide (bibliothèque en mémoire, ETag), paramètres immédiats, SteamGridDB plus rapide, lettre façon SteamOS dans la bibliothèque, sons façon Switch 2 ;
  - 1.5.1 : sons plus doux, lettre sur le côté et seulement à partir de 40 jeux, Start / Select maintenus en jeu pour ouvrir menu et accès rapide par-dessus (à tester sur l'Ally) ;
  - 1.6.0 : widget Game Bar façon Winhanced (profils, écran, HDR, système, son, réseau, Lossless Scaling, jeu en cours), Start / Select en jeu retirés, KaneMode ne plante plus en se fermant ;
  - 1.7.0 : graphismes AMD (limite d'images/s, RSR, AFMF, Anti-Lag, netteté) et mesures GPU dans le widget, widget refait (curseurs et listes au lieu des flèches), puissance ASUS imposée par les modes et mode tenu contre Armoury Crate SE, interface qui suit un changement de résolution.
