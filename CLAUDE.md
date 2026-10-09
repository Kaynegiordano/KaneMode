# KaneMode : notes pour Claude Code

Ce fichier résume le projet pour reprendre le travail sans contexte. **Répondre à l'utilisateur en
français.** Tout le texte visible (interface, messages, notes de version) et les commentaires du code
sont en français. Les messages de commit sont en anglais.

## Version 4.5.2 : alignement sur Kane OS

- Aucun changement de code : version de maintenance demandée par l'utilisateur pour suivre **Kane OS 4.5.2** (dépôt privé `Kaynegiordano/KaneOS`, `C:\KaneOS`). Kane OS détecte le paquet MSIX, le lance par `shell:AppsFolder\<famille>!App` en le mettant au premier plan, le ferme (`taskkill` sans `/F`) et reprend le canal de mise à jour (releases GitHub, `.msix` + `SHA256SUMS`, installation par un script lancé hors de l'app, comme `host/apply-update.ps1`). Ne rien changer au format des releases (nom `*.msix`, `SHA256SUMS.txt`) sans adapter `launcher/backend/kanemode.py` de KaneOS.
- VERSION : 4.5.2 ; notes dans `docs/releases/4.5.2.md`.

## Version 4.5.0 : retour à la base 4.1.0, sans GeForce NOW

- **GeForce NOW / OpenNOW retiré** à la demande de l'utilisateur (« compliqué », connexion impossible sur l'Ally). Les versions 4.2.0 et 4.2.1 sont annulées par `git revert` : sous-module `engine/OpenNOW`, `engine/build-opennow.ps1`, `host/lib/opennow.js`, routes `/api/cloud`, entrée de menu, `openCloud()`, reconnaissance de la fenêtre « KaneMode · GeForce NOW », copie dans `native/build.ps1`. Le code est donc celui de la 4.1.0 ; les dossiers `engine/.deps` (3,4 Go), `engine/out-opennow` et le sous-module ont été supprimés du disque. Le paquet redescend à ~136 Mo. Ne pas le réintroduire sans demande : l'ajout `GeForce NOW` de `ui/js/pages/add.js` (raccourci web `play.geforcenow.com`) existait déjà.
- Optimisation (`RawInputSink`) : l'écoute Raw Input n'est inscrite que **pendant le mode souris** (`Enable(on)`, `RIDEV_REMOVE` à l'arrêt), au lieu d'en permanence : une manette envoie des centaines de rapports par seconde qui passaient tous par le fil de l'interface. Les périphériques qui ne sont ni XInput (`&ig_`) ni DualShock sont écartés une fois pour toutes, et plus aucune allocation par rapport (tampon natif et tableau réutilisés, `HidGamepads.Feed` aussi).
- Mesures (hôte Node, 4.1.0) : démarrage 17 ms de chargement des modules à chaud, 45 Mo de mémoire, routes de l'API en 1 à 13 ms par `127.0.0.1` (le 200 ms vu avec `localhost` est la tentative IPv6 de curl : l'app utilise déjà `127.0.0.1`). Rien d'autre à gagner de ce côté.
- VERSION : 4.5.0 ; notes dans `docs/releases/4.5.0.md`.

## Version 4.1.0 : mode souris complet, plus de question sur Steam

- **Raw Input confirmé par l'utilisateur sur l'Ally** (« ça fonctionne ! ») : le mode souris marche devant toutes les fenêtres de l'expérience Xbox.
- La question « Quitter Steam ? » de la 4.0.6 est **retirée** à sa demande (dialogue `askQuitSteam`, réglage `steamMouseAsk`, routes `/api/steam/state` et `/api/steam/quit`, textes anglais). Le diagnostic « Steam garde la manette » était faux (voir 4.0.7).
- Nouvelle disposition des boutons (`GamepadMouse.cs`, hors KaneMode) : **A** clic gauche (maintenu : glisser) ; **Y** clic droit ; **B** retour (bouton précédent de la souris) ; **RB** avancer ; **LB** clic du milieu ; **X maintenu** : le stick fait défiler (vertical et horizontal, courbe du curseur, `SCROLL_GAIN` 1,5, un pas de 20 unités de molette) et le curseur reste en place ; **croix** : molette par crans. `MouseSources.Intent` compte aussi Y (masque 0xF30F). Dans KaneMode, les boutons restent ceux de la navigation. Banc `tools/mouse-mode-tests` mis à jour (disposition, défilement au stick). Textes (toast, Paramètres → Manette, widget), `docs/mouse-mode.md` et traductions anglaises mis à jour.
- VERSION : 4.1.0 ; notes dans `docs/releases/4.1.0.md`.

## Version 4.0.7 : Raw Input pour le mode souris

- Le journal de l'Ally (4.0.6, Steam fermé) a **corrigé le diagnostic de la 4.0.6** : Steam n'est pas la cause principale. Hors expérience Xbox (ligne « Curseur supplémentaire … expérience Xbox : non »), XInput donne de vraies valeurs hors de KaneMode et le mode souris marche (13:37:56–13:38:18, ~500 mouvements dans Epic et sur le bureau). **Dans l'expérience Xbox**, XInput reste à 0/0 pour KaneMode.exe même devant KaneMode (WebView2 voit le stick), et la lecture HID (`ReadFile`) ne reçoit qu'un rapport à chaque retour devant KaneMode : Windows ne donne la manette qu'à la fenêtre qui a le focus (ici le processus de WebView2). KaneMode relance aussi Steam 12 s après son démarrage (`warmStores`), ce qui annule une fermeture manuelle.
- `RawInputSink.cs` : fenêtre « message seulement » (`HwndSource`, `HWND_MESSAGE`) inscrite à Raw Input (usages 1/5 et 1/4, `RIDEV_INPUTSINK | RIDEV_DEVNOTIFY`) ; les rapports WM_INPUT (`RAWINPUT` : en-tête 24 octets en x64, puis `dwSizeHid`, `dwCount`, données) passent à `HidGamepads.Feed(chemin, rapport)`, décodé comme `ReadLoop` (`HidP_GetUsages` / `GetUsageValue` avec les données de description de la manette ouverte, identifiant de rapport 0 rétabli). Les données de description ne sont libérées que sous verrou (`_devices`). `Describe` ajoute `raw=` au journal « Sources ».
- Non vérifié sur la console : si l'expérience Xbox filtre aussi Raw Input (`raw=` n'augmente pas devant une autre fenêtre), essayer **GameInput** (`SetFocusPolicy`, lecture en arrière-plan, outil natif dédié comme `native/KaneMode.Gpu`) ou la configuration de bureau de Steam. Le banc `tools/mouse-mode-tests` définit un faux `RawInputSink` (pas de WPF).
- VERSION : 4.0.7 ; notes dans `docs/releases/4.0.7.md`.

## Version 4.0.6 : Steam garde la manette

