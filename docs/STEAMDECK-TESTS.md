# Essais sur un vrai Steam Deck

Liste à dérouler sur un Steam Deck (LCD ou OLED, SteamOS à jour) avec la version d'essai publiée.
Chaque essai dit quoi faire et ce qu'on doit voir. Cocher, et noter tout écart dans la section
« Résultats » en bas, avec le modèle du Deck et la version de SteamOS.

Compter environ deux heures pour l'ensemble. Les sections 1 à 3 suffisent pour un premier avis.

## 0. Préparation

- [ ] Paramètres Steam › Système : noter la version de SteamOS et le modèle (LCD ou OLED).
- [ ] Mode Bureau : installer iBox par le script (`docs/STEAMDECK-INSTALL.md`, section 1 ou 2), ou à
  la main : télécharger l'`.AppImage` depuis la dernière version sur GitHub, puis clic droit ›
  Propriétés › Permissions : « Est exécutable ».
- [ ] Pour garder un journal, lancer une fois depuis Konsole :
  `./iBox_*.AppImage 2>&1 | tee ~/ibox-journal.txt`
  Le journal est à joindre à tout problème.
- [ ] Dans iBox : Paramètres › Système › Diagnostic › **Afficher les performances** (le panneau
  reste en haut à droite pendant tous les essais).

## 0 bis. Installation par le script

Le script (`scripts/install-steamdeck.sh`) a été essayé sous Ubuntu contre un faux serveur de
versions, jamais sur SteamOS. À vérifier sur l'appareil :

- [ ] `Installer-iBox.desktop` téléchargé puis ouvert depuis Dolphin : KDE propose de l'exécuter,
  un terminal s'ouvre et l'installation va au bout.
- [ ] La ligne `curl … | bash` dans Konsole : même résultat, la question sur Steam s'affiche et
  attend la réponse.
- [ ] `~/Applications/iBox.AppImage` existe ; l'icône du bureau et l'entrée du menu (catégorie
  Jeux) portent le logo d'iBox et ouvrent iBox d'un double-clic, sans question de KDE.
- [ ] Réponse `o` avec Steam ouvert : iBox apparaît dans la bibliothèque Steam (Non-Steam). Noter
  le nom affiché (attendu : « iBox ») et s'il se lance en Mode Jeu.
- [ ] Steam fermé, puis Paramètres › Système › **Ajouter iBox à Steam** : les illustrations se
  posent sur le raccourci créé par le script, **sans doublon**. S'il y a deux « iBox » dans Steam,
  ou pas d'illustrations, relever dans `~/.steam/steam/userdata/<compte>/config/shortcuts.vdf` les
  champs `AppName` et `Exe` du raccourci créé par SteamOS.
- [ ] Relancer le script : il met à jour sans rien casser (raccourcis et entrée Steam intacts).
- [ ] `bash install-steamdeck.sh --uninstall` : AppImage et raccourcis retirés, données gardées.

## 1. Démarrage et Mode Jeu

- [ ] Mode Bureau : iBox s'ouvre en moins de 10 s, sans fenêtre d'erreur.
- [ ] Quitter Steam, puis Paramètres › Système › **Ajouter iBox à Steam**. Message de réussite.
  Steam ouvert : iBox doit refuser et expliquer pourquoi.
- [ ] Passer en Mode Jeu : iBox est dans la bibliothèque, avec ses illustrations (jaquette,
  bannière, logo, fond) dans la langue de Steam.
- [ ] Lancer iBox en Mode Jeu : une seule fenêtre, plein écran, 1280×800, sans bordure ni barre.
- [ ] Les notifications d'iBox apparaissent dans la fenêtre principale, pas en fenêtres à part.
- [ ] Bouton Steam › Quitter le jeu : iBox se ferme proprement ; le relancer ne montre pas
  d'erreur.
- [ ] Clavier virtuel (Steam + X) dans un champ de recherche : la saisie arrive dans iBox.

## 2. Manette et navigation

