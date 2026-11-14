# Spécifications — boîtiers Switch

| | Switch | Switch 2 |
|---|---|---|
| Extérieur | 105 × 170 × 11 mm | identique |
| Parois | 1,2 mm, coins 4 mm, arêtes biseautées 0,45 mm | identique |
| Plastique | transparent givré (SHELL, transmission) | rouge translucide |
| Carte | 21 × 31 × 3 mm, coin supérieur biseauté 2,2 mm, gris foncé | identique, rouge |
| Intérieur | 2 clips manuel (face avant), support 4 clips + cadre (plateau) | identique |
| Fichier | `exports/nintendo-switch/case.glb` | `exports/nintendo-switch-2/case.glb` |

Pièces : `Tray`, `Tray_Rim`, `Hinge`, `Front_Cover`, `Front_Lip`, `Manual_Clip_T/B`,
`Card_Pad`, `Card_Clip_L/R/T/B`, `Card_Body`, `Card_Label`, `Art_Front/Spine/Back`,
`Sleeve_Front/Spine/Back`.

Contrôles (blender-modeler `check_geometry`) : 0 erreur ; tous les éléments en contact
(aucune pièce flottante) ; dimensions conformes. Validation glTF : 0 erreur, 0 avertissement.

Support du jeu : seul le format « carte » est modélisé. Une Game-Key Card a la même
forme ; elle ne sera indiquée que si les métadonnées du jeu le précisent (jamais par défaut).
Version numérique : pas de support physique (évolution prévue des métadonnées).
