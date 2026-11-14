# iBox — bibliothèque 3D des boîtiers

Modèles physiques des boîtiers de jeux, créés pour iBox (originaux, sous la licence du
projet). **Un modèle maître par variante physique**, partagé par tous les jeux : les
jaquettes et étiquettes sont appliquées à l'exécution.

```
3d-assets/
  source/<console>/        model.py (source unique), spec.json, notes.md, *.blend
  exports/<console>/       case.glb (production) — copié dans public/models/cases/
  renders/<console>/       rendus de contrôle (les itérations iter_* ne sont pas versionnées)
  scripts/build/           build_case.py, modelkit.py (vendored, MIT)
  scripts/validate/        toolchain_check.py
  references/SOURCES.md    sources des mesures (aucune photo versionnée)
  documentation/           spécifications, matériaux, performances, licences
```

## Reconstruire un modèle

```powershell
  & "C:\Program Files\Blender Foundation\Blender 5.3\blender.exe" --background --factory-startup `
& $bl --background --factory-startup --python 3d-assets\scripts\build\build_case.py -- `
  --model 3d-assets\source\nintendo-switch\model.py --variant switch `
  --blend 3d-assets\source\nintendo-switch\switch-case.blend `
  --glb 3d-assets\exports\nintendo-switch\case.glb
npx gltf-transform validate 3d-assets\exports\nintendo-switch\case.glb
Copy-Item 3d-assets\exports\nintendo-switch\case.glb public\models\cases\switch.glb
```

Variante Switch 2 : même `model.py`, `--variant switch2`, sorties dans `nintendo-switch-2/`.

Boucle de modélisation (outil de création, non distribué) : skill
[blender-modeler](https://github.com/calebrisc/blender-modeler) installé dans
`.claude/skills/` (ignoré par Git), via
`python .claude/skills/blender-modeler/scripts/bmod.py --model … --spec … --out …`.
`IBOX_CASE_POSE=open` produit la pose ouverte pour les rendus de contrôle.

### Autres consoles (un seul générateur)

`source/keep-cases/model.py` construit les boîtiers GameCube, Wii, PS2, PC (format DVD),
PlayStation (boîtier CD), PSP (boîtier UMD), DS et 3DS (boîtiers à carte) : même
construction que le boîtier Switch, seuls la taille (celle de `caseSpecs.ts`), le
plastique et le support intérieur changent (moyeu + disque, UMD, carte + clips).

```powershell
foreach ($v in 'gamecube','wii','ps2','pc','ps1','psp','ds','3ds') {
  & "C:\Program Files\Blender Foundation\Blender 5.3\blender.exe" --background --factory-startup `
    --python 3d-assets\scripts\build\build_case.py -- --model 3d-assets\source\keep-cases\model.py `
    --variant $v --blend 3d-assets\source\keep-cases\$v-case.blend --glb 3d-assets\exports\$v\case.glb
  Copy-Item 3d-assets\exports\$v\case.glb public\models\cases\$v.glb
}
```

Matériaux supplémentaires : `DISC` (face gravée, métallique) et `DISC_ART` (face imprimée
du disque ou fenêtre de l'UMD, remplacée par l'image « disque » du jeu). Le pivot `Card`
porte aussi le disque : iBox le fait sortir du moyeu et tourner lentement.

## Outils de création (jamais requis par les utilisateurs d'iBox)

| Outil | Version | Rôle |
|---|---|---|
| Blender | 5.3.0 (winget `BlenderFoundation.Blender`) | modélisation, `.blend`, export GLB, rendus |
| uv | winget `astral-sh.uv` | prévu pour un éventuel serveur MCP (non installé) |
| blender-modeler | c8f2459 (MIT) | méthode spec → ébauche → mesures → rendus 8 vues |
| @gltf-transform/cli, gltf-validator | devDependencies | validation et inspection des GLB |

Non retenus : `reference-modeling` (exige un serveur MCP, installation POSIX),
`game-asset-modeling` (en-tête SKILL.md invalide, doublon des contrôles glTF),
Blender MCP (facultatif ; `bpy` en mode automatisé suffit).

## Ajouter une console

1. Créer `source/<console>/` avec `spec.json` (mesures réelles, sources dans
   `references/SOURCES.md`) et `model.py` (reprendre les conventions ci-dessous).
2. Respecter les noms : nœuds `Case` (racine), `Front` (pivot de charnière),
   `Card` ou `Disc` (support amovible) ; matériaux `ART_FRONT`, `ART_SPINE`,
   `ART_BACK`, `CARD_LABEL` (remplacés par iBox), `SHELL`, `SHELL_INNER`, `SLEEVE`.
3. Construire, valider, copier dans `public/models/cases/`.
4. Dans `src/three/cases/caseSpecs.ts`, ajouter `glb: "/models/cases/<fichier>.glb"`
   à la spécification de la console. Sans `glb`, le boîtier procédural est utilisé.

## Conventions du GLB

- Mètres, Y vers le haut, face avant vers +Z, boîtier posé sur y = 0, centré en X/Z.
- Ouverture : rotation Y négative du nœud `Front` (pivot = charnière côté tranche).
- Carte : nœud `Card` au centre de la carte ; sortie vers +Z puis +Y.
- UV des illustrations : V inversé dans Blender, pour que les textures canvas d'iBox
  (`flipY = true`) s'affichent à l'endroit après la conversion glTF.
- Aucune image intégrée (`export_image_format = NONE`).