- Cause trouvée dans le journal de l'Ally (4.0.4 / 4.0.5) : tant que **Steam tourne** (Steam Input), XInput renvoie « connecté » avec des sticks à **0/0 exact** (le repos réel de l'Ally X est 0/-1) pour KaneMode hors de sa fenêtre, et la lecture HID brute ne reçoit plus que 1 à 3 rapports. Steam fermé (13:06, Epic Launcher), le curseur bouge (+283 mouvements acceptés). KaneMode lance lui-même Steam en arrière-plan (`warmStores`, 12 s après le démarrage) : il tourne donc presque toujours. L'utilisateur confirme : Steam fermé, mode souris meilleur en mode bureau.
- Hôte : `GET /api/steam/state` ({running, game}) et `POST /api/steam/quit` (`steam.exe -shutdown`, refusé pendant un jeu Steam). UI (`main.js`, `askQuitSteam`) : à l'activation du mode souris, si Steam tourne sans jeu et que KaneMode est visible et a le focus, dialogue Quitter / Garder / Ne plus demander (une fois par activation). Réglage `settings.steamMouseAsk` (défaut vrai ; Paramètres → Manette). Aucun réglage de Steam modifié ; le préchauffage reste.
- Pas encore vérifié : le mode souris hors de KaneMode en expérience Xbox, Steam fermé. Pistes si insuffisant : GameInput (lecture en arrière-plan), configuration de bureau de Steam, courbe de vitesse du stick.
- VERSION : 4.0.6 ; notes dans `docs/releases/4.0.6.md`.

## Version 4.0.5 : curseur du mode souris partout en expérience Xbox

- Journal de l'Ally (4.0.2 et 4.0.4) : le curseur **bouge** hors de KaneMode (XInput : Epic Launcher +283 mouvements acceptés, 0 refus ; vue des tâches) mais n'était pas visible. `CursorOverlay` ne se montrait que si `GetCursorInfo` disait le curseur caché ; devant Epic, Steam, l'Explorateur, l'application annonce un curseur visible alors que l'expérience Xbox ne dessine aucun pointeur. Corrigé : en expérience Xbox (`Native.FullScreenExperienceActive`, relu toutes les 500 ms) la flèche reste affichée partout ; bureau classique inchangé. Un double curseur est possible si Windows en dessine un.
- Hypothèse bien appuyée par le journal, pas encore confirmée sur la console : la ligne « Curseur supplémentaire : affiché/masqué (curseur Windows …, expérience Xbox : …) » (20 au plus par activation) servira à le vérifier.
- Constat HID : sur l'Ally X (`vid_0b05&pid_1b4c&mi_05&ig_00`, rapport de 16 octets : X, Y, Rx, Ry, Z sur 16 bits, centre 0x8000, chapeau 4 bits) le décodage est juste, mais `HidGamepads` ne reçoit que ~29 rapports puis plus rien ; XInput fonctionne hors de KaneMode. Piste si besoin : ne plus compter sur HID pour les manettes XInput.
- VERSION : 4.0.5 ; notes dans `docs/releases/4.0.5.md`.

## Version 4.0.4 : diagnostic des sources de manette

- Problème ouvert : le mode souris ne bouge le curseur que dans KaneMode (source WebView2) ; hors de KaneMode, sur la ROG Ally en expérience Xbox, aucune source native ne donne les axes (constaté aussi en 4.0.2). XInput ne donne rien à KaneMode en mode Xbox ; la lecture HID brute (`&ig_`, Ally X : `vid_0b05&pid_1b4c&mi_05&ig_00`) devrait marcher partout mais n'a jamais été vérifiée sur la console : rapports non reçus ou axes mal décodés.
- Cette version ne change aucun comportement : `HidGamepads` journalise la description de la manette (taille du rapport, plage de chaque axe) et les deux premiers rapports bruts ; `XInputPads.LogSources` écrit toutes les 5 s (40 lignes au plus par activation) le premier plan et ce que reçoit chaque source (code et paquet XInput, rapports et dernier rapport HID, relais WebView2).
- Suite : l'utilisateur teste (mode souris, autre fenêtre, sticks) et envoie `kanemode.log` ; corriger alors le décodage HID ou changer de source selon les lignes « Sources » et « Manette HID n : … ». Un Raw Input (`RIDEV_INPUTSINK`) reste une piste si la lecture HID ne reçoit rien.
- VERSION : 4.0.4 ; notes dans `docs/releases/4.0.4.md`.

## Version 4.0.3 : robustesse

- Revue du code (demande de l'utilisateur) : tests et compilation propres, trois faiblesses corrigées. `sendFile` (`host/server.js`) : flux fermé proprement via `pipeFile` (un fichier supprimé ou verrouillé pendant l'envoi levait une erreur non gérée qui arrêtait l'hôte), plages vidéo validées (416, `bytes=-N`, fin ramenée à la taille). `XInputPads.Loop` attrape toute erreur (journal : une ligne par 10 s) car ce thread fait vivre le mode souris ; `HidGamepads.ReadLoop` referme la manette fautive au lieu de tuer l'application ; `App` journalise `AppDomain.UnhandledException`.
- À surveiller : pas de filet `uncaughtException` dans l'hôte Node (la relance automatique de l'app le couvre) ; `server.js` fait 1 700 lignes avec des E/S synchrones. Les mises en page Chromium (`tools/verify-interface.cjs`) demandent Playwright, absent de ce PC : non relancées.
- VERSION : 4.0.3 ; notes dans `docs/releases/4.0.3.md`.

## Version 4.0.2 : axes du mode souris

- Retour utilisateur : basculement et navigation possibles, mais aucun déplacement du curseur, avec toutes les manettes essayées. Les vérifications précédentes ne prouvaient pas la lecture effective des axes sur sa console.
- Suppression du veto WebView2 fondé sur la présence d’une source native de même famille. `MouseSources.cs` choisit la dernière commande réelle et gère les remises au neutre et déconnexions. Une source native muette ne bloque plus le relais. `mouse-relay.js` fait expirer un état figé en arrière-plan d’après valeurs/horodatage ; le message `connected:false` retire le relais sans inventer de remise au neutre.
- `HidGamepads` développe les plages de capacités (auparavant seulement UsageMin), conserve ReportID/LinkCollection, étend le signe et garde les axes entre rapports distincts. Tests allant des capacités et valeurs HID simulées jusqu’à l’émission d’un mouvement, plus source muette, doublons, expiration et reprise.
- Diagnostic natif dans Paramètres → Manette : attente, acceptation, refus, suspension ; compteurs de mouvements et transitions dans le journal. L’acceptation par SendInput ne garantit pas qu’un jeu relâche sa capture du curseur.
- `tools/mouse-platform-tests` lie le vrai `Native.cs` : appel Windows accepté avec déplacement nul, bureau interactif reconnu et position conservée sur ce PC. Aucun clic ni touche. `tools/verify-mouse-relay.js` vérifie la fraîcheur séparément ; les tests d’interface vérifient l’état et les compteurs du diagnostic.
- Compilation locale complète réussie ; tests natifs, tests Node ciblés et 120 mises en page Chromium passent. VERSION : 4.0.2 ; notes dans `docs/releases/4.0.2.md`. Commit et publication demandés par l’utilisateur. Fonctionnement sur la console concernée encore à confirmer.

## Version 4.0.1 : manette conservée en mode souris

