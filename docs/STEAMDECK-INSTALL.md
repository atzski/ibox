# Installer iBox sur Steam Deck

iBox pour Steam Deck est une AppImage : un seul fichier, rangé dans votre dossier personnel, sans
droits d'administrateur et sans toucher à SteamOS. Trois façons de l'installer, de la plus courte à
la plus manuelle. Tout se fait une fois, en **Mode Bureau** (bouton Steam › Alimentation › Passer
au bureau).

Le script d'installation est `scripts/install-steamdeck.sh` ; ce qu'il fait est décrit plus bas.

## 1. En deux gestes, sans clavier

1. Dans le navigateur du Mode Bureau, téléchargez
   [`Installer-iBox.desktop`](https://raw.githubusercontent.com/atzski/ibox/main/scripts/Installer-iBox.desktop)
   (clic droit › Enregistrer la cible du lien).
2. Ouvrez le fichier téléchargé (dossier Téléchargements) et acceptez de l'exécuter.

Une fenêtre de terminal s'ouvre, installe iBox, puis demande s'il faut l'ajouter à Steam : répondez
`o` (ou appuyez sur Entrée). À la fin, iBox est sur le bureau, dans le menu des applications et,
si vous l'avez demandé, dans votre bibliothèque Steam.

## 2. En une ligne, dans Konsole

```bash
curl -fsSL https://raw.githubusercontent.com/atzski/ibox/main/scripts/install-steamdeck.sh | bash
```

Pour lire le script avant de le lancer :

```bash
curl -fsSLO https://raw.githubusercontent.com/atzski/ibox/main/scripts/install-steamdeck.sh
less install-steamdeck.sh
bash install-steamdeck.sh
```

Options : `--steam` (ajoute à Steam sans demander), `--no-steam` (ne touche pas à Steam),
`--uninstall` (retire iBox et ses raccourcis, garde vos données).

## 3. À la main

1. Téléchargez `iBox_<version>_amd64.AppImage` sur la
   [page des versions](https://github.com/atzski/ibox/releases/latest) et rangez-le dans un dossier
   (par exemple `Applications`).
2. Clic droit › Propriétés › Permissions : cochez **Est exécutable**, puis ouvrez iBox.
3. Quittez Steam, puis dans iBox : Paramètres › Système › **Ajouter iBox à Steam**.

## Ce que fait le script

| Étape | Détail |
| --- | --- |
| Version | Lit `latest.json` de la dernière version publiée sur `github.com/atzski/ibox`, le fichier que lit aussi la mise à jour automatique d'iBox. Seule une AppImage hébergée parmi ces versions est acceptée. |
| Téléchargement | Dans `~/Applications`, sous un nom provisoire. |
| Vérification | Empreinte SHA-256 comparée à `SHA256SUMS.txt` de la même version. Si elle ne correspond pas, rien n'est installé et une installation existante n'est pas touchée. |
| Mise en place | `~/Applications/iBox.AppImage`, exécutable. Le nom est fixe : raccourcis et entrée Steam restent valables après chaque mise à jour, qu'iBox fait ensuite lui-même, sur place. |
| Raccourcis | Icône tirée de l'AppImage, entrée du menu des applications (`~/.local/share/applications/ibox.desktop`) et raccourci du bureau. |
| Steam | Sur demande, `steamos-add-to-steam` (l'outil de SteamOS derrière « Ajouter à Steam » du gestionnaire de fichiers) propose iBox à Steam comme jeu non-Steam. Steam doit être ouvert. Le script ne modifie aucun fichier de Steam. |

Le script n'écrit que dans votre dossier personnel, refuse de tourner en administrateur, et peut
être relancé à tout moment : il met iBox à jour ou répare l'installation.

## Le Mode Jeu

Une fois iBox dans Steam (catégorie « Non-Steam » de la bibliothèque), revenez en Mode Jeu et
lancez-le comme un jeu : il s'ouvre en plein écran, à la manette.

**Illustrations dans Steam.** L'outil de SteamOS ajoute le raccourci sans image. Pour la jaquette,
la bannière et le logo d'iBox : en Mode Bureau, quittez Steam (menu Steam › Quitter), puis dans
iBox : Paramètres › Système › **Ajouter iBox à Steam**. iBox complète alors le raccourci avec ses
illustrations.

## Fluidité : le mode performance

Sur un Steam Deck, iBox active de lui-même son **mode performance** (Paramètres › Apparence ›
Performances) : même interface, sans ce que l'écran et la puce du Deck rendent lentement (flous
d'arrière-plan, grandes ombres), avec une étagère 3D à la définition de l'écran, dessinée seulement
quand elle bouge. Le réglage a trois positions : Automatique, Activé, Désactivé. Il sert aussi aux
petits PC sous Windows.

Pour vérifier ce que donne votre appareil : Paramètres › Système › Diagnostic › **Afficher les
performances**.

## Mettre à jour, désinstaller

- **Mise à jour** : iBox propose chaque nouvelle version et l'installe lui-même (Paramètres ›
  Système). Relancer le script d'installation fait la même chose.
- **Désinstaller** : `bash install-steamdeck.sh --uninstall`, ou supprimez
  `~/Applications/iBox.AppImage`, le raccourci du bureau et `~/.local/share/applications/ibox.desktop`.
  Dans Steam : page d'iBox › Gérer › Retirer le jeu non-Steam. Vos données restent dans
  `~/.local/share/app.ibox.desktop` ; supprimez ce dossier pour tout effacer.

## En cas de souci

- **Écran noir en Mode Jeu** : dans Steam, page d'iBox › Propriétés › Options de lancement :
  `WEBKIT_DISABLE_COMPOSITING_MODE=1 %command%` (l'étagère 3D sera plus lente). Voir
  `docs/STEAMDECK.md` §5.3.
- **« Steam n'a pas répondu »** à la fin du script : Steam était fermé. Relancez le script avec
  `--steam` une fois Steam ouvert, ou passez par Paramètres › Système › Ajouter iBox à Steam.
- **Journal** : lancez iBox depuis Konsole (`~/Applications/iBox.AppImage 2>&1 | tee ~/ibox-journal.txt`)
  et joignez le fichier à votre message.