- [ ] Croix directionnelle et stick gauche : déplacement sur l'accueil, l'étagère, les menus.
- [ ] A valide, B revient, menus et onglets avec les gâchettes hautes comme sous Windows.
- [ ] Les icônes de boutons affichées correspondent à celles du Deck.
- [ ] Pavé tactile droit : le pointeur se déplace, un appui clique.
- [ ] Écran tactile : défilement et appui sur une carte.
- [ ] Aucune action ne déclenche deux fois (Steam Input et iBox en même temps). Si oui, noter la
  disposition Steam Input utilisée.

## 3. Étagère 3D, profils graphiques et fluidité

Paramètres › Apparence › Rendu 3D. Pour chaque profil, parcourir l'étagère 30 s et relever
le panneau des performances.

| Profil | Attendu | Images/s | Pire temps | Processeur iBox | GPU |
| --- | --- | --- | --- | --- | --- |
| Automatique (secteur) | devient Steam Deck | | | | |
| Steam Deck | 60 im/s stables | | | | |
| Économie | 30 im/s stables | | | | |
| Qualité | plus net, peut ralentir | | | | |

- [ ] Débrancher le chargeur avec le profil Automatique : passage en Économie en quelques
  secondes ; rebrancher : retour au profil Steam Deck.
- [ ] Aucune saccade visible en ouvrant une jaquette ou en changeant de collection.
- [ ] Ventilateur : noter s'il s'emballe sur l'accueil immobile (il ne devrait pas).

### Mode performance (Paramètres › Apparence › Performances)

Sur le Deck, « Automatique » doit l'activer tout seul (la note sous le réglage le dit). Relever le
panneau des performances dans les deux positions, 30 s par écran, sans toucher à rien puis en
naviguant.

| Écran | Mode performance | Images/s | Pire temps | Processeur iBox | GPU |
| --- | --- | --- | --- | --- | --- |
| Accueil | Activé | | | | |
| Accueil | Désactivé | | | | |
| Étagère 3D (profil Steam Deck) | Activé | | | | |
| Étagère 3D (profil Steam Deck) | Désactivé | | | | |
| Paramètres, en défilant | Activé | | | | |
| Paramètres, en défilant | Désactivé | | | | |
| Fiche d'un jeu | Activé | | | | |
| Fiche d'un jeu | Désactivé | | | | |

- [ ] Activé : l'interface reste celle d'iBox (mêmes couleurs, mêmes formes, mêmes mouvements).
  Noter tout ce qui paraît abîmé : texte moins lisible sur un panneau, halo trop dur, bord de
  l'étagère de l'accueil coupé net.
- [ ] Activé, étagère 3D immobile depuis 5 s : le GPU retombe (plus aucune image dessinée) ; au
  premier appui sur la croix, l'étagère repart sans retard ni à-coup.
- [ ] Activé, étagère 3D : une jaquette qui finit de se charger apparaît bien d'elle-même, sans
  qu'il faille bouger (sinon l'étagère est restée figée à tort).
- [ ] Anneau de focus : immobile en mode performance, il respire sinon.
- [ ] Lancer un jeu depuis iBox en Mode Jeu, y jouer 2 min, puis revenir à iBox par le bouton
  Steam : pendant le jeu, le processeur d'iBox doit rester proche de zéro (interface en veille) ;
  au retour, l'interface doit repartir aussitôt. **Si elle reste figée**, noter comment on est
  revenu (bouton Steam, fermeture du jeu) : c'est que le focus n'a pas été rendu à iBox.
- [ ] Console portable sous SteamOS autre que le Deck (si disponible) : le mode performance
  s'active aussi tout seul (iBox lancé depuis Steam, qui pose `SteamDeck=1`).

## 4. Bibliothèque

- [ ] Jeux Steam installés : présents, avec jaquettes ; un jeu se lance et iBox revient à la
  fermeture.
- [ ] Heroic (Flathub) avec un jeu Epic ou GOG installé : présent et lançable depuis iBox.
- [ ] Lutris avec un jeu : présent et lançable. Les jeux Steam de Lutris ne sont pas en double.
- [ ] Ajouter un dossier de ROM sur la carte microSD (`/run/media/...`) : les jeux apparaissent.
- [ ] Redémarrer le Deck : la bibliothèque est intacte.

