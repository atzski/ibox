## iBox sur Steam Deck (en essai)

Première version d'iBox pour Steam Deck et Linux 64 bits, publiée à côté de la version Windows (qui ne change pas) : la même bibliothèque, pensée pour le Mode Jeu et la manette. Cette version est en essai : dites-nous ce qui marche et ce qui coince.

- **Mode Jeu** : une seule fenêtre en plein écran, les commandes du Deck, une interface à sa taille. Paramètres › Système › **Ajouter iBox à Steam** place iBox dans votre bibliothèque Steam, avec ses illustrations.
- **Vos jeux** : Steam, les jeux Epic, GOG et Amazon installés avec Heroic, et ceux de Lutris (installation classique ou Flatpak), chacun lancé par son lanceur.
- **iBox Platforms** : tous les émulateurs s'installent en un clic, comme sous Windows. En AppImage ou archive officielle (PPSSPP, DuckStation, PCSX2, Cemu, Azahar, Eden, Lichii, Fritchii, mGBA, RMG, RPCS3, xemu, Vita3K, Flycast, Mesen, Xenia Canary), ou depuis Flathub, la boutique du Deck (Dolphin, RetroArch et ses cœurs, melonDS, shadPS4, SameBoy, Stella, MAME). Ceux déjà installés avec Discover ou EmuDeck sont retrouvés.
- **SmartConfig** : les réglages par jeu trouvent la configuration Linux de chaque émulateur, Flatpak compris.
- **Remote Play** : rejoignez la partie d'un ami qui joue sur un PC iBox sous Windows (version 0.1.106 ou plus récente), avec la manette du Deck, ses pavés tactiles en souris et le clavier. L'image est décodée par le Deck lui-même (VA-API), avec un repli logiciel. Paramètres › Remote Play indique si ce Deck sait décoder l'image.
- **Rendu et batterie** : l'étagère 3D garde son rendu, avec un profil Steam Deck (60 images par seconde) et un profil Économie (30) choisis tout seuls selon l'alimentation (Paramètres › Apparence › Rendu 3D). À la sortie de veille, tout reprend aussitôt. Paramètres › Système › Diagnostic affiche les performances.
- **Sans bureau Windows** : pas de zone de notification ni de lancement avec Windows ; les notifications s'affichent dans iBox.
- **Licences** : le décodage vidéo utilise FFmpeg sous LGPL, sans aucun composant GPL. Textes, sources et note sur les brevets H.264 : `/usr/share/licenses/ibox` dans l'AppImage.

### Installer

1. En Mode Bureau, téléchargez **iBox_VERSION_amd64.AppImage** ci-dessous et rangez-le dans un dossier (par exemple `Applications`).
2. Clic droit › Propriétés › Permissions : cochez **Est exécutable**, puis ouvrez iBox.
3. Quittez Steam, puis Paramètres › Système › **Ajouter iBox à Steam**. En Mode Jeu, iBox vous attend dans votre bibliothèque.

Les mises à jour suivantes arrivent toutes seules, comme sous Windows.

### Encore réservé à Windows

Héberger une partie Remote Play (le Deck rejoint, il ne partage pas), l'overlay en jeu, et les boutiques sans version Linux : EA, Ubisoft, Xbox, Battle.net, Rockstar, Riot.
