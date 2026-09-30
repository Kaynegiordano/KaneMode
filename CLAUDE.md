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
  - **Limite d'images : jeux seulement** (1.9.0). Radeon Chill vaut pour toute application 3D : réglée à 60 i/s, elle bridait l'interface de KaneMode (120 Hz sur l'Ally, plainte de l'utilisateur). La limite choisie est dans `config.fpsLimit` ; `applyFpsScope` la met dans le pilote seulement quand KaneMode n'est pas au premier plan (`fpsScope.front`, `POST /api/amd/front`, envoyé par l'interface sur les messages natifs `resume` et `background` — `Deactivated` de la fenêtre). `GET/POST /api/amd` renvoient `fpsLimit` et `kanemodeFront`. Au premier passage, une limite déjà dans le pilote devient `fpsLimit`.
  - **Jamais testé sur un vrai GPU AMD** : le PC de développement a une RTX 5080 (ADLX se charge, « Pas de GPU AMD »).
- `lib/device.js` : console reconnue (catalogue `HANDHELDS`) + `device.ps1` (WMI). Résultat mis en cache dans `DATA/device.json` et servi immédiatement au démarrage.
- `lib/kaneplay.js` : trouve `KanePlay.exe`, lit les PC appairés, prépare l'environnement (`KANEMODE_COMMAND`, accent…).
- `lib/update.js` : GitHub Releases, vérification SHA256SUMS ; `apply-update.ps1` installe hors du paquet puis relance. **Canal stable seulement** depuis 2.0.0 (le choix bêta a été retiré des Paramètres ; l'hôte vérifie toujours `stable`). Les blocs redessinés des Paramètres (mises à jour, pilotes, ASUS) gardent focus et position (`snapshot`/`restore` dans `settings.js`) : valider une mise à jour ramenait tout en haut.
- Réseau : commande `net` de `syscontrol.ps1` (carte active avec passerelle, filaire avant Wi-Fi, VPN/Bluetooth ignorés ; signal Wi-Fi par `netsh`), `GET /api/net` (gardé 5 s). Icône de la barre du haut : câble, Wi-Fi (pâle sous 40 %) ou hors ligne, relue toutes les 20 s.
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
  - les manettes **XInput lues par l'app native** (`XInputPads.cs`, message `xpad`, `setNativePads`) : au retour de KanePlay, l'API Gamepad de WebView2 ne voyait plus la manette (bug signalé en 1.7.0). L'app ne lit qu'au premier plan (125 Hz).
    - **Les deux sources sont lues ensemble** (1.8.1) : en 1.8.0, les manettes de l'app *remplaçaient* celles de WebView2, et sur la ROG Ally X la manette devenait « reconnue mais inutilisable » (une manette XInput inactive ou virtuelle privait l'interface de la vraie). État des boutons **par manette** (`heldBy`) : un bouton bloqué sur une manette fantôme ne gêne pas les autres ; le même appui vu par les deux sources compte une fois (`SAME_PRESS_MS`, 90 ms).
    - `readPads` tourne à chaque image, mais aussi à chaque message `xpad` et par une minuterie quand `requestAnimationFrame` s'arrête (page crue masquée par Chromium : c'est le cas du panneau de test de Claude, et probablement du retour de KanePlay).
    - Journal : `XInput : manette N détectée/retirée` (app) et `[interface] Manette : premier appui reçu par …` (message `log`, source de chaque manette) ;
  - **Start agit au relâchement** (2.0.0) : appui court = son action, maintenu ≥ 0,9 s = rien côté interface (l'app active le **mode souris**, message `mouse-mode` ; `mouseMode.on` : l'interface ignore alors toute manette, `body.mouse-mode` réaffiche le curseur, pastille « Souris » en haut) ;
  - **défilement doux maison** (`reveal`/`scrollToPos`, 2.0.0) : `scrollIntoView({behavior:'smooth'})` repartait de zéro à chaque répétition (toutes les 90 ms) et la bibliothèque saccadait direction maintenue. L'animation rattrape une cible qui bouge ; marges = `scroll-padding` du conteneur ; tient compte du `zoom` CSS (rectangles à l'échelle de l'écran, défilement à celle de la page) ; sans images dessinées (page crue masquée), saut direct à la cible ;
  - **retour sur une page** : l'historique garde sa position de défilement (`scroll`), `go` la remet avant de redonner le focus (la bibliothèque remontait en haut puis redescendait au jeu) ;
  - élément sélectionné retiré (bloc redessiné) : `move` reprend l'élément le plus proche de sa place (`spot`), plus le premier de la page ;
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
  - **Le vrai son PS2 ne doit jamais être intégré** : il est protégé (Sony). L'utilisateur l'utilise en « Son perso » (Paramètres → Démarrage → Son perso…, puis « Son perso »). Redemandé pour la 2.0.0 (« ajoute-le officiellement ») : refusé, expliqué ; il reste à le choisir sur chaque appareil (fichier dans OneDrive\Bureau).