## 5. Émulateurs

À faire **depuis le Mode Jeu** (c'est le cas difficile), avec une connexion Wi-Fi.

- [ ] Installer un émulateur depuis Flathub (par exemple DuckStation) : progression visible,
  installation terminée sans passer par le Mode Bureau.
- [ ] Installer un émulateur depuis sa version officielle (AppImage ou archive) : il se lance.
- [ ] RetroArch : un cœur s'installe et un jeu le lance.
- [ ] SmartConfig : lancer un jeu PS1, PS2 ou GameCube ; la configuration est appliquée
  (plein écran, manette reconnue sans réglage).
- [ ] Quitter le jeu (menu de l'émulateur ou bouton Steam) : retour dans iBox.
- [ ] Désinstaller un émulateur depuis iBox : il disparaît aussi de la liste Flathub.

## 6. Remote Play (invité)

Il faut un PC Windows avec iBox à jour qui héberge une partie, de préférence sur le même réseau
puis sur un autre réseau (partage de connexion du téléphone par exemple).

**Décodage matériel (VA-API)**
- [ ] Mode Bureau, Konsole : `ls /dev/dri/renderD*` et `ls /usr/lib/dri/*_drv_video.so` donnent
  chacun au moins un fichier.
- [ ] Lancer iBox depuis Konsole avec `GST_DEBUG=vah264dec:4 ./iBox_*.AppImage` et rejoindre une
  partie : le journal mentionne `vah264dec`. Sinon, le décodage est logiciel : le noter.
- [ ] Pendant la partie, Processeur iBox dans le panneau : noter la valeur (faible avec VA-API,
  nettement plus haute en logiciel).

**Session**
- [ ] Rejoindre par le code d'invitation : image en moins de 5 s.
- [ ] Panneau des performances : relever ping, RTT, décodage, images/s, débit.
- [ ] Commandes : boutons, sticks et gâchettes répondent sans retard perceptible.
- [ ] Pavés tactiles et clavier virtuel transmis à l'hôte.
- [ ] Son présent, synchronisé avec l'image.
- [ ] Couper le Wi-Fi 10 s puis le rétablir : la session reprend ou se termine proprement.
- [ ] Quitter la partie : retour dans iBox, l'hôte voit le départ.

| Réseau | Ping | RTT | Décodage | Images/s | Débit | Ressenti |
| --- | --- | --- | --- | --- | --- | --- |
| Même réseau | | | | | | |
| Autre réseau | | | | | | |

## 7. Batterie et veille

- [ ] Accueil immobile, écran à 50 %, profil Automatique : noter la batterie perdue en 15 min.
- [ ] Même mesure pendant une partie Remote Play de 15 min.
- [ ] Mettre en veille (bouton d'alimentation) sur l'accueil, réveiller après 2 min : l'étagère
  reprend, pas d'écran noir, la manette répond.
- [ ] Veille pendant une session Remote Play : au réveil, la session reprend ou propose de
  rejoindre à nouveau.

## 8. Mises à jour

- [ ] Quand une version plus récente est publiée : iBox la propose, l'installe et redémarre sur
  la nouvelle version, en Mode Jeu comme en Mode Bureau.
- [ ] Le raccourci Steam fonctionne toujours après la mise à jour (même fichier AppImage).

## 9. Licences

- [ ] Paramètres › Système › À propos › Mentions légales : section « Version Steam Deck (Linux) » présente.
- [ ] Les textes livrés sont lisibles dans l'AppImage (`./iBox_*.AppImage --appimage-extract`,
  dossier `squashfs-root/usr/share/licenses/ibox`).

## Résultats

Modèle et SteamOS :
Version d'iBox :
Date :

| Section | Réussi | Problèmes (avec extrait du journal) |
| --- | --- | --- |
| 1. Démarrage et Mode Jeu | | |
| 2. Manette | | |
| 3. Étagère et profils | | |
| 4. Bibliothèque | | |
| 5. Émulateurs | | |
| 6. Remote Play | | |
| 7. Batterie et veille | | |
| 8. Mises à jour | | |
| 9. Licences | | |