- Retour utilisateur : le mode souris coupait la manette dans KaneMode. `XInputPads` envoyait `[]` en mode souris ; `nav.js` ignorait tous les boutons. Les deux coupures sont supprimées, tout en gardant la navigation bloquée derrière une autre application ou le streaming.
- Dans KaneMode : stick gauche/boutons pour la navigation, stick droit pour le curseur. `GamepadMouse` n’injecte ni clic ni molette pendant que KaneMode a la main, pour éviter les doubles actions. Un bouton tenu au passage vers une autre fenêtre attend son relâchement.
- Start court garde son action ; Start long bascule aussi pour les manettes uniquement WebView2. Le choix du mode au début du maintien empêche un second basculement après celui du lecteur natif.
- Tests de coexistence natifs et Chromium ajoutés ; guide et traductions actualisés. Tests natifs, tests Node et 120 mises en page Chromium passent ; états de manette et injection simulés, validation physique sur console à confirmer.
- VERSION : 4.0.1 ; notes dans `docs/releases/4.0.1.md`. Certificat de signature habituel et moteur de streaming conservés.

## Version 4.0.0 : mode souris global

- Demande : mode souris conservé dans toute l’expérience Xbox, quelle que soit la fenêtre. Suppression des arrêts automatiques à l’ouverture d’une boutique, d’un jeu ou de KanePlay ; nouvel appui long Start/Options pour le couper.
- `GamepadMouse.cs` : injection indépendante du premier plan, gestes continus, relâchement à l’arrêt/verrouillage/veille, clics refusés attendant un nouvel appui, journal des refus limité. `CursorOverlay` suit par minuterie même lorsque KaneMode est réduit, sans activation de fenêtre, et s’arrête à la fermeture.
- `HidGamepads` lit aussi les DualShock 4 Sony 054c:05c4/09cc, USB/Bluetooth. `DualShockReports` vérifie les formats et convertit les commandes usuelles au format XInput. Pas de configuration de pilote, commande de sortie, vibration ou modification du périphérique. Publication des rapports et du relais UI sous verrou ; priorité aux sources natives Sony/Xbox par rapport à un état WebView2 ancien du même type. Glyphe PlayStation conservé dans les données natives.
- `nav.js` sépare le relais souris de la navigation de fond bloquée en 3.9.0. Aucun jeu local ne doit être validé pendant ce relais ; déconnexion d’une manette relayée → rapport neutre.
- Vérifier : `dotnet run --project tools/mouse-mode-tests/MouseModeTests.csproj` (souris/rapport DualShock simulés, aucun SendInput réel), suite Node de la 3.9.0, tests natifs existants, `tools/verify-interface.cjs` (relais souris derrière le streaming et contrôles existants).
- Vérifications effectuées : 47 tests Node, tests natifs souris et protection/premier plan, 120 mises en page Chromium dont les réglages Manette, français et anglais. Aucun SendInput réel dans les bancs d’essai ; fonctionnement physique sur ROG Ally/PS4 en FSE à confirmer.
- VERSION : 4.0.0 ; notes dans `docs/releases/4.0.0.md`, guide `docs/mouse-mode.md`. Restrictions Windows/UIPI documentées. Moteur de streaming inchangé.

## Version 3.9.0 : silence, modes par alimentation et manette en streaming

- Sons d’interface, veille et réveil désactivés par défaut et une fois après mise à jour (`quietInterfaceDefault`). Réactivation ensuite conservée ; paramètres et synthèse du son de démarrage inchangés. `engineLook()` transmet explicitement le silence si aucun son d’interface n’est configuré.
- `host/lib/power-profiles.js` sérialise les choix de modes et réglages manuels, mémorise les valeurs réellement acceptées pour la source Windows courante et conserve l’autre source. Un nouveau mode remplace les réglages de performance manuels de cette source tout en gardant ses réglages d’écran.
- L’hôte surveille le chargeur toutes les 5 s, applique le profil au démarrage, au changement de source, à sa modification et au réveil, même avec l’interface en arrière-plan. Le navigateur ne déclenche plus une seconde application concurrente. Mode automatique désactivable dans Paramètres → Énergie ; profil inchangé non réappliqué à chaque tick.
- `input-gate.js` et `nav.js` bloquent les entrées hors du premier plan et pendant le passage à KanePlay. Boutons tenus au retour ignorés jusqu’au relâchement ; arrêt de la lecture des manettes WebView2 et des boucles d’image de navigation en arrière-plan. Un échec de streaming annule le passage au premier plan et rend la navigation.
- Vérification : 47 tests Node (`tools/verify-3.9.js` ajouté à la commande de la 3.8.0), tests natifs et 112 mises en page Chromium. DualShock simulée : ouverture, arrière-plan, bouton tenu, refus et nouvel appui. Modes choisis dans l’accès rapide et relus dans Énergie. Aucun changement de puissance réel effectué sur la machine de développement ; validation physique ROG Ally/PS4 à confirmer.
- VERSION : 3.9.0 ; notes dans `docs/releases/3.9.0.md`. Moteur de streaming inchangé.

## Version 3.8.0 : bibliothèques de comptes

- Demande : importer tous les jeux possédés, non installés compris, avec installation/lancement depuis KaneMode et extension future aux boutiques. Passerelle optionnelle Playnite ; aucune promesse d’intégration native de toutes les boutiques. Instant Gaming : plateforme d’activation de la clé, pas d’historique d’achats importé.
- `native/KaneMode.LibraryBridge` : plugin SDK 6.18.0, pipe Windows avec ACL utilisateur courant et jeton de session. `snapshot`, `ping`, `settings`, `install`, `start` ; aucune désinstallation. Connexions et mots de passe restent dans les connecteurs. `native/build.ps1` embarque seulement DLL et manifeste dans `app/tools/library-bridge`.
- `host/lib/accounts.js` : import complet, cache persistant, fusion par identifiant ou dossier exact d’une même boutique, alias conservant les identifiants locaux après désinstallation. Sources de nouveaux connecteurs ajoutées dynamiquement. La détection locale prime sur un ancien cache. L’import ne déclenche pas la synchronisation distante des achats : Playnite doit d’abord actualiser ses comptes.
- `Paramètres → Comptes et boutiques` : préparation de la passerelle, choix Playnite portable, téléchargement officiel proposé sans installation automatique, activation/désactivation, synchronisation et configuration des connecteurs. Boutons Installer/Jouer adaptés à la vraie boutique, état non installable explicite. Playnite ajouté aux processus de boutiques ignorés par GameWatch.
- Synchronisation au retour, au scan manuel et toutes les 15 min au premier plan si Playnite répond déjà. Aucun démarrage périodique de Playnite ; ouverture sur action explicite ou installation/lancement d’un jeu importé.
- Guide : `docs/library-accounts.md`. 39 tests Node (ajout `tools/verify-accounts.js` aux 33 de la 3.7.0), banc C# `tools/library-bridge-tests/LibraryBridgeTests.csproj` et 104 mises en page Chromium. Fiches/API des comptes simulées ; pas de connexion à un compte privé ni de téléchargement réel de jeu testé.
- VERSION : 3.8.0 ; notes dans `docs/releases/3.8.0.md`.

