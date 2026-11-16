# iNetbox — base de données et transfert réseau

État au 16/11/2026. Base : Neon, plan gratuit, projet `ibox`, Francfort.

## Ce qui consommait le transfert

Neon facture le **transfert sortant** : les octets que Postgres renvoie au serveur Render.
Le stockage fait 37 Mo, mais 4,82 Go étaient déjà sortis depuis le 13/11, soit environ **1,6 Go par jour**.

Cause principale : **chaque requête authentifiée relisait le compte entier** (`SELECT a.*`).
Ce compte contient la photo de profil (jusqu'à 48 Ko en base64), la bannière (jusqu'à 96 Ko) et trois jaquettes (jusqu'à 16 Ko chacune).
Or chaque iBox connectée fait un cycle toutes les 10 s (`src-tauri/src/inetbox.rs`, `start()` → `pulse()`) :

- `PUT /v1/presence`, au plus toutes les 20 s ;
- un instantané de 6 lectures : `/v1/me`, `/v1/friends`, `/v1/friend-requests`, `/v1/blocks`, `/v1/game-invites`, `/v1/messages`.

La liste d'amis renvoyait en plus la photo de chaque ami.
Une conversation ouverte interroge aussi le serveur toutes les 2,5 s, et payait elle aussi la relecture du compte à chaque appel.

## Mesure par route, avant et après

Mesure faite par `services/inetbox/test/transfer.test.ts` : octets des lignes renvoyées par Postgres pendant un cycle.
Cas mesuré : un profil complet (photo de 40 Ko, bannière de 80 Ko, trois jaquettes) et 5 amis au profil complet.

| Route (un cycle de 10 s) | Avant | Après |
|---|---:|---:|
| `PUT /v1/presence` | 157 Ko | 0,7 Ko |
| `GET /v1/me` | 157 Ko | 0,7 Ko |
| `GET /v1/friends` (5 amis) | 358 Ko | 1,7 Ko |
| `GET /v1/friend-requests` | 157 Ko | 0,7 Ko |
| `GET /v1/blocks` | 157 Ko | 0,7 Ko |
| `GET /v1/game-invites` | 157 Ko | 0,7 Ko |
| `GET /v1/messages` | 157 Ko | 0,7 Ko |
| **Total par cycle** | **1,30 Mo** | **5,7 Ko** (−99,6 %) |

Rapporté à une iBox de ce type connectée 8 h par jour (2 880 cycles) :

- avant : environ 3,7 Go par jour ;
- après : environ 16 Mo par jour.

Une conversation ouverte (un appel toutes les 2,5 s) passe d'environ 157 Ko à moins de 1 Ko par appel.

Les profils réels sont souvent plus légers que ce cas, ce qui explique les 1,6 Go par jour observés.

Ces routes coûtaient peu et restent telles quelles :

- `GET /v1/shares/:id/media` et `/thumb` : le serveur garde déjà un cache mémoire de 64 Mo et le client garde un cache disque. Chaque image ne sort donc de Neon qu'une fois par démarrage du serveur.
- `/health` : `SELECT 1`, quelques centaines d'octets.
- Remote Play : la signalisation reste en mémoire et n'utilise pas Neon.

## Corrections (serveur seulement, compatibles avec les iBox déjà installées)

1. **Authentification légère** (`src/context.ts`). Elle ne lit plus que les colonnes courtes du compte, avec l'empreinte `md5()` de chaque colonne lourde (32 octets, calculée par Postgres).
2. **Cache adressé par contenu** (`src/blobs.ts`). Les photos, bannières, jaquettes et succès mis en avant viennent d'un cache mémoire (32 Mo) indexé par leur empreinte. Ils ne sont relus en base que s'ils sont absents du cache. Un changement de photo change l'empreinte, donc le cache n'est jamais périmé, même avec plusieurs instances du serveur. Routes concernées : `/v1/me`, `/v1/friends`, `/v1/friend-requests`, `/v1/friends/:id/profile`, `/v1/activity`, `/v1/library/owners`, `/v1/shares` et ses commentaires.
3. **Connexions gardées 2 minutes** (`src/db.ts`, `idleTimeoutMillis`). Avant, la valeur par défaut était de 10 s, soit la même période que le cycle. Garder les connexions évite de refaire une poignée de main TLS (quelques Ko) à chaque cycle.

Les réponses envoyées aux clients sont identiques : le test le vérifie, y compris le changement de photo visible immédiatement.

## Remise à zéro de l'allocation Neon

Sur le plan gratuit, chaque projet a droit à 5 Go de transfert réseau public par mois. Cette allocation est remise à zéro au début de chaque période de facturation mensuelle.

Si elle est épuisée, **Neon suspend le calcul jusqu'à la période suivante** : iNetbox est alors coupé pour tous les utilisateurs.

L'écran « Usage » indique « Since Nov 13, 2026 », la date de création du projet. La remise à zéro devrait donc avoir lieu au **1er décembre 2026 (UTC)**, en supposant que la période suit le mois calendaire. À vérifier dans la console Neon (Billing / Usage).

Sources : [Neon plans](https://neon.com/docs/introduction/plans), [limites du plan gratuit](https://neon.com/faqs/free-plan-limits-and-quotas), [network transfer](https://neon.com/docs/introduction/network-transfer).

⚠️ Au rythme d'avant correction, environ 1,6 Go par jour, les 0,18 Go restants partent en quelques heures. Le correctif seul ne sauvera probablement pas le mois en cours.

**Une base suspendue ne peut plus être exportée avec `pg_dump`.** Si une bascule est envisagée, il faut faire l'export **avant** d'atteindre la limite. Le `pg_dump` lui-même compte dans le transfert : environ 40 Mo.

## Bascule Neon → Aiven (si nécessaire)

L'utilisateur gère lui-même les mots de passe : il les colle dans son terminal et dans Render, jamais dans un fichier du dépôt.

Il faut des outils clients PostgreSQL 18 (`pg_dump` et `pg_restore`), de la même version majeure que la base la plus récente ou d'une version supérieure.

1. **Exporter depuis Neon.** Utiliser l'URL de connexion directe, sans `-pooler` dans le nom d'hôte :
   ```bash
   pg_dump --format=custom --no-owner --no-privileges --file=inetbox.dump "$NEON_URL"
   ```
2. **Importer dans Aiven.** Utiliser la « Service URI » de la console Aiven, avec `sslmode=require` :
   ```bash
   pg_restore --no-owner --no-privileges --dbname="$AIVEN_URL" inetbox.dump
   ```
   Le serveur crée lui-même les tables manquantes au démarrage (`migrate`). La table `schema_migrations` est copiée avec le reste, donc aucune migration n'est rejouée.
3. **Vérifier** en comparant `SELECT count(*) FROM accounts;` (et `sessions`, `friendships`) des deux côtés.
4. **Changer `DATABASE_URL` dans Render** (service iNetbox → Environment) pour la valeur Aiven. Render redéploie le service.
5. **Contrôler** que `GET /health` répond `status: ok` et qu'une iBox se reconnecte. Les sessions sont copiées, donc personne n'a à se reconnecter.
6. **Garder Neon intact** quelques jours pour pouvoir revenir en arrière : il suffit de remettre l'ancienne `DATABASE_URL`.

Pour limiter les écritures perdues, faire l'export et le changement d'URL à la suite : les présences et les messages écrits entre les deux sont perdus.

### Risques du plan gratuit d'Aiven

- **Arrêt automatique en cas d'inactivité.** Le service s'éteint s'il n'est pas utilisé et doit être rallumé depuis la console. Les cycles de présence le maintiennent actif tant qu'une iBox est connectée, mais après une période creuse, iNetbox peut rester coupé jusqu'au rallumage manuel. Surveiller les e-mails d'Aiven.
- **20 connexions au plus.** Le pool du serveur en ouvre 8 au plus par instance (`src/db.ts`), donc pas plus de 2 instances Render en même temps, en comptant le chevauchement pendant un redéploiement.
- **1 Go de stockage.** Les partages de la Communauté (jusqu'à 8 Mo par clip, 12 par compte) sont le poste qui grossit. Aiven affiche déjà 12,3 % d'occupation, à surveiller.
- **1 CPU et 1 Go de RAM** (74 % de mémoire déjà utilisée à vide) : suffisant pour la charge actuelle, mais sans marge.
- **Version 18.** Le serveur ne dépend d'aucune extension, donc c'est compatible.