- `js/pages/settings.js` : catégories à gauche (zone `side`) et réglages à droite (zone `content`). La catégorie s'affiche au survol, B revient à la liste.
- `app.css` :
  - effets coûteux remplacés par des transformations et de l'opacité ;
  - option `lowFx` (« Effets allégés »), activée d'office sur console portable.

### `native/`
- `KaneMode.App` (WPF, .NET 8) : fenêtre plein écran + WebView2. L'hôte et WebView2 démarrent **en parallèle**. Autres rôles :
  - la veille (`Native.cs`) ;
  - les manettes XInput (`XInputPads.cs`, fil à part : `xinput1_4.dll`, emplacements vides revus toutes les 2 s), envoyées à l'interface quand KaneMode a la main (`PadFocus` : `Ours`, ou `Orphan` = premier plan à personne : aucune fenêtre, fenêtre masquée ou camouflée, bureau, ou fenêtre d'appli cachée derrière KaneMode). Un bouton pressé en `Orphan` fait reprendre le premier plan (`ReclaimForeground`, noté dans le journal) : après KanePlay, la manette ne répondait plus jusqu'à passer par la vue des tâches (2.0.0). Jeu suivi ou KanePlay en cours de mise au premier plan : jamais. Fenêtre outil devant (`Other`) : seulement noté (« Manette : KaneMode est affiché mais … a le premier plan ») ;
  - **fermeture de KanePlay** (`WatchKanePlay`) : la reprise de 2.0.0 puis la recharge de l'interface en 2.1.0 n'ont pas suffi sur l'Ally. Une minuterie (1 s) voit la fenêtre « KaneMode · KanePlay » ; quand elle a disparu et qu'aucun `KanePlay.exe` ne tourne, KaneMode reprend le premier plan puis **déconnecte et reconnecte ses manettes** (2.3.0 : `XInputPads.Reconnect` rouvre les manettes HID et réinterroge XInput ; message `pads-reset` : `nav.js` vide tout son état de manette). Essais abandonnés : recharge de l'interface (2.1.0, insuffisant) et relance complète de KaneMode (2.2.0, « encore pire » : la manette semblait déconnectée). Aussi à la main : accès rapide → Raccourcis → « Reconnecter les manettes » (`pads-reconnect`). KanePlay lui-même n'a pas changé ;
  - **Vraie cause du bug de manette après KanePlay** (trouvée en 2.3.1 dans le journal de l'Ally) : KanePlay rendait la main avec `FindWindowW(nullptr, L"KaneMode")`, qui trouvait la fenêtre cachée du **widget Game Bar** (processus `KaneMode.Widget`, `Windows.UI.Core.CoreWindow`, titrée « KaneMode ») ; KaneMode restait affiché sans le premier plan et ne pouvait pas le reprendre. Il existe aussi une fenêtre cachée de `msedgewebview2` titrée « KaneMode ». KanePlay cherche désormais une fenêtre titrée « KaneMode » **de classe `HwndWrapper[KaneMode…`** (`findKaneMode` dans `kanemodebridge.cpp`, pour le retour et pour Start / Select). **Ne jamais chercher la fenêtre de KaneMode par son seul titre.** `Native.ForceForeground` essaie en dernier `SwitchToThisWindow`. Le curseur du mode souris prenait aussi le premier plan en apparaissant : il le rend, refuse l'activation (`WM_MOUSEACTIVATE`) et laisse passer la souris (`WM_NCHITTEST`) ; une fenêtre du processus KaneMode compte comme `Ours` ;
  - **manettes HID** (2.3.0, `HidGamepads.cs`) : hypothèse principale des bugs de l'Ally en mode Xbox, XInput ne donne rien à KaneMode (Start maintenu pas vu par l'app, mode souris sans stick ni boutons). Chaque manette XInput a aussi une collection HID « manette de jeu » (chemin `&IG_`), lue en HID brut sur son propre fil, indépendamment du premier plan (comme `AllyButtons`). Boutons HID 1-10 = A, B, X, Y, LB, RB, View, Menu, L3, R3 ; X/Y/Rx/Ry = sticks (Y inversé vers la convention XInput) ; chapeau = croix ; gâchettes non lues (axe Z combiné). Emplacements de `XInputPads` : 0-3 XInput, 4-7 HID, 8 manette relayée par l'interface pendant le mode souris (`mouse-pad`, fraîche < 400 ms). Journal : « Manette HID n ouverte/fermée ». **Pas testé** (aucune manette sur le PC de développement) ;
  - journal `Manette : <Focus> (premier plan …)` à chaque changement de `PadFocus` (diagnostic du mode Xbox) ;
  - le **mode souris** (2.0.0, comme KanePlay) : Start maintenu 1 s sur une manette XInput quand KaneMode a la main, ou (2.1.0) KaneMode en arrière-plan derrière une fenêtre qui ne couvre pas l'écran (`Focus.Desktop` : bureau, lanceur ; jamais sur un jeu plein écran ni un jeu suivi). En mode Xbox l'app ne le voyait pas : l'interface, qui voit Start tenu 1,3 s sans réponse, envoie `mouse-mode {on:true}` (ignoré 2,5 s après une bascule de l'app). Interrupteur dans le widget Game Bar (catégorie Manette ; `widget-state` renvoie `mouse`). `SetMouseMode` neutralise un Start encore tenu. **Curseur de KaneMode** (2.2.0, `CursorOverlay.cs`) : en mode Xbox, Windows n'affichait aucun curseur (mode souris actif mais inutilisable) ; tant que `GetCursorInfo` dit le curseur caché, une petite fenêtre toujours au-dessus, transparente aux clics, dessine une flèche à sa position à chaque image (`CompositionTarget.Rendering`). D'où `ShutdownMode.OnMainWindowClose`. Stick le plus poussé = curseur (courbe de KanePlay, ~1 250 px/s en butée), A/B/X = clics gauche/droit/milieu, LB/RB = précédent/suivant, croix = molette (répétée). Marche dans toutes les fenêtres jusqu'au prochain appui long ; coupé au lancement d'un jeu ou de KanePlay (`StopMouseMode`). `SendInput` souris dans `Native.Mouse` ;
  - le changement de résolution (`SystemEvents.DisplaySettingsChanged`) : `Native.FillMonitor` remet la fenêtre à la taille de l'écran, sans l'activer (WPF laissait la fenêtre sans bordure agrandie à l'ancienne taille : interface inadaptée après un changement de résolution depuis le widget) ;
  - `GiveForeground` (message `foreground` : KaneMode cède le premier plan et ramène lui-même la fenêtre KanePlay) ;
  - `WM_COPYDATA` « open\tqam|menu » envoyé par KanePlay (Select/Start), puis retour à KanePlay à la fermeture ;
  - le premier plan de KanePlay (`WatchForeground`) : pendant 15 s, KaneMode, encore au premier plan, guette la fenêtre « KaneMode · KanePlay » et la met lui-même devant (`Native.ForceForeground`, avec `AttachThreadInput`). Si plus aucun `KanePlay.exe` ne tourne après 1,5 s (commande partie vers une instance qui se fermait : `returnToKaneMode` masque la fenêtre puis quitte), il envoie `foreground-lost` et l'interface relance une fois ;
  - « Bureau Windows » (**2.1.0 : KaneMode ne se ferme plus**, demande de l'utilisateur) : en mode Xbox (`IsGamingFullScreenExperienceActive`, api-ms-win-gaming-experience-l1-1-0), Windows + F11 pour en sortir, puis KaneMode reste ouvert tel quel (`desktop-failed` si le mode Xbox reste actif après 30 s) ; déjà sur le bureau, KaneMode se réduit. Seul l'écran d'erreur de démarrage (Échap) quitte vraiment (`ExitToDesktop(quit: true)`).
- Start / Select maintenus en jeu (1.5.1, `PadHold.cs`) : **retirés en 1.6.0**. Afficher KaneMode par-dessus un jeu plein écran revient à changer de fenêtre ; le vrai « par-dessus le jeu », c'est le widget Game Bar.
- **Widget Game Bar** (1.6.0) : HUD façon Winhanced par-dessus les jeux.
  - `native/KaneMode.Widget/Widget.cpp` : app UWP C++/WinRT (sans XAML), un `WebView2` de **WinUI 2.8** qui affiche `ui/widget.html` lu dans le paquet (hôte virtuel `https://kanemode.widget/`, `SetVirtualHostNameToFolderMapping` sur `app\ui`). Journal : `%LOCALAPPDATA%\Packages\KaneMode_7gtma5f85sgk8\LocalState\widget.log` (à lire via WMI depuis Claude).
    - Pièges trouvés : `init_apartment()` **multithread** (un STA levait `RPC_E_CHANGED_MODE` avant tout, cause du plantage de l'ancien widget) ; l'app fournit `IXamlMetadataProvider` (`XamlControlsXamlMetaDataProvider`) et `XamlControlsResources` ; le composant WebView2 pour UWP est dans **`webview2-uwp\`** car il porte le même nom que la dll .NET de KaneMode.exe (l'écraser faisait planter KaneMode au démarrage ; `build.ps1` refuse désormais tout conflit de nom).
    - `build-widget.ps1` : NuGet Game Bar 7.3.2607010, WinUI 2.8.6 (paquet d'exécution `Microsoft.UI.Xaml.2.8` 8.2310.30001.0, dépendance du paquet, embarqué dans l'installateur), WebView2 1.0.2903.40 ; cppwinrt + `cl` (vcvarsall `x64 uwp`). `build.ps1` injecte dans le manifeste les classes WebView2 (`__WEBVIEW2_CLASSES__`) ; `-NoWidget` retire tout ce qui est entre les marqueurs `WIDGET`.
  - La page parle au widget par `postMessage` : `{type:'api', id, method, path, body}` → hôte ; `{type:'native', message}` → app (`toApp` dans `core.js`, mode `WIDGET` détecté par le chemin `widget.html`). Le widget relaie par le tube nommé (`WidgetBridge.cs`, conteneur du paquet, SID calculé) et renvoie `{type:'api-result', id, status, body}`.
  - Messages natifs permis au widget (`WidgetMessages`) : `widget-state` (jeu en cours), `game-stop`, `show` (ouvrir KaneMode, éventuellement sur une page), `power`, `lossless` (Ctrl + Alt + S), `gamebar-close` (Windows + G : B ferme la Game Bar).
  - **Deux widgets** dans l'app UWP (1.8.0) : `KaneModeWidget` (`widget.html`) et `KaneModeMonitor` (`monitor.html`, « KaneMode · Moniteur », 420 × 96, à épingler sur le jeu). Chaque ouverture a sa vue et son objet `Widget` (`AppExtensionId`). La page du widget principal envoie `{type:'open-monitor'}` au widget natif, qui ouvre le moniteur (`XboxGameBarWidgetControl(widget).ActivateAsync`). Le widget natif envoie `pinned` et `opacity` (transparence choisie dans la Game Bar) à la page.
  - `ui/js/hud.js` : réglages partagés par le stockage local (même origine) : mesures du moniteur (`km.monitor`, catégorie Moniteur du widget) et dernier réglage fait avec sa vérification (`km.change`), que le moniteur affiche 6 s (évènement `storage`).
  - **Preuve des réglages** (demande de l'utilisateur) : chaque réglage est relu après écriture (`CHECK` dans `widget.js` ; `syscontrol.ps1` relit luminosité, limite et turbo CPU, limite de charge ; le pilote AMD renvoie son état) et la tuile affiche 8 s « ✓ Vérifié », « ✕ » ou « ↗ Envoyé » (limites de puissance ASUS : écriture seule). Graphique des 60 dernières secondes (images/s, consommation) avec un trait par réglage.
  - **Performances par-dessus un jeu** (1.8.2, « ça rame sévère en jeu » sur l'Ally) : aucune animation dans les widgets (`body.widget *` : `animation: none`, le point pulsant « En cours » forçait la Game Bar à recomposer à chaque image) ; manette lue 20 fois par seconde et seulement avec le focus dans le widget, jamais dans le moniteur (plus de `requestAnimationFrame` à 120 Hz) ; mesures en une requête toutes les 2 s (`GET /api/hud/live`, gardée 700 ms par l'hôte et partagée avec le moniteur) ; bandeau et graphique mis à jour sur place ; page redessinée seulement si `/api/sys`, `/api/amd` ou `/api/widget` ont changé ; `tasklist` (Lossless Scaling) seulement s'il est installé, gardé 15 s ; chemin de la batterie gardé par `syscontrol`.
  - **B / rond** (ou Échap) sans panneau ouvert : ferme la Game Bar (`hooks.back` → message `gamebar-close` → Windows + G envoyé par l'app).
  - **AFMF** : ADLX ne compte que les images rendues par le jeu, pas celles générées par AFMF (aucune mesure dans le SDK 2.0). Le widget le dit. Le raccourci de l'overlay AMD (Ctrl + Maj + O) a été retiré en 1.9.0 : il ne fonctionnait pas sur la console. Une fonction du pilote peut aussi ne prendre effet qu'au lancement suivant du jeu.
  - Graphique des 60 s du widget : **option** (catégorie Moniteur, `km.monitor.chart`), désactivé par défaut depuis 1.9.0.
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

## Allègement et stabilité (2.4.0)

- **Manette dans l'interface** (`nav.js`) : quand l'app fournit les manettes (messages `xpad`), WebView2 n'est plus lu à chaque image mais toutes les 50 ms (16 ms tant qu'une direction est tenue, pour la répétition) ; sans manette de l'app, lecture à chaque image comme avant.
- **Fil des manettes** (`XInputPads`) : 60 Hz quand KaneMode a la main (125 Hz seulement en mode souris). `PadFocus` n'énumère les fenêtres que si le premier plan change, au plus une fois par seconde sinon (cache `_focusFor`/`_focusAt`). Recherche des manettes HID : 3 s tant qu'aucune n'est ouverte, 20 s ensuite.
- **Surveillance de KanePlay** : plus d'énumération des fenêtres chaque seconde ; KanePlay est repéré quand sa fenêtre a le premier plan, puis on attend la fin de son processus.
- **WebView2 en arrière-plan** : après 15 s hors du premier plan, `MemoryUsageTargetLevel = Low` (caches rendus) ; `Normal` au retour.
- **Hôte** : analyse de la bibliothèque toutes les 30 min (au lieu de 10) et jamais avec un jeu devant (`fpsScope.front`) ; PC de streaming relus toutes les 5 min (au lieu de chaque minute) et au retour sur KaneMode.
- **Profil ASUS non relisible** (ROG Ally X) : la relecture du profil (`Get(ThrottlePolicy)`) renvoie une valeur inconnue ; le widget affichait « profil ? · profil relu différent » à chaque mode. `Vendor-State` donne alors le dernier profil écrit (`$script:asusWritten`) avec `readable = false`, et le widget le montre « envoyé » (↗) au lieu d'une erreur. Le mode tenu (`policy`) ne peut donc rien vérifier sur cette console.
- **KanePlay, une seule manette sur le PC hôte** (`streamingpreferences.cpp`) : intégré à KaneMode, `multiController` passe une fois à faux (clé `kanemodesinglecontroller`) : toutes les manettes locales sont le joueur 1, le PC hôte ne crée qu'une manette virtuelle (il en avait parfois plusieurs). L'avertissement de Steam sur l'hôte (« ne parvient pas à lire le bouton Xbox ») vient de la Game Bar de l'hôte, qui garde le bouton Xbox : réglage de Windows sur le PC hôte.
- **Stabilité** : plus d'`ObjectDisposedException` à la fermeture (`Core` renvoie null une fois `_closing`, `Post` protégé ; vue dans le journal de l'Ally à chaque fermeture) ; tactile WPF par `WM_POINTER` (`EnablePointerSupport` dans le .csproj) au lieu de WISP, qui a fait échouer une fois l'ouverture de la fenêtre sur l'Ally.

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
  - 2.4.0 : allègement (manette lue moins souvent, fenêtres énumérées moins souvent, mémoire de WebView2 rendue en arrière-plan, analyses de l'hôte espacées et suspendues en jeu), fermeture et démarrage plus sûrs ;
  - 2.3.1 : KanePlay rend la main à la vraie fenêtre de KaneMode (pas à celle du widget Game Bar), le curseur du mode souris ne prend plus le premier plan ;
  - 2.3.0 : manettes lues aussi en HID brut, mode souris piloté par la manette en mode Xbox, reconnexion des manettes après KanePlay (au lieu de la relance) et dans l'accès rapide ;
  - 2.2.0 : KaneMode se relance entièrement après KanePlay (retiré en 2.3.0), curseur dessiné par KaneMode en mode souris quand Windows cache le sien (mode Xbox) ;
  - 2.1.0 : KaneMode se recharge à la fermeture de KanePlay, mode souris aussi en mode Xbox et sur le bureau (et dans le widget), « Bureau Windows » sort du mode Xbox sans fermer KaneMode ;
  - 2.0.0 : mode souris (Start maintenu), manette qui répond de nouveau après KanePlay, icône réseau (câble / Wi-Fi / hors ligne), bibliothèque fluide direction maintenue et qui garde sa position au retour d'une fiche, canal bêta retiré, Paramètres qui ne remontent plus en haut ;
  - 1.9.0 : limite d'images pour les jeux seulement (KaneMode n'est plus bridé à 60 i/s), graphique du widget en option, overlay AMD retiré ;
  - 1.8.2 : widget Game Bar beaucoup plus léger en jeu, B ferme la Game Bar ;
  - 1.8.1 : manette de nouveau utilisable sur ROG Ally X (sources de manette combinées au lieu d'être remplacées), lecture indépendante de requestAnimationFrame ;
  - 1.8.0 : moniteur en direct (widget Game Bar épinglable), réglages vérifiés et graphique de leur effet, overlay AMD, manette XInput lue par l'app (plus perdue au retour de KanePlay) ;
  - 1.7.0 : graphismes AMD (limite d'images/s, RSR, AFMF, Anti-Lag, netteté) et mesures GPU dans le widget, widget refait (curseurs et listes au lieu des flèches), puissance ASUS imposée par les modes et mode tenu contre Armoury Crate SE, interface qui suit un changement de résolution.