## Version 3.7.0 : lancements, boutiques et jeux connus

- `host/lib/launch.js` valide les fichiers et chemins, lance directement les exécutables et confie les URI, raccourcis et applis Store à `host/launch.ps1` (ShellExecute, requête JSON sur stdin). Aucun repli vers Explorer pour une cible absente. Le recours Windows pour une élévation conserve les arguments et remonte le refus.
- `ForegroundHandoff.cs` suspend la reprise automatique pendant une ouverture volontaire. La demande est annulée en cas d’échec et libérée au retour volontaire sur KaneMode. Les fenêtres sont relevées avant le lancement pour reconnaître aussi les applis Store rapides. Les boutiques ne sont plus réduites automatiquement et le minuteur qui reprenait le focus pendant 15 s après un jeu est supprimé.
- Retrait persistant dans `state.overrides[id].removed`, sans désinstallation ni modification des fichiers, collections, visuels ou historique. `/api/library/remove` valide les entrées locales installées ; accueil, recherche et listes normales filtrent les retraits, onglet Retirés pour restaurer. Différent du masquage existant.
- `host/known-games.ps1` détecte les clients Roblox et Minecraft dans les emplacements connus et les paquets Store installés. Roblox Studio et les installateurs sont exclus ; les identifiants Roblox restent stables entre versions. Pas de recherche Steam pour ces sources.
- Vérifier les 33 tests Node : commande de la 3.5.0 plus `tools/verify-store-discovery.js` et `tools/verify-launch-and-library.js`. Ce dernier teste aussi PowerShell Windows et les installations simulées de jeux connus. `dotnet run --project tools/idle-protection-tests/IdleProtectionTests.csproj` vérifie aussi le passage du premier plan. `tools/verify-interface.cjs` : 96 mises en page, erreurs de lancement, confirmation/annulation, retrait persistant, recherche/accueil et restauration.
- VERSION : 3.7.0 ; notes dans `docs/releases/3.7.0.md`. Les essais ne remplacent pas une validation sur la ROG Ally concernée.

## Version 3.6.0 : verrouillage automatique et détection Epic

- Protection activée par défaut, désactivable dans Paramètres → Veille (`preventIdleLock`). `IdleProtection.cs` conserve l’écran et le système actifs uniquement au premier plan de KaneMode, KanePlay ou d’une fenêtre du jeu suivi. Réinitialisation Windows après 15 s par mouvement nul, sans touche ni clic ; les mouvements nuls ne réinitialisent pas l’inactivité propre à KaneMode.
- Aucune préférence ni stratégie Windows modifiée. Libération au passage en arrière-plan, au verrouillage manuel, avant une veille demandée et à la fermeture. Notifications d’écran éteint / rallumé pour respecter le bouton d’alimentation et la veille moderne. Les stratégies imposées et les entrées refusées par Windows ne peuvent pas être garanties ; refus notés sans répétition dans le journal.
- Epic : scan Win32 et Win64, Program Files et Program Files (x86), chemin de désinstallation, App Paths et commande du protocole. Fonctions vérifiables dans `host/epic.ps1`, chemin détecté réutilisé par le préchauffage.
- `host/lib/pathwatch.js` suit le parent existant quand le dossier des manifestes Epic n’existe pas encore, puis descend au fil de l’installation. Nouvelle analyse au retour même rapide, contrôle des nouvelles boutiques toutes les 2 min au premier plan, sans scan périodique pendant un jeu. Nouvelles bibliothèques Steam surveillées aussi.
- Les jeux Epic locaux viennent des manifestes d’installation ; cette version ne connecte pas un compte Epic pour importer les achats non installés.
- Vérifier les 24 tests Node (`tools/verify-store-discovery.js` ajouté à la commande de la 3.5.0), `dotnet run --project tools/idle-protection-tests/IdleProtectionTests.csproj`, puis `tools/verify-interface.cjs` (96 mises en page, arrivée d’Epic et protection désactivable). Tests avec API simulées, aucun verrouillage ni mise en veille du PC de développement.
- VERSION : 3.6.0 ; notes dans `docs/releases/3.6.0.md`.
- Appels Windows réels validés hors du bac à sable : demande d’éveil acceptée puis libérée, compteur d’inactivité réinitialisé de 582672 à 47 ms par un mouvement nul, position du curseur conservée et notifications écran décodées. Dans le bac à sable, SendInput est refusé ; cela ne décrit pas les permissions de l’application installée.

## Version 3.5.0 : finition de l’interface et deux langues

- Demande : harmoniser l’interface ; ne garder que Français et Anglais, widget et streaming compris. Les notes de la 3.3.0 ci-dessous décrivent la version déjà publiée.
- Accueil : reprise sans grand titre répété, informations des collections épinglées actualisées. Bibliothèque : onglets défilants sur une ligne, onglet demandé visible même avec beaucoup de collections.
- Paramètres : titre de catégorie, repère persistant, surfaces sombres au focus, contrôles adaptés à la largeur disponible. Une catégorie demandée directement ne doit pas être remplacée par celle de l’ancien focus.
- Navigation : focus DOM aligné sur la sélection ; Tab/Maj+Tab restent dans la couche courante ; pages inactives et contenu derrière les dialogues inertes ; rôles et états accessibles des cartes, interrupteurs et sélecteurs.
- Langues : un seul dictionnaire `ui/i18n/en.json`, anciennes préférences migrées vers une langue proposée. Streaming : source anglaise et seul catalogue français ; valeurs historiques LANG_AUTO=0, LANG_EN=1, LANG_FR=2 conservées, langues retirées remplacées par Automatique.
- Vérifier : `node --test tools/verify-languages.js tools/verify-optimizations.js tools/verify-personalization.js tools/verify-dolby.js`. Essais Chromium `tools/verify-interface.cjs` (Playwright, variables optionnelles KANEMODE_PLAYWRIGHT, KANEMODE_BROWSER et KANEMODE_UI_OUTPUT) : API simulées, 803 jeux, zoom 100–150 %, portable/TV, clavier et dialogues. Recompiler le moteur après la suppression de ses catalogues.
- VERSION : 3.5.0 ; notes dans `docs/releases/3.5.0.md`. Les six options de personnalisation, l’accès Dolby et le son de démarrage sont conservés.

## Version 3.3.0 : personnalisation et Dolby

