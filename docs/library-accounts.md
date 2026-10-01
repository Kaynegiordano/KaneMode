# Bibliothèques de comptes dans KaneMode

La détection locale reste disponible sans connexion. La passerelle optionnelle Playnite ajoute les fiches de jeux possédés qui ne sont pas installés et permet de demander leur installation ou leur lancement depuis KaneMode.

## Configuration

1. Installez [Playnite depuis son site officiel](https://playnite.link/), ou utilisez sa version portable. KaneMode ne télécharge ni n’installe ce logiciel sans action de votre part.
2. Dans KaneMode, ouvrez **Paramètres → Comptes et boutiques**, puis activez **Importer mes bibliothèques de comptes**. La passerelle est copiée dans le dossier des extensions de Playnite. Pour une version portable non détectée, choisissez `Playnite.DesktopApp.exe`.
3. Fermez puis rouvrez Playnite pour charger l’extension. Aucun autre connecteur ni réglage de compte n’est écrasé.
4. Dans Playnite, ajoutez les connecteurs souhaités, connectez vos comptes et activez l’import des jeux non installés. Mettez à jour les bibliothèques avec **F5**.
5. Dans KaneMode, choisissez **Synchroniser avec Playnite**. Les connecteurs chargés apparaissent ensuite dans les réglages ; **Configurer ce compte** ouvre leurs paramètres de connexion.

La détection automatique de Playnite prend en charge son profil standard et sa version portable. Un profil redirigé manuellement par `--userdatadir` doit disposer de la passerelle et de son fichier `bridge-config.json` dans son propre dossier Extensions.

## Utilisation

- **Tout** et les catégories de boutiques affichent aussi les jeux non installés. **Non installés** permet de les retrouver directement.
- **Installer** transmet la demande au connecteur de la boutique. La boutique peut demander le dossier de destination, un accord de licence ou une confirmation. KaneMode ne remplace pas ses règles de licence ni son gestionnaire de téléchargements.
- Après installation, la détection locale et la synchronisation mettent la fiche à jour ; son bouton devient **Jouer**.
- Un jeu que le connecteur ne sait pas installer sur Windows est indiqué **Installation indisponible**. Sa présence dans une bibliothèque ne garantit pas qu’il soit jouable sur ce PC.
- Les jeux déjà reconnus par KaneMode sont fusionnés par identifiant de boutique ou dossier exact de la même boutique. Deux achats ayant le même titre ne sont pas fusionnés arbitrairement.
- Les retraits de bibliothèque, favoris, collections et visuels KaneMode restent attachés aux identifiants existants. Désactiver l’import conserve son cache et les comptes Playnite.

## Actualisation

La bibliothèque importée est enregistrée sur le disque et reste consultable quand Playnite est fermé. KaneMode relit la bibliothèque de Playnite au retour au premier plan, lors d’une actualisation manuelle et toutes les 15 minutes au premier plan si la passerelle fonctionne déjà. Ces vérifications ne démarrent pas Playnite en arrière-plan.

Les nouveaux achats doivent d’abord être importés par les connecteurs Playnite. **Synchroniser avec Playnite** copie sa bibliothèque actuelle ; cela ne constitue pas une nouvelle connexion à toutes les boutiques. Playnite peut actualiser ses bibliothèques au démarrage selon ses propres réglages.

Si la passerelle est fermée au moment d’une installation ou d’un lancement, KaneMode ouvre Playnite puis attend qu’elle réponde. Une erreur reste une erreur ; aucune commande n’est redirigée vers Documents dans l’Explorateur.

## Boutiques et vendeurs de clés

La passerelle utilise les plugins de bibliothèque chargés par Playnite : Steam, Epic, GOG, EA, Ubisoft, Battle.net, Xbox, Amazon et d’autres peuvent être utilisés selon les connecteurs installés, leur état et les droits du compte. Un nouveau connecteur compatible peut rejoindre KaneMode sans modification de sa liste de boutiques.

Il n’existe pas de garantie de prise en charge de toutes les boutiques existantes. Cette passerelle n’est pas une intégration native indépendante pour chaque boutique. Les connexions et les catalogues disponibles dépendent des connecteurs ; le nombre de jeux importés est affiché dans KaneMode.

Les achats chez les vendeurs de clés tels qu’Instant Gaming sont importés depuis la plateforme d’activation, une fois la clé activée. L’historique d’achats et l’achat de clés chez ces revendeurs ne sont pas intégrés par cette fonctionnalité.

## Architecture et vérification

`native/KaneMode.LibraryBridge` est une extension générique compilée contre PlayniteSDK 6.18.0 (MIT). Elle utilise les méthodes publiques `InstallGame`, `StartGame` et `OpenPluginSettings`. Le SDK est fourni par Playnite ; KaneMode ne redistribue pas une deuxième copie du SDK ni les plugins des boutiques.

La communication passe par un canal Windows limité au compte utilisateur courant et un jeton de session. Les comptes et mots de passe restent dans Playnite et ses connecteurs. KaneMode enregistre les fiches de bibliothèque ; il n’importe pas les cookies de connexion. Les commandes exposées ne permettent ni désinstallation ni exécution d’un chemin arbitraire envoyé par le client.

Vérifications : `node --test tools/verify-accounts.js` (5 000 jeux sans limite, fusion, persistance, refus et IPC Windows) et `dotnet run --project tools/library-bridge-tests/LibraryBridgeTests.csproj` (DLL et SDK réels, 1 200 jeux fictifs et actions simulées). Les essais d’interface couvrent les comptes, Installer/Jouer et 104 mises en page en français et en anglais. Les connexions aux comptes privés et les téléchargements réels des boutiques restent à valider avec leurs utilisateurs.

Sources : [SDK Playnite](https://github.com/JosefNemec/Playnite/tree/master/source/PlayniteSDK), [connecteurs de bibliothèques](https://github.com/JosefNemec/PlayniteExtensions/tree/master/source/Libraries).
