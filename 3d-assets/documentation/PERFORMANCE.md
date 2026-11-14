# Performances (mesures du 13/11/2026, PC de développement, application installée)

| Mesure | Valeur |
|---|---|
| Triangles par boîtier Switch | 6 012 |
| Matériaux | 9 (dont 4 remplacés par les jaquettes) |
| Taille GLB | ~170 Ko, sans image intégrée |
| Autres boîtiers (GC, Wii, PS2, PC, PS1) | 6 900 – 7 500 triangles, ~220–235 Ko |
| Boîtiers PSP / DS / 3DS | 5 300 – 5 800 triangles, ~155–175 Ko |
| Fiche de jeu (inspection : ouverture + carte, transmission réelle) | ~240 images/s |
| Étagère, niveau PC, lancement à froid — anciens boîtiers | 132 images/s |
| Étagère, niveau PC, lancement à froid — nouveaux boîtiers | 144 images/s |
| Étagère après 4 allers-retours étagère ↔ fiche | 134, 129, 135, 131 images/s (pas de fuite, 1 seul canevas) |
| Étagère, niveau Switch 2 posé | 184 images/s |
| Mémoire JS | ~31 Mo |

Une mesure isolée à 72 images/s a été relevée juste après plusieurs changements rapides
de niveau (génération de ~40 jaquettes en cours) ; non reproduite à froid ni après
allers-retours.

Choix :
- Une seule lecture du GLB par modèle (cache `useGLTF`), préchargé en temps mort.
- Copie légère par boîtier : géométries partagées, matériaux de plastique partagés par
  niveau de détail, matériaux d'illustration partagés par texture (cache existant d'iBox).
- Étagère (mode « lite ») : intérieur, carte, clips, pochette et envers de la jaquette
  masqués ; plastique sans passe de transmission. Fiche (inspection) : transmission réelle.
- Repli automatique sur le boîtier procédural si le GLB ne charge pas ;
  Paramètres › Apparence › « Boîtiers 3D détaillés » pour revenir aux anciens modèles.
