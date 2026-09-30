# KaneMode

Interface « console » façon SteamOS pour Windows, qui devient l'app d'accueil du mode Xbox (Full Screen Experience). L'interface est en HTML/JS (`ui/`), servie par un petit hôte Node (`host/`), et affichée par l'app native (`native/`).

> Projet indépendant, sans lien avec Microsoft, Xbox, Valve ou Steam.

## Installation

1. Téléchargez **`KaneMode-Setup-<version>.exe`** dans les [Releases](https://github.com/Kaynegiordano/KaneMode/releases) et lancez-le (Windows demande une fois l'accord de l'administrateur).
2. L'installateur :
   - active le **mode développeur** de Windows (nécessaire : l'autorisation « application d'accueil » de KaneMode n'est pas signée par Microsoft) ;
   - approuve le certificat qui signe KaneMode et installe l'app (runtime .NET, Node.js et moteur de streaming inclus) ;
   - active le **mode Xbox complet** sans fenêtre : installe au besoin [Xbox Full Screen Experience Tool](https://github.com/8bit2qubit/XboxFullScreenExperienceTool) (téléchargé depuis sa page GitHub), puis l'active (`/silentenable`).
3. Redémarrez, puis **Paramètres > Jeux > Mode Xbox > Choisir l'application d'accueil > KaneMode**.

Windows 11 24H2/25H2 récent requis pour le mode Xbox (voir l'outil ci-dessus). Pour revenir en arrière : désinstallez KaneMode depuis les Paramètres, puis `setup/uninstall.ps1 -RevertXboxMode` (l'outil redémarre alors le PC).

### Mises à jour

KaneMode consulte les Releases de ce dépôt : **Paramètres → Système → Mises à jour** (versions stables, vérification au démarrage). Le paquet est vérifié (SHA-256), installé hors de l'app, puis KaneMode se relance.

### Publier une version (mainteneur)

```bash
powershell -ExecutionPolicy Bypass -File native/release.ps1 -Publish -Notes native/out/notes-x.y.z.md
```

Version : fichier `VERSION`. Le paquet est signé par le certificat « CN=KaneMode » de votre magasin de certificats (créé au premier build, valable 10 ans). **Sauvegardez-le** (fichier .pfx protégé par un mot de passe, à ranger hors du dépôt ; `-Restore` pour le réimporter) : sans lui, les mises à jour ne s'installent plus par-dessus les versions existantes.

```bash
powershell -ExecutionPolicy Bypass -File native/certificate.ps1 -Backup -Path E:\KaneMode-signature.pfx
```

## App native (développement)

```bash
powershell -ExecutionPolicy Bypass -File native/build.ps1 -Register
```

- Compile `KaneMode.exe` (C# / WPF + WebView2, .NET 8), assemble le paquet dans `native/out/layout` (interface, hôte, Node.js, icônes, manifeste) et l'installe en version de développement (mode développeur de Windows requis).
- Le paquet se déclare **application de jeu** (`windows.gamingApp` + capacité `gamingHome`) : KaneMode apparaît dans **Paramètres > Jeux > Mode Xbox > Choisir l'application d'accueil** (mode Xbox complet requis, voir plus bas). Raccourci dans KaneMode : Paramètres > Mode Xbox > « Ouvrir les réglages du mode Xbox ».
- Plein écran, une seule instance, l'hôte Node démarre et s'arrête avec l'app. Actions réelles : retour au bureau (en mode Xbox, KaneMode en sort d'abord, sinon Windows le relancerait), veille, redémarrage, extinction.
- Données : `%LOCALAPPDATA%\KaneMode` (bibliothèque, réglages, journal `logs\kanemode.log`). Au premier lancement, l'app reprend les données du prototype (`data\`).
- `-Pack` produit un `.msix` signé avec un certificat de test (`native/out/KaneMode.cer` à faire approuver sur le PC cible), `-Unregister` désinstalle, `-SelfContained` embarque le runtime .NET.
- Développement : `KaneMode.exe --windowed` (fenêtre normale), `--debug-port=9229` (inspection de l'interface).
- Prérequis actuels : runtime .NET 8 Desktop (sauf `-SelfContained`) et mode développeur (le fichier de capacité n'est pas signé par Microsoft).

## Installer (mode Xbox, version navigateur)

```bash
powershell -ExecutionPolicy Bypass -File setup/install.ps1 -Autostart
```

- Crée les raccourcis **KaneMode** (menu Démarrer, Bureau) et, avec `-Autostart`, le lancement à l'ouverture de session.
- Active le **mode Xbox complet** via XboxFullScreenExperienceTool : installe l'outil s'il manque (mettre le `.msi` dans `setup/msi/`), puis l'active sans interface (`/silentenable`, voir `vendor/README-KaneMode.md`, à compiler une fois avec `setup/build-xbox-enabler.ps1`). Sans cette compilation, l'outil s'ouvre et il suffit de cliquer « Enable ».
- `-Check` affiche l'état sans rien modifier.
- Désinstaller : `setup/uninstall.ps1` (`-RevertXboxMode` restaure Windows ; **l'outil redémarre alors le PC après 5 s**).

## Lancer sans installer (développement)

```bash
git clone --recursive https://github.com/Kaynegiordano/KaneMode.git
node host/server.js
```

### Moteur de streaming

Le streaming est intégré à KaneMode ; son moteur est [KanePlay](https://github.com/Kaynegiordano/KanePlay) (dérivé de Moonlight), inclus comme **sous-module** dans `engine/KanePlay` et compilé par :

```bash
powershell -ExecutionPolicy Bypass -File engine/build-engine.ps1
```

Prérequis : Visual Studio (C++), Qt 6 msvc 64 bits (`C:\Qt\<version>\msvc*_64`). Le résultat (`engine/out`, runtime Visual C++ inclus) sert en développement et est embarqué par `native/build.ps1`. KaneMode lance le moteur en **mode intégré** (`KANEPLAY_EMBEDDED`) : aucune fenêtre KanePlay, réglages et PC appairés propres à KaneMode (`HKCU\Software\KaneMode\Streaming`, `%LOCALAPPDATA%\KaneMode\Streaming`), sans lien avec un KanePlay installé à part.

Mettre à jour le moteur : `git -C engine/KanePlay pull`, puis recompiler et commiter le nouveau pointeur du sous-module.

Puis ouvrir http://localhost:5173. Le raccourci installé (`setup/launch.ps1`) ouvre la même interface en plein écran dans une fenêtre Edge dédiée.

## Fonctions

- **Bibliothèque multi-boutiques** : Steam (installés, **non installés** avec bouton Installer, raccourcis non-Steam, temps de jeu), Epic, GOG, Ubisoft, EA, Battle.net, Xbox / Game Pass, Amazon, Rockstar, Riot. Onglets : Installés, Tout, Favoris, Jeux, Applications, Non installés, Compatibles manette, Émulation, collections, par boutique.
- **Émulation** : dossiers de ROMs rangés par console (convention EmulationStation-DE / RetroBat), 28 consoles, 23 émulateurs détectés automatiquement (ou choisis à la main), lancement direct, cœurs RetroArch choisis automatiquement.
- **SteamGridDB, sans compte ni clé** : visuels automatiques pour tout ce qui n'en a pas ; fiche du jeu → **Visuels** : aperçu, Récupérer à nouveau, Annuler les modifications, Parcourir SteamGridDB, Importer votre image. Reprise des visuels posés dans Steam (dossier `grid`, SGDBoop, Steam ROM Manager). Une clé API perso reste possible (Paramètres → SteamGridDB → Avancé).
- **Streaming local** : une carte parmi les jeux récents, avec une jaquette aux couleurs de KaneMode, ouvre le streaming intégré (moteur KanePlay) : PC trouvés automatiquement, appairage, bibliothèque de chaque PC, réglages et profils, pause (LB+RB+Select+Y) et reprise de session ; **B** revient à KaneMode. Moteur compilé depuis le sous-module `engine/KanePlay`.
- **Veille façon SteamOS** : veille immédiate, fondu au noir, réveil avec logo et carillon, manettes vérifiées ; atténuation et veille automatiques (batterie / secteur) ; veille moderne (S0) gérée sur les consoles portables.
- **Consoles portables** : ROG Ally / Ally X / Xbox Ally, Legion Go / Go S / Go 2, MSI Claw, Steam Deck, ZOTAC Zone, AYANEO, OneXPlayer, GPD, AOKZOE reconnues ; interface agrandie au premier lancement, logiciel constructeur, pilotes graphiques, BIOS et pilotes du constructeur (ASUS), mises à jour de pilotes via Windows Update (installation avec accord administrateur).
- **Boutons de la ROG Ally** (Command Center, Armoury Crate, appui long) lus directement par KaneMode, même en jeu, sans Armoury Crate : Game Bar, accès rapide ou menu par-dessus le jeu, retour à KaneMode, vue des tâches, capture ; l'invite « installer Armoury Crate SE » est refermée. Réglages : **Paramètres → Console portable**.
- **Mises à jour officielles du constructeur** : sur les consoles ASUS, BIOS et pilotes publiés pour le modèle exact (API du site d'assistance ROG), comparés aux versions installées, avec le lien de téléchargement officiel.
- **Modes de performance** Économie / Équilibré / Performance : chacun règle d'un coup le mode d'alimentation de Windows, la limite et le turbo du processeur et le profil du constructeur (ROG Ally, Legion Go) ; sur ROG Ally, la puissance du mode est aussi imposée (Ally X : 13, 17, 25 W, 30 W sur secteur). Le mode choisi est **tenu** : si Armoury Crate SE (profils par jeu), le chargeur ou la veille le changent, KaneMode le rétablit. L'accès rapide affiche en direct la consommation sur batterie, la fréquence réelle du processeur et la limite de puissance.
- **Widget Game Bar** (Windows + G, ou le bouton Armoury Crate) : HUD par-dessus les jeux. Images par seconde et GPU en direct (graphique des 60 dernières secondes en option), profils d'énergie, réglages en tuiles (écran, graphismes AMD / NVIDIA / Intel, performance, son, réseau) : un appui inverse un interrupteur ou ouvre un curseur ou une liste de choix. Chaque réglage est relu après écriture et marqué « Vérifié ».
- **Moniteur en direct** : second widget Game Bar, compact, à épingler sur le jeu (images par seconde, GPU, processeur, consommation, puissance du mode, réglages actifs).
- **Graphismes du pilote**, par la bibliothèque officielle de chaque fabricant. Partout : limite d'images par seconde pour les jeux seulement (levée quand KaneMode est devant, remise à sa fermeture) et mode faible latence.
  - **AMD** (Radeon, ADLX) : Radeon Chill, Radeon Super Resolution, AMD Fluid Motion Frames, Radeon Anti-Lag, Radeon Image Sharpening ; images par seconde du jeu en direct.
  - **NVIDIA** (GeForce, NVAPI et NVML) : limite « Max Frame Rate », mode faible latence, synchronisation verticale ; charge, température et puissance du GPU.
  - **Intel** (Arc, Iris Xe, Intel Graphics Control Library) : limite d'images, mode faible latence, filtre de netteté ; charge, température et puissance du GPU.
- **Accès rapide réel** : volume et sourdine, luminosité, Wi-Fi, Bluetooth, mode d'alimentation de Windows, limite et turbo du processeur, fréquence de l'écran, profil et puissance (TDP) des ROG Ally / Legion Go, limite de charge ; sections à choisir et ordonner.
- **Énergie** : un profil sur batterie et un sur secteur (mode d'alimentation, profil constructeur, TDP, limite et turbo du processeur, fréquence, luminosité), appliqués au branchement ou au débranchement du chargeur.
- **Menu d'alimentation** au centre de l'écran : veille, redémarrer, éteindre, bureau Windows.
- **Langues** : français, anglais, espagnol, allemand, italien, portugais (Brésil), japonais et chinois simplifié, dans l'interface, les widgets Game Bar et le streaming local (Paramètres → Apparence → Langue ; par défaut, la langue de Windows).
- **Personnalisation** : accent (repris par le streaming local), fond, taille de l'interface et des jaquettes, coins, police, panneaux opaques, horloge, ordre des rangées de l'accueil.
- **Ajouts perso** : applis installées (Win32 + Microsoft Store), fichiers, liens web.
- **Style SteamOS** : logo animé qui apparaît pile sur l'éclat du son de démarrage (son synthétisé façon console de salon, aucun fichier ; un son perso est analysé et synchronisé de même ; vidéo et son perso possibles, l'ancienne vidéo est dans `extras\`), accueil avec bouton **Bureau Windows** (ferme KaneMode), menu principal, accès rapide (CPU/RAM en direct), recherche au clavier virtuel, médias (captures Steam / Game Bar), collections, paramètres par catégories (stockage, accessibilité, taille de l'interface, testeur de manette, état du mode Xbox…).

## Structure

| Dossier | Rôle |
|---|---|
| `host/server.js` | Hôte : interface + API (bibliothèque, lancement, visuels, émulation, système) |
| `host/lib/` | `steam.js` (VDF, temps de jeu, grid), `sgdb.js` (SteamGridDB), `emulation.js` (consoles, émulateurs, ROMs), `system.js` (mode Xbox, stockage, médias, sortie), `kaneplay.js` (streaming), `device.js` (console portable, pilotes), `oem.js` (BIOS et pilotes du constructeur) |
| `host/*.ps1` | Scan des boutiques, applis du menu Démarrer, extraction d'icônes |
| `ui/` | Interface (HTML/CSS + modules JS) |
| `native/` | App native : `KaneMode.App` (C#), `package` (manifeste MSIX, capacité gamingHome), `build.ps1` |
| `setup/` | Installation, lancement, désinstallation, compilation de l'activation silencieuse, icône |
| `vendor/` | XboxFullScreenExperienceTool (GPL v3) avec le mode `/silentenable` |
| `data/` | Généré : bibliothèque, réglages (`config.json`, contient la clé SteamGridDB), caches |

L'API n'accepte que des requêtes locales portant l'en-tête `X-KaneMode`. Veille / redémarrage / extinction sont simulés dans la version navigateur, réels dans l'app native.

## Commandes

| Action | Manette | Clavier |
|---|---|---|
| Se déplacer | Croix / stick gauche | Flèches |
| Valider | A / ✕ | Entrée |
| Retour | B / ○ | Échap |
| Menu principal | Select (View / Create) | M |
| Accès rapide | Start (Menu / Options) | Q |
| Rechercher | Y / △ | Y |
| Favori · action secondaire | X / □ | X |
| Onglets | LB / RB | Pg↑ / Pg↓ |

Select et Start s'inversent dans **Paramètres → Manette**.

## Licence et crédits

KaneMode est distribué sous licence **GNU GPL v3** (fichier `LICENSE`), car il inclut et redistribue des logiciels sous cette licence :

- [Xbox Full Screen Experience Tool](https://github.com/8bit2qubit/XboxFullScreenExperienceTool) de 8bit2qubit (GPL v3), copie modifiée dans `vendor/` (mode `/silentenable`, voir `vendor/README-KaneMode.md`) ;
- [ViVe](https://github.com/thebookisclosed/ViVe) de thebookisclosed (GPL v3), utilisé par l'outil ci-dessus ;
- [KanePlay](https://github.com/Kaynegiordano/KanePlay), dérivé de [Moonlight](https://github.com/moonlight-stream/moonlight-qt) (GPL v3), moteur de streaming (sous-module `engine/KanePlay`) ;
- Node.js (licence MIT), embarqué dans le paquet.

Bibliothèques des fabricants de cartes graphiques, téléchargées à la compilation (pas dans ce dépôt) et compilées dans de petits outils séparés (`app\tools`) :

- [ADLX](https://github.com/GPUOpen-LibrariesAndSDKs/ADLX) d'AMD (licence d'AMD) ;
- [NVAPI](https://github.com/NVIDIA/nvapi) de NVIDIA (licence MIT) ;
- [Intel Graphics Control Library](https://github.com/intel/drivers.gpu.control-library) d'Intel (licence d'Intel, reproduite dans `app\tools\intel-igcl-license.txt`).

Visuels : [SteamGridDB](https://www.steamgriddb.com) et la boutique Steam.