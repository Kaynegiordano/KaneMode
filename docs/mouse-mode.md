# Mode souris global à la manette

Dans l’application native KaneMode, maintenez **Start / Options pendant une seconde** pour activer le mode souris. Maintenez-le à nouveau pour couper le contrôle du curseur. La navigation à la manette reste disponible dans les deux cas ; un appui court sur Start conserve son action habituelle.

Dans KaneMode, le **stick gauche et les boutons** gardent leurs fonctions de navigation ; le **stick droit** déplace le curseur. Les boutons ne génèrent pas en plus un clic ou un défilement Windows, afin d’éviter les doubles actions. Le curseur déplace le focus sur l’élément survolé et A / Croix le valide.

Dans les autres fenêtres, les commandes souris sont les suivantes :

| Commande Xbox / PS4 | Action |
| --- | --- |
| Stick gauche ou droit | Déplacer le curseur |
| A / Croix | Clic gauche, maintenir pour glisser |
| Y / Triangle | Clic droit |
| B / Cercle | Retour (bouton « précédent » de la souris) |
| X / Carré maintenu + stick | Défilement vertical et horizontal, le curseur reste en place |
| Croix directionnelle | Défilement par crans |
| LB / L1 | Clic du milieu |
| RB / R1 | Avancer (bouton « suivant » de la souris) |

Le mode reste activé en changeant de fenêtre ou en ouvrant une boutique, une fenêtre de connexion, un jeu ou le streaming. KaneMode peut rester en arrière-plan ou être réduit ; il doit rester ouvert. L’activation n’intercepte pas le périphérique de manette pour les autres logiciels : un jeu peut continuer à lire ses propres entrées de manette.

La lecture native utilise XInput et les collections HID Xbox connues. Les DualShock 4 Sony d’origine (identifiants 054c:05c4 et 054c:09cc) disposent aussi d’une lecture directe de leurs rapports USB/Bluetooth, pour fonctionner sans dépendre du premier plan de WebView2. La dernière commande reçue choisit la source : une manette native connectée mais inactive ne bloque pas les axes de WebView2. Un état WebView2 figé en arrière-plan expire ; une remise au neutre réelle arrête également sa copie retardée. Les manettes compatibles utilisant un autre protocole ne sont pas automatiquement prises en charge par ce décodeur.

Le lecteur HID prend en compte tous les axes d’une plage, leur rapport et leur collection, ainsi que le signe des valeurs brutes. Un rapport sans axes conserve les dernières valeurs de stick. Références : [capacités HID](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/hidpi/ns-hidpi-_hidp_value_caps) et [lecture des valeurs HID](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/hidpi/nf-hidpi-hidp_getusagevalue).

Le curseur supplémentaire apparaît lorsque Windows cache le sien. Il reste transparent aux clics et ne prend pas le premier plan. Aucun second curseur n’est dessiné lorsque Windows affiche déjà le sien.

La veille et le verrouillage suspendent les entrées et relâchent les clics. Le choix du mode reste enregistré en mémoire jusqu’au retour ; un bouton encore tenu ne devient pas un nouveau clic. Quitter KaneMode désactive le traitement et ferme le curseur.

## Restrictions Windows

Certaines fenêtres lancées en administrateur et les écrans sécurisés (UAC, verrouillage) refusent les entrées d’une application ordinaire. KaneMode ne peut pas garantir leur contrôle avec ce mode souris ; les refus sont notés dans son journal, sans répétition permanente. Un clic refusé attend un nouvel appui, afin de ne pas cliquer dans la fenêtre suivante.

Un jeu qui capture la souris ou utilise un mode plein écran exclusif conserve ses règles de capture. Ce mode ne les remplace pas, et ne fonctionne pas après la fermeture de KaneMode.

Référence : [restrictions de SendInput — Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput). Format des rapports PS4 vérifié dans le [pilote SDL2 officiel](https://github.com/libsdl-org/SDL/blob/SDL2/src/joystick/hidapi/SDL_hidapi_ps4.c).

## Vérification

Dans **Paramètres → Manette → Diagnostic du curseur**, activez le mode souris et déplacez le stick droit. L’état distingue l’attente des axes, les mouvements acceptés par Windows, les refus et une suspension par le bureau Windows ou la veille. Les compteurs concernent les mouvements envoyés ; une acceptation Windows ne prouve pas qu’un jeu laisse son curseur se déplacer. Les changements d’état et la source retenue sont aussi notés dans `kanemode.log`.

Le banc `tools/mouse-mode-tests` compile les contrôleurs réels avec une injection de souris simulée : mouvements, glissé entre contextes de premier plan, boutons, molette, arrêt, verrouillage et refus. Il valide aussi les rapports PS4 USB/Bluetooth et les axes. Les essais Chromium vérifient le relais souris en arrière-plan sans validation de carte locale.

Ces bancs n’injectent pas d’entrées Windows réelles. Un banc séparé, `tools/mouse-platform-tests`, vérifie l’appel `Native.Mouse` réel avec un déplacement nul, sans clic ni touche, et contrôle que la position reste identique. Sur le PC de développement, le bureau interactif a été reconnu et Windows a accepté cet appel. Cela ne remplace pas la validation physique avec une ROG Ally ou une PS4 dans l’expérience Xbox.
