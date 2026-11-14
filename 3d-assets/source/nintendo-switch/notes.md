# Nintendo Switch case (1st gen) — modelling notes

## Brief
Master model for every Switch 1 game in iBox: one physical case, artwork applied at
runtime (front, spine, back, card label). Output: `.blend` source + `.glb` production
model with named parts and pivots for open/close and card extraction.

## Reference facts (see ../../references/SOURCES.md)
- Case outside: about 105 × 170 mm, 11–12 mm thick (replacement case listings; the
  brief's 105 × 170 × 11 mm is kept).
- Clear polypropylene clamshell, outer clear sleeve holding the paper insert.
- Inside: two clips hold the manual on the LEFT half (inside the front cover);
  a four-clip holder on the RIGHT half (inside the back tray) holds one card.
- Game card: 31 mm high × 21 mm wide × about 3 mm thick; one top corner angled.
- Switch 2 case: same size and interior layout; red plastic inside and out.

## Assumptions (to check against photos)
- Wall/panel thickness 1.2 mm; plan corner radius 4 mm.
- Card holder centre: 10 mm right of the tray centre, 42 mm above its middle
  (matches the layout already used by iBox's procedural case).
- Living hinge represented by a 0.6 mm-radius rib along the spine's front edge.

## Coordinates
Blender: Z up, front faces −Y, case standing on z = 0, centred on X.
glTF export: Y up, front +Z (exporter conversion). 1 Blender metre = 1000 mm.

## Parts and pivots
- `Case` (root empty)
  - `Tray`: back panel + spine + top/bottom/right walls (one boolean-cut shell)
  - `Hinge`: rib along the spine/front fold
  - `Art_Back`, `Art_Spine`, `Sleeve_Back`, `Sleeve_Spine`
  - `Card_Pad`, `Card_Clip_*`
  - `Front` (empty on the hinge axis x = −52.5, y = −5.5): `Front_Cover`, `Front_Lip`,
    `Manual_Clip_*`, `Art_Front`, `Sleeve_Front`. Open = rotate Z 0 → −180°.
  - `Card` (empty at the card centre): `Card_Body`, `Card_Label`. Out = move −Y then up.

## iter log
## iter_01
1. ERROR x3 (spec): dims given in world axes, the check uses object axes → spec fixed.
2. Manual/card clip hooks share side faces with their posts (zero-area faces) → hooks 0.4 mm narrower.
3. Closed views only show a slab: add an open review pose to judge the interior.


## iter_02 → iter_04
1. ✅ spec and clip faces fixed (0 errors).
2. Interior read as flat grey: real cases show the back of the paper insert through clear
   plastic → added Insert_Front/Back/Spine (INSERT_INNER, paper) facing inward. ✅
3. Plastic too opaque: transmission 0.55 → 0.85, roughness 0.34 → 0.22 (Switch 2: 0.5 / 0.24). ✅
4. Card label sat on a flat face: added Card_Rim, a 0.22 mm raised border around the recessed label. ✅
5. Card extraction travel 3 mm → 4.5 mm out + 2.8 mm up, scaled 1.35× for reading (iBox side). ✅
Open: exact holder position and clip shape to confirm on a physical case.