- Six options dans Paramètres → Personnalisation : packs d’ambiance avec aperçu réversible, jeux/collections épinglés et reprise sur l’accueil, styles de jaquettes SteamGridDB, profils par écran, timbres et volume d’interface, mode immersif au repos.
- Profils : réglages personnels préservés ; l’identifiant du moniteur Windows permet d’associer Console portable ou TV et de retrouver le profil à chaque écran. Aucun classement automatique d’un écran uniquement d’après sa résolution.
- Sons : trois banques partagées avec le streaming, réglages transmis à une instance déjà ouverte ; volume indépendant de Windows/du flux du jeu. Son de démarrage conservé.
- Nouveaux textes traduits dans les sept langues de l’interface ; les traductions manquantes de versions antérieures ne sont pas modifiées.
- Vérifier : node --test tools/verify-optimizations.js tools/verify-personalization.js ; compiler l’app native et le moteur.
- Dolby : `host/dolby.ps1` lit les sorties, formats disponibles, format sélectionné et format actif via WinRT officiel ; l’état de licence reste inconnu et l’achat/restauration passe par Dolby Access. `host/lib/dolby.js` sérialise les changements, valide les sorties et formats, relit puis restaure le précédent en cas de refus. API `/api/dolby` et `/api/dolby/open`, protégées comme les autres routes.
- Paramètres → Dolby Atmos, raccourci de l’accès rapide et tuile Son du widget Game Bar. Profils et égaliseur restent dans Dolby Access ; aucun moteur ni fichier de licence Dolby embarqué.
- `native/KaneMode.Audio/fetch-tool.ps1` prépare SoundVolumeView 2.53 x64, archive et exécutable fixés par SHA-256. Distribution complète et inchangée embarquée dans `app/tools/soundvolumeview`, avec sa licence freeware propre (KaneMode gratuit).
- Test réel : Windows Sonic puis Dolby Atmos sélectionnés et relus sur une sortie virtuelle inutilisée, toutes les sorties restaurées. Ne pas modifier la sortie principale pour les tests. Les achats et profils Dolby Access ne sont pas testés ici (application absente).
- Vérifier aussi `node --test tools/verify-dolby.js`. VERSION : 3.3.0 ; notes dans `docs/releases/3.3.0.md`.

## Version 3.2.0

