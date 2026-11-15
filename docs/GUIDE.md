# Bien démarrer avec iBox

[← Page d’accueil](../README.md) · [Download iBox](https://github.com/atzski/inbox-releases/releases/latest)

Ce guide vous accompagne de l’installation à la configuration des services. **Les clés API sont facultatives** : elles ajoutent des fonctions, mais ne sont pas nécessaires pour commencer à utiliser iBox.

## 1. Installer iBox

1. Ouvrez la [dernière version](https://github.com/atzski/inbox-releases/releases/latest).
2. Dans **Assets**, téléchargez le fichier Windows qui se termine par `-setup.exe`.
3. Ouvrez le fichier et suivez l’installation, puis lancez iBox.
4. Suivez l’assistant : il vous aide à choisir vos dossiers de jeux et à configurer vos émulateurs.

Vos jeux restent dans leurs dossiers. iBox ne fournit pas de jeux, BIOS ou émulateurs : utilisez vos propres fichiers obtenus légalement et installez les logiciels nécessaires.

## 2. À quoi servent les clés ?

Une clé API est un code personnel qui permet à iBox d’utiliser un service avec votre compte. Vous pouvez renseigner les clés pendant l’assistant de configuration, ou le rouvrir plus tard dans **Paramètres → Système → Assistant de configuration**. Choisissez uniquement les services qui vous intéressent.

| Service | Utilité |
| --- | --- |
| Steam Web API | Ajouter les jeux Steam possédés, y compris ceux qui ne sont pas installés. |
| SteamGridDB | Trouver des jaquettes, logos et fonds. |
| iiDB | Récupérer des visuels pour consoles et jeux. |
| RetroAchievements | Afficher les succès rétro dans les fiches de jeux. |

**Gardez vos clés privées**, comme des mots de passe : ne les mettez pas dans une capture, un message ou une issue GitHub. Si vous en avez partagé une, révoquez-la ou régénérez-la sur le site concerné, puis remplacez-la dans iBox.

## 3. Créer vos clés

### Steam Web API

1. Connectez-vous à votre compte Steam, puis ouvrez la [page officielle de clé API Steam](https://steamcommunity.com/dev/apikey).
2. Si Steam demande un nom de domaine, indiquez `localhost`, acceptez les conditions et validez.
3. Copiez la clé affichée. Dans iBox, collez-la dans **Clé API Web Steam**, puis cliquez sur **Enregistrer**.
4. Pour que Steam puisse partager votre liste de jeux, ouvrez **Profil → Modifier le profil → Paramètres de confidentialité** dans Steam et réglez **Détails des jeux** sur **Public**. Ce réglage rend ces détails visibles publiquement : changez-le uniquement si vous le souhaitez.

Si Steam refuse de créer une clé, consultez les indications affichées sur sa page : les conditions du compte sont décidées par Steam.

### SteamGridDB

1. Ouvrez [SteamGridDB](https://www.steamgriddb.com/) et connectez-vous ou créez un compte.
2. Ouvrez [Preferences → API](https://www.steamgriddb.com/profile/preferences/api).
3. Cliquez sur **Generate API Key**, puis copiez la clé.
4. Dans iBox, collez-la dans **Clé SteamGridDB** et cliquez sur **Enregistrer**.

### iiDB

1. Connectez-vous ou créez un compte sur [iiSU Accounts](https://accounts.iisu.network/).
2. Dans votre profil, copiez votre **iiDB API key**. Les indications officielles se trouvent sur la [page de démarrage iiDB](https://iisu.network/wiki/iidb-developers/getting-started).
3. Dans iBox, collez-la dans **Clé API iiDB** et cliquez sur **Enregistrer**.

### RetroAchievements

1. Créez un compte ou connectez-vous sur [RetroAchievements](https://retroachievements.org/).
2. Ouvrez vos [paramètres](https://retroachievements.org/settings) et copiez la **Web API Key**. Ce n’est pas votre mot de passe.
3. Dans iBox, collez-la dans **Clé API RetroAchievements** et cliquez sur **Enregistrer**. Renseignez aussi votre nom d’utilisateur RetroAchievements dans les paramètres iBox si demandé.
4. Pour gagner des succès en jeu, configurez également RetroAchievements dans un émulateur compatible ; l’ajout de la clé à iBox ne configure pas votre émulateur.

## 4. En cas de problème

- **Clé refusée :** vérifiez que vous êtes connecté au bon compte, copiez toute la clé sans espace et réessayez.
- **Jeux Steam absents :** vérifiez le réglage public des détails des jeux, puis actualisez la bibliothèque.
- **Jaquette ou succès manquant :** le service ne possède pas forcément de résultat pour ce jeu ; vérifiez aussi son nom et la connexion au service.
- **Besoin d’aide :** ouvrez une [issue iBox](https://github.com/atzski/ibox/issues) avec votre version, les étapes suivies et le message d’erreur, sans envoyer vos clés ni vos données personnelles.

Les sites externes peuvent modifier leurs menus. Si une étape ne correspond plus, suivez les indications du service et signalez-le dans une issue.
