# Tester Remote Play avec un ami

Remote Play est **expérimental** : c'est un premier essai. Le jeu tourne sur le PC de l'**hôte** ;
l'**invité** voit l'image et, s'il est Joueur, joue avec sa manette. La connexion est directe
entre vos deux PC : les serveurs iNetbox ne servent qu'à se trouver, jamais à faire passer l'image.

## Avant de commencer (les deux)

1. Installez la même version publique d'iBox (Windows 10 2004 ou plus récent, Windows 11 conseillé).
2. Connectez-vous chacun à votre compte iNetbox et soyez **amis** (code ami).
3. Paramètres › **Remote Play** › activez **Activer Remote Play** (expérimental).
4. L'**invité** active aussi **Accepter les demandes Remote Play de mes amis** (sinon l'hôte reçoit
   « Cet ami n'accepte pas les demandes Remote Play »).
5. Facultatif : Paramètres › Remote Play › **Analyser**. La ligne « Connexion directe (UDP, STUN) »
   doit indiquer « Fonctionne ».
6. Restez en contact par téléphone ou par messagerie pendant l'essai (pour comparer le code).

## Étapes

1. **Hôte** : lancez le jeu depuis iBox (facultatif : sa fenêtre sera choisie d'office), puis ouvrez
   le profil de votre ami › **Inviter à jouer**.
2. La première fois, lisez l'avertissement : votre ami verra votre adresse IP publique (et vous la
   sienne). **J'ai compris**.
3. Choisissez les droits : **Spectateur** (regarde seulement) pour le premier essai, puis **Joueur**
   (manette). Choisissez ce qui est partagé (écran ou fenêtre du jeu), puis **Inviter**.
4. **Invité** : une notification « vous invite… (Remote Play) » apparaît en bas à droite (dans les
   10 secondes). Cliquez dessus › **Accepter** (avertissement IP la première fois). Vous avez
   2 minutes.
5. Si Windows demande d'autoriser iBox dans le pare-feu, acceptez (réseaux privés **et** publics
   si votre connexion est classée « publique »).
6. **Comparez le code de sécurité** (6 groupes de chiffres) à voix haute : il doit être identique
   sur les deux écrans. S'il diffère, arrêtez tout et prévenez-moi.
7. L'image apparaît chez l'invité. Joueur : **Envoyer mes commandes**, puis jouez avec la manette.
8. Pendant le partage, l'hôte voit un bandeau en haut de l'écran : nom de l'ami, type de connexion
   (« P2P Internet » attendu), **Arrêt d'urgence**, **Terminer**. Le raccourci
   Ctrl+Alt+Shift+F12 et le verrouillage de Windows (Windows+L) coupent aussi le partage.
9. Pour finir : **Terminer** (hôte) ou **Quitter** (invité).

## À noter pour le retour d'essai

- Type de connexion affiché (carte en bas à droite de l'hôte › « Statistiques » ; bouton
  « Statistiques » chez l'invité), images/s, débit, aller-retour, pertes.
- Délai entre « Accepter » et l'image ; latence ressentie (manette).
- Ce qui s'est passé à Windows+L chez l'hôte, et avec « Arrêt d'urgence ».
- Le message exact en cas d'échec (capture d'écran).

## Si la connexion échoue

| Message | Que faire |
|---|---|
| « Cet ami n'accepte pas les demandes Remote Play » | L'invité active le réglage (étape 4 du début), puis l'hôte réinvite. |
| « … n'a pas répondu à temps » / « a refusé l'invitation, ou elle a expiré » | Réinviter ; l'invitation ne vit que 2 minutes. |
| « aucun serveur STUN n'a répondu » | L'UDP sortant est bloqué (réseau d'entreprise, d'école, VPN) : essayez un autre réseau. |
| « NAT symétrique » | Le routeur empêche la connexion directe : essayez le partage de connexion d'un téléphone chez l'un des deux. |
| « le réseau ou le pare-feu de votre ami bloque probablement l'UDP » | Vérifiez le pare-feu Windows des deux côtés (iBox autorisé), désactivez un VPN, puis réessayez ; sinon un autre réseau. |
| « La clé de l'appareil de … a changé » | Normal seulement si l'ami a réinstallé iBox ou changé de PC : comparez le code de sécurité de vive voix avant de recommencer. |
| Image noire | Le contenu est protégé (vidéo DRM) ou la fenêtre est réduite : partagez l'écran plutôt que la fenêtre. |

## Limites connues

- Aucun relais (TURN) : certains réseaux (NAT symétrique des deux côtés, CGNAT strict, UDP bloqué)
  ne pourront pas se connecter. iBox le dit au lieu de passer en silence par un serveur.
- Pas encore de son. Un seul invité. Le Contrôle complet n'est pas disponible par Internet.
- Sur une fenêtre de jeu, seules les manettes sont transmises (jamais le clavier ni la souris).
- Les manettes de l'invité demandent le pilote ViGEmBus chez l'hôte (déjà installé : iBox ne
  l'installe jamais).
- Deux PC derrière la même box ne se connectent par leur adresse publique que si la box le permet ;
  sur le même réseau, la connexion locale est utilisée.