- Demande actuelle : sons d'interface graves et feutrés (147–440 Hz, aigus filtrés à 900 Hz, aucun clic bruité ; démarrage intact), taille réelle des mises à jour, retrait des accès Bureau Windows, fermeture complète depuis Alimentation, fluidité et chargements plus rapides.
- Le bureau n'a plus de bouton direct ; Alimentation → Quitter KaneMode ferme l'app après la sortie du mode Xbox. Cela remplace le comportement 2.1.0 décrit dans l'historique ci-dessous.
- Streaming : test matériel différé après l'affichage, SDL vidéo différé en mode intégré, serveur local fermé dès le retour vers KaneMode. Le moteur modifié est compilé dans engine/out et versionné dans le sous-module.
- Visuels : requêtes partagées, première page rapide, galerie complétée sur place, chargement proche de l'écran et priorité au focus ; cache HTTP avec révision. Navigation directe entre voisins des grilles et index des jeux en mémoire.
- Vérifier : `node --test tools/verify-optimizations.js`, compilation native et compilation du moteur. Les mesures de navigation sur 803 jeux simulés montrent ~2,5× sur le parcours mesuré ; ne pas extrapoler à une session réseau réelle.
- VERSION : 3.2.0. Notes de version : native/out/notes-3.2.0.md.

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
- `lib/gpuctl.js` (2.7.0, remplace `lib/amd.js`) : **réglages graphiques du pilote pour AMD, NVIDIA et Intel**. Un outil C++ par fabricant, qui reste ouvert et lit une commande par ligne (`state`, `live`, `set <fonction> <valeur>`, réponse JSON sur une ligne, même protocole pour les trois). Un seul est utilisé : celui de la carte qui fait tourner les jeux (ordre NVIDIA, AMD, Intel, d'après les identifiants PCI de `device.info()` ; les autres outils ne sont pas lancés ; sans outil disponible, nouvel essai au plus une fois par minute). L'état porte `vendor` (`amd`, `nvidia`, `intel`) ; le widget adapte ses libellés (`GFX` dans `widget.js`). Routes : `GET /api/graphics`, `GET /api/graphics/live`, `POST /api/graphics {feature, value}`, `POST /api/graphics/front {front}`.
- `native/KaneMode.Gpu` (2.7.0) : `kanemode-nvidia.exe` et `kanemode-intel.exe`, compilés par `build-gpu.ps1` (SDK téléchargés, commit fixé et empreinte vérifiée, **pas dans le dépôt**), base commune `Tool.h` (boucle de commandes).
  - **NVIDIA** : NVAPI (MIT), profil global des pilotes (DRS : `NvAPI_DRS_GetCurrentGlobalProfile`, une session par opération pour relire les changements faits dans la NVIDIA App) : `fps` = `FRL_FPS_ID` (« Max Frame Rate », 20 à 1000, 0 = réglage par défaut rendu), `antilag` = mode faible latence « Activé » (`PRERENDERLIMIT_ID` = 1 ; « Ultra » passe par des réglages non documentés, pas utilisés), `vsync` = `VSYNCMODE_ID` (0 choix du jeu, 1 forcée, 2 coupée, 3 autre). **Seuls des réglages documentés de `NvApiDriverSettings.h`** : pas de netteté ni de génération d'images (absents du kit public). Mesures par NVML (`nvml.dll` du pilote, chargé à l'exécution) : charge, température, puissance, fréquence ; **pas d'images par seconde** (NVIDIA ne les donne pas). Écrire le profil global ne demande pas les droits administrateur. **Testé sur la RTX 5080 du PC de développement** (lecture, écriture relue d'un lancement à l'autre ; ce PC a une limite de 116 i/s réglée par l'utilisateur, toujours la remettre après un essai).
  - **Intel** : Intel Graphics Control Library (IGCL, `ControlLib.dll` du pilote, chargée par `cApiWrapper.cpp` d'Intel ; `/DCTL_APIEXPORT=` pour ne rien exporter). Réglages globaux (nom d'application vide) des fonctions annoncées par `ctlGetSupported3DCapabilities` : `fps` (`CTL_3D_FEATURE_FRAME_LIMIT`), `antilag` (`LOW_LATENCY`, `boost` lu), `ris`/`rissharp` (`SHARPENING_FILTER` ; sans niveau si le pilote le donne en énumération : simple interrupteur). Carte séparée (Arc) préférée au GPU intégré. Mesures par `ctlPowerTelemetryGet` (charge et puissance calculées sur deux relevés). **Jamais testé sur un GPU Intel** (aucun sur le PC de développement ; l'outil répond « Pas de pilote graphique Intel »). **Licence d'Intel** : redistribution permise en reproduisant ses conditions, d'où `intel-igcl-license.txt` copié dans `app\tools`.
- `native/KaneMode.Amd` : réglages graphiques AMD par **ADLX** (bibliothèque du pilote, `amdadlx64.dll`). `kanemode-amd.exe` (C++, SDK ADLX 2.0 téléchargé par `build-amd.ps1`, commit fixé et empreinte vérifiée ; **le SDK a sa propre licence, il n'est pas dans le dépôt**).
  - Fonctions : `fps` (limite d'images par seconde : Radeon Chill avec minimum = maximum, sinon Frame Rate Target Control ; 0 = aucune), `rsr`/`rsrsharp`, `afmf`, `antilag`, `ris`/`rissharp`. `live` : images par seconde du jeu au premier plan, charge, température, puissance et fréquence du GPU.
  - Routes (2.7.0 : `/api/graphics`, avant `/api/amd`) : `available:false` + `reason` sans GPU réglable ; `POST` renvoie l'état complet (une fonction peut en couper une autre).
  - **Limite d'images : jeux seulement** (1.9.0). Radeon Chill vaut pour toute application 3D : réglée à 60 i/s, elle bridait l'interface de KaneMode (120 Hz sur l'Ally, plainte de l'utilisateur). La limite choisie est dans `config.fpsLimit` ; `applyFpsScope` la met dans le pilote seulement quand KaneMode n'est pas au premier plan (`fpsScope.front`, `POST /api/graphics/front`, envoyé par l'interface sur les messages natifs `resume` et `background` — `Deactivated` de la fenêtre). `GET/POST /api/graphics` renvoient `fpsLimit` et `kanemodeFront`. Au premier passage, une limite déjà dans le pilote devient `fpsLimit`. **À la fermeture** (2.7.0), la limite des jeux est remise dans le pilote : `HostProcess.Leave` envoie `front:false` avant d'arrêter l'hôte (1,5 s au plus), `/api/exit` aussi ; avant, fermer KaneMode depuis son interface laissait les jeux sans limite.
  - **Jamais testé sur un vrai GPU AMD** : le PC de développement a une RTX 5080 (ADLX se charge, « Pas de GPU AMD »).
- `lib/deals.js` : **bons plans et nouveautés** (2.5.0, rangée de l'accueil). API publiques sans clé :
  - Steam `store.steampowered.com/api/featuredcategories?cc=fr` (promos, nouveautés, sorties à venir ; applications seulement, `type === 0`) ;
  - Epic `freeGamesPromotions` (gratuits du moment et à venir ; image réduite par `?h=360&w=640&resize=1`, 40 Ko au lieu de 3 Mo) ;
  - GOG `catalog.gog.com/v1/catalog` (promos, nouveautés ; image `_ggvgm.jpg`, 40 Ko au lieu de 1,4 Mo) ;
  - GamerPower (jeux offerts ailleurs, hors Epic).
  - **Instant Gaming n'a pas d'API publique** : pas lu (lire leurs pages serait fragile et contraire à leurs conditions).
  - Cache `DATA/deals.json`, relu au-delà de 4 h, jamais avec un jeu devant (`GET /api/deals`, préparé 15 s après le démarrage). `POST /api/deals/open {id}` : adresse construite par l'hôte (`target`) : `steam://store/<id>` et `com.epicgames.launcher://store/p/<slug>` si la boutique est installée, sinon la page web ; GOG et GamerPower seulement si l'adresse lue est bien sur leur domaine.
  - Interface `js/deals.js` : liste gardée (`km.deals`) affichée tout de suite, 24 cartes au plus (gratuits, meilleures promos, nouveautés, gratuits à venir, sorties à venir), avance d'une carte toutes les 5 s au repos (pas en effets allégés, ni hors de l'accueil ou en arrière-plan). Réglages : Paramètres → Apparence → Bons plans (sources, catégories, défilement). `mergeOrder` (core.js) place une nouvelle rangée à sa place par défaut dans l'ordre choisi par l'utilisateur.
- `lib/gpudrivers.js` : **pilotes graphiques des fabricants** (2.6.0), vérifiés une fois par jour par l'hôte (`checkDriversDaily`, une minute après le démarrage puis toutes les 3 h si plus de 20 h, jamais avec un jeu devant ; aussi les mises à jour ASUS sur console ASUS) et à la demande (`POST /api/gpu-drivers/check`). Résultat dans `DATA/gpu-drivers.json`.
  - NVIDIA : API publique du sélecteur (`lookupValueSearch.aspx?TypeID=3` pour retrouver la carte par son nom exact, puis `AjaxDriverService … DriverManualLookup`) ; version installée tirée de celle de Windows (`32.0.15.7314` → `573.14`).
  - AMD : pas d'API ; la page officielle des pilotes contient le lien de l'installateur `amd-software-adrenalin-edition-<version>-minimalsetup-<aammjj>_web.exe`, comparé à `RadeonSoftwareVersion` (clé de la classe Affichage, lue par `device.ps1` : `adrenalin`). **Le lien direct n'est jamais ouvert** (`url` = page des pilotes) : sans référent amd.com, AMD le redirige vers sa page d'aide « Download Incomplete » (bug de 2.6.0). Console portable à puce AMD : `preferOem`, pas de notification (le constructeur fournit le pilote).
  - Intel : cartes et puces « Arc » seulement (métadonnée `DownloadVersion` de la page officielle des pilotes Arc) ; les autres : lien vers l'assistant d'Intel.
  - Page qui change de forme : statut `unknown` (« à vérifier sur le site »), jamais une fausse information. `allowed()` : seules les adresses trouvées ou les pages officielles s'ouvrent (`/api/device/open`).
  - `GET /api/drivers/summary` (`driverNews`) : pilotes nouveaux (carte graphique, BIOS et pilotes ASUS) ; l'interface (`checkDrivers` dans `main.js`, 90 s après le démarrage puis toutes les 3 h) les notifie une fois par version (`km.driverNotified`). Paramètres → **Appareil et pilotes** (ancienne catégorie « Console portable ») : bloc « Pilotes graphiques », puis « Autres pilotes (Windows Update) ».
- **Lancement des jeux** (2.6.0) :
  - Steam et Epic **prêts en arrière-plan** : démarrés sans fenêtre (`-silent`, raccourci ouvert par l'Explorateur) 12 s après le démarrage de KaneMode (`warmStores`, app seulement), pour chaque boutique dont un jeu est installé, sauf choix contraire (Paramètres → Bibliothèque → Lancement des jeux ; `config.storesReady`). Avant, Steam fermé ajoutait jusqu'à 6,5 s d'attente plus son démarrage avant le jeu.
  - Programme ouvert et jeu Steam en cours lus par `syscontrol` (`procs`, `steamapp`, quelques ms) au lieu de lancer `tasklist.exe` et `reg.exe` (plusieurs centaines de ms sur l'Ally) à chaque lancement.
  - Suivi du jeu (`GameWatch`) : `Native.ProcessesIn` garde le chemin de chaque processus (`EnumProcesses` + cache, les processus terminés sont oubliés) : 4,6 ms → 0,03 ms par revue sur le PC de développement ; vérification chaque seconde après 90 s de jeu (500 ms avant).
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
- `js/core.js` : `api`, `settings` (localStorage `km.settings`), `applyTheme` (CSS `--zoom`/`--vh` pour que l'interface agrandie ne déborde pas ; le zoom est en plus réduit sous 1280 × 720 points CSS, pour garder la même mise en page quand la résolution baisse ; `main.js` le recalcule et redessine la page à chaque `resize`), `native` (messages WebView2), `sfx` : sons d'interface façon SteamOS / Switch 2, **doux** (demande de l'utilisateur) : « tocs » de marimba (partiel 4 à peine présent), attaque de 5 ms, clic très faible, passe-bas à 3,6 kHz ; calculés une fois (`OfflineAudioContext`) puis rejoués. **Table unique `js/soundtable.js`** (`SOUNDS`, `SOFT`) : `tools/gen-sounds.js` en tire les .wav du streaming local (`engine/KanePlay/app/res/sounds`, 48 kHz mono, niveau compensé pour le volume 60 % du moteur) : **le même thème partout** ; modifier un son = modifier la table puis relancer `node tools/gen-sounds.js` et recompiler le moteur.
- `js/pages/library.js` : tri par nom et au moins 40 jeux dans l'onglet (`MANY`) : la lettre en cours s'affiche sur le côté droit en changeant de rangée, à la hauteur qui correspond à la position dans la liste (`.letter-hint`, comme SteamOS) ; LT/RT sautent à la lettre suivante ou précédente.
- `js/pages/settings.js` : une catégorie s'affiche tout de suite ; les blocs lents (mises à jour, pilotes, ASUS) se remplissent ensuite, et « Console portable » lit la description en cache (l'analyse WMI est relancée en arrière-plan).
- `js/main.js` : menus, accès rapide, relais « par-dessus KanePlay » (`overlay`), mises à jour (vérification au démarrage, au retour d'un jeu, au réveil et toutes les heures, au plus une fois par heure ; entrée « Mise à jour disponible » dans le menu), démarrage.
- `js/qam.js` : accès rapide (sections ordonnables), bandeau en direct `/api/sys/live`, modes avec leurs watts (`PROFILE_WATTS` par console).
- `js/pages/media.js` : captures, avec **suppression** (corbeille Windows, jamais définitive) : X sélectionne (mode sélection : A coche, « Tout sélectionner », « Supprimer (n) », « Terminer »), Y supprime la sélection ou la capture sous le curseur (confirmation), Y dans la visionneuse supprime la capture affichée. Hôte : `POST /api/media/delete {urls}` → `sys.deleteMedia` (`SendToRecycleBin`, liste passée par l'environnement ; seuls les fichiers des dossiers de captures connus, `isMediaPath`).
- `js/boot.js` : l'écran de logo dure jusqu'à la fin de l'animation (nom posé ~1,7 s après l'éclat) plus un instant : `total` ≥ 2,4 s après l'apparition (il était de 1,3 s et coupait le nom et l'éclat). Sons **synthétisés et calculés hors ligne** (OfflineAudioContext) ; le logo apparaît sur le pic du son (`playSynced`, horodatage de sortie audio).
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
  - le **mode souris** (2.0.0, comme KanePlay) : Start maintenu 1 s sur une manette XInput quand KaneMode a la main, ou KaneMode en arrière-plan devant le bureau Windows (`Focus.Desktop` : premier plan à personne, bureau, ou une fenêtre d'`explorer`). Depuis 2.6.1, plus derrière une fenêtre quelconque qui ne couvre pas l'écran (2.1.0) : un jeu en fenêtre lancé hors de KaneMode passait en mode souris quand on maintenait Start pour son menu pause. En mode Xbox l'app ne le voyait pas : l'interface, qui voit Start tenu 1,3 s sans réponse, envoie `mouse-mode {on:true}` (ignoré 2,5 s après une bascule de l'app). Interrupteur dans le widget Game Bar (catégorie Manette ; `widget-state` renvoie `mouse`). `SetMouseMode` neutralise un Start encore tenu. **Curseur de KaneMode** (2.2.0, `CursorOverlay.cs`) : en mode Xbox, Windows n'affichait aucun curseur (mode souris actif mais inutilisable) ; tant que `GetCursorInfo` dit le curseur caché, une petite fenêtre toujours au-dessus, transparente aux clics, dessine une flèche à sa position à chaque image (`CompositionTarget.Rendering`). D'où `ShutdownMode.OnMainWindowClose`. Stick le plus poussé = curseur (courbe de KanePlay, ~1 250 px/s en butée), A/B/X = clics gauche/droit/milieu, LB/RB = précédent/suivant, croix = molette (répétée). Marche dans toutes les fenêtres jusqu'au prochain appui long ; coupé au lancement d'un jeu ou de KanePlay (`StopMouseMode`). `SendInput` souris dans `Native.Mouse` ;
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
  - **Ouverture rapide** (2.4.2) : les derniers réglages connus (`km.hudSnapshot` : `sys`, `amd`, `info`, gardés 24 h) s'affichent tout de suite, puis sont relus ; avant, « Lecture des réglages… » restait plusieurs secondes au premier lancement (service `syscontrol` froid). Le logo est dans `widget.html` (plus de lecture d'`index.html` au démarrage). Premier focus : le profil d'énergie en cours.
  - **Navigation** (2.4.2) : manette lue à 60 Hz quand le widget a le focus (à 20 Hz, un appui bref pouvait être manqué) ; **LB / RB** changent de catégorie d'où que l'on soit et mettent le focus sur la première tuile (`hooks.button`, appelé par `nav.press` quand il n'y a ni page ni couche) ; repères « LB » / « RB » aux bouts de la rangée des catégories (manette seulement).
  - Graphique des 60 s du widget : **option** (catégorie Moniteur, `km.monitor.chart`), désactivé par défaut depuis 1.9.0.
  - `ui/js/widget.js` (refait en 1.7.0) : bandeau en direct (images/s et GPU par ADLX, CPU, batterie), jeu en cours (arrêt en deux appuis, puis forcé), profils Économie / Équilibré / Performance / Personnalisé avec leurs watts (Personnalisé ouvre le curseur de puissance), catégories sur une ligne défilante (Écran, Graphismes, Performance, Son, Réseau), raccourcis vers KaneMode. Tuiles de même hauteur : interrupteur (appui), ou **panneau** en bas (`openSheet`, une couche de `nav.js`) avec un curseur glissable au doigt (gauche/droite à la manette) ou une liste de choix. **Plus de flèches ◀ ▶** (l'utilisateur n'aimait pas). `GET /api/widget` : version, accent, Lossless Scaling. Le widget ne renvoie jamais son accent (`syncAccent` coupé).
  - Tester l'interface du widget sans toucher au système : une page de démo avec une API simulée (Ally X + carte AMD, NVIDIA ou Intel au choix) injectée avant `widget.js` ; ne **jamais** cliquer les tuiles sur `node host/server.js` (réglages réels du PC de l'utilisateur).
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

## Démarrage et relance de l'hôte (2.4.1)

- **Démarrage anticipé** (`BeginStart` dans `MainWindow`) : l'hôte (Node) et l'environnement WebView2 partent dès le constructeur de la fenêtre, plus après `Loaded`. Mesures dans le journal : « Lancement de KaneMode x.y.z (N ms depuis le démarrage du processus) », « WebView2 prêt (N ms) », « Hôte prêt (N ms) », « Interface chargée (N ms) ». Sur le PC de développement : 0,8 s avant le code de KaneMode (runtime .NET et WPF), interface chargée à 1,4 s.
- **ReadyToRun** (`PublishReadyToRun` dans le .csproj) : `KaneMode.dll` précompilée au `dotnet publish` de `build.ps1`, moins de compilation à la volée au lancement.
- **Cache de compilation de Node** : `NODE_COMPILE_CACHE` = `%LOCALAPPDATA%\KaneMode\cache\node` (Node 22+), le code de l'hôte n'est plus recompilé à chaque démarrage.
- **Relance de l'hôte** (`HostProcess.Crashed`, `OnHostCrashed`) : si Node s'arrête tout seul, il est relancé (nouveau port), le widget suit (`WidgetBridge.Start`) et l'interface est rechargée sans logo (`resume=1`). Plus de 3 plantages en 5 minutes : écran d'erreur (Entrée pour réessayer ; les services manettes/boutons ne sont démarrés qu'une fois, `_servicesStarted`). Testé en tuant Node : relance en moins d'une seconde ; les enfants de l'ancien hôte (PowerShell `syscontrol`, `kanemode-amd`) s'arrêtent d'eux-mêmes (fin de leur entrée standard).

## Numérotation

- Versions classiques **x.y.z** dans `VERSION` (paquet MSIX x.y.z.0, tag GitHub `vx.y.z`). La numérotation « K » n'a servi qu'à **K0.0.1** (= 3.0.1, tag `v3.0.1`) ; elle est abandonnée depuis la 3.0.2 (choix de l'utilisateur).
- **Langues : ne pas modifier les traductions sans demande de l'utilisateur.** Les nouveaux textes restent en français (repli de `t()`).

## Langues (K0.0.1)

- **Texte source : le français**, écrit dans le code et passé par `t()` (`ui/js/i18n.js`) ; `tn(n, singulier, pluriel)` pour les accords (règles de pluriel de la langue, `Intl.PluralRules`) ; `tx(message)` traduit à l'affichage un message venu de l'hôte (erreurs de `server.js`, de `syscontrol.ps1`, des outils graphiques C++) d'après des modèles à parties variables (`{a}`, `{b}`…) ; `toast()` passe tout par `tx()`. Textes d'`index.html` : `translateDom` au démarrage (`main.js`). Nombres et dates : `locale` de la langue (jamais `'fr-FR'` en dur, ni `replace('.', ',')`).
- Langues : fr, en, es, de, it, pt (Brésil), ja, zh (simplifié). Dictionnaires `ui/i18n/<langue>.json` (texte français → traduction). Choix : Paramètres → Apparence → Langue (`settings.lang`, sinon langue de Windows, sinon anglais) ; l'interface se recharge.
- `node tools/i18n.js` relève tous les textes (`tools/i18n-keys.json`) et dit ce qui manque par langue et les traductions dont les `{…}` diffèrent ; `node tools/i18n.js missing de` liste les textes à traduire. **Tout nouveau texte affiché passe par `t()`** et doit être traduit dans les 7 langues avant une version.
- La langue est transmise à l'hôte (`POST /api/config {lang}`, `config.lang`) : widgets Game Bar (autre stockage, `GET /api/widget` renvoie `lang`, la page se recharge), moteur de streaming (`KANEMODE_LANG` → fichiers `qml_<langue>` du moteur, voir `host/lib/kaneplay.js`), données des boutiques (Steam `l=`, Epic/GOG `locale=`, prix toujours pour la France ; métadonnées Steam relues si leur `lang` diffère). Genres Steam comparés par identifiant, jamais par nom.
- **Streaming local** (nom visible de KanePlay dans KaneMode) : depuis la 3.0.2, il n'est plus une entrée de la bibliothèque ni des jeux récents ; il s'ouvre par le menu et Paramètres → Streaming (`openStreaming`). Anciennement : entrée `kaneplay`, jaquette dessinée par `ui/js/streamcover.js` (SVG, couleur d'accent → violet du logo, titre dans la langue ; une jaquette choisie par l'utilisateur, `?v=`, reste prioritaire). Fenêtre du moteur intégré : **« KaneMode · Streaming »** (repérée par ce titre dans `MainWindow.xaml.cs` et `game.js`). Dans le moteur, `appName` vaut « KaneMode » en mode intégré (phrases « ce réseau bloque %1 »), l'en-tête dit « Streaming local » ; À propos garde KanePlay et Moonlight (crédits GPL). Focus manette dans le moteur : les boutons, onglets et filtres deviennent **blancs** (`Theme.focusFill`), mais les **tuiles** (réglages, liste des PC, profils, choix, licences) ne se soulèvent que d'environ un cinquième de blanc avec le texte clair (`Theme.tileFill` / `tileText` / `tileMuted`) : le blanc plein sur de grandes surfaces était trop lumineux.
- Traductions du moteur : `engine/KanePlay/app/languages/qml_*.ts` (fr, de, es, it, pt_BR, ja, zh_CN complets), mis à jour par `lupdate -recursive -extensions qml,cpp,h -locations none -no-obsolete gui backend cli settings streaming main.cpp -ts …`, compilés par `lrelease` (les `.qm` sont dans le dépôt du moteur).

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
    - mises à jour officielles pour Lenovo (Legion Go) et MSI (Claw) ;
  - courbe de ventilateur ; netteté et « Ultra » faible latence NVIDIA (réglages non documentés) ;
  - superposition transparente par-dessus les jeux.
- Historique récent :
  - 3.0.2 : streaming local retiré des jeux récents (menu seulement) et habillé comme KaneMode (logo K, surfaces et vert « Jouer », surbrillance blanche à la manette, coins de KaneMode via `KANEMODE_CORNERS`) ; thèmes prêts (Paramètres → Apparence → Thème) ; mode de performance par jeu (menu « … » du jeu, `config.gameModes`, appliqué au lancement) ;
  - 3.1.0 : suppression de captures dans Médias (corbeille Windows), sons d'interface identiques dans KaneMode et le streaming local (table `soundtable.js` + `tools/gen-sounds.js`), tuiles du streaming local moins blanches, intro qui va au bout de son animation ;
  - K0.0.1 (3.0.1) : interface en 8 langues (widgets Game Bar et streaming local compris), « KanePlay » devient « Streaming local » avec une jaquette aux couleurs de KaneMode ;
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
  - 2.7.0 : réglages graphiques NVIDIA (limite d'images, faible latence, synchro verticale) et Intel (limite d'images, faible latence, netteté) dans le widget et le moniteur, mesures GPU NVIDIA et Intel, limite des jeux remise à la fermeture de KaneMode ;
  - 2.6.1 : pilote AMD ouvert sur la page officielle (le lien direct renvoyait vers « Download Incomplete » sans référent amd.com), Start maintenu en arrière-plan seulement devant le bureau Windows ;
  - 2.6.0 : pastille de la boutique affichée par défaut (migration `badgesOnDefault`), jeux lancés plus vite (Steam/Epic prêts en arrière-plan, suivi du jeu allégé), pilotes graphiques NVIDIA/AMD/Intel vérifiés chaque jour avec notification ;
  - 2.5.0 : rangée « Bons plans et nouveautés » sur l'accueil (Steam, Epic, GOG, jeux offerts ailleurs) ;
  - 2.4.2 : widget Game Bar affiché tout de suite (derniers réglages connus), manette plus réactive dans le widget, LB / RB pour les catégories ;
  - 2.4.1 : démarrage plus rapide (hôte et WebView2 lancés plus tôt, ReadyToRun, cache de Node), relance automatique de l'hôte s'il plante, durées de démarrage dans le journal ;
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
