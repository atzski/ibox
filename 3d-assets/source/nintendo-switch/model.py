"""Nintendo Switch game case (1st generation), iBox master model.

Single source of truth: run through blender-modeler's bmod.py (headless) or
3d-assets/scripts/build/build_case.py. Sizes in millimetres (MM), Blender works
in metres. Z up, front faces -Y, case standing on z = 0.

Artwork is NOT part of the model: Art_* and Card_Label carry neutral materials
(ART_FRONT, ART_SPINE, ART_BACK, CARD_LABEL) that iBox replaces at runtime.
"""
import math
import os

import bmesh
import bpy
from mathutils import Vector

import modelkit as mk

# ------------------------------------------------------------------ parameters
VARIANT = os.environ.get("IBOX_CASE_VARIANT", "switch")  # "switch" | "switch2"
MM = 0.001
W, H, D = 105.0, 170.0, 11.0  # outside of the plastic case
T = 1.2  # wall / panel thickness
R = 4.0  # corner radius seen from the front
ART_OFF = 0.12  # paper insert above the plastic
SLEEVE_OFF = 0.35  # clear outer sleeve above the plastic
CARD_W, CARD_H, CARD_T = 21.0, 31.0, 3.0
CARD_CX, CARD_CZ = 10.0, H / 2 + 42.0  # holder centre on the tray
CARD_CHAMFER = 2.2  # the angled top corner of a game card
LIP_INSET, LIP_T, LIP_H = 1.45, 0.8, 1.2  # closing lip under the front cover

PALETTE = {
    # linear RGB; Switch 1: frosted clear polypropylene, Switch 2: translucent red
    "switch": {"shell": (0.86, 0.88, 0.91), "transmission": 0.85, "rough": 0.22, "card": (0.035, 0.036, 0.04)},
    "switch2": {"shell": (0.62, 0.035, 0.045), "transmission": 0.5, "rough": 0.24, "card": (0.42, 0.03, 0.035)},
}[VARIANT]

FRONT_Y = -D / 2  # outer face of the front cover
BACK_Y = D / 2  # outer face of the back panel


def m(v):
    return v * MM


def rounded_rect(w, h, r, cx=0.0, cz=0.0, seg=8):
    """Counter-clockwise outline (x, z) of a rounded rectangle, in mm."""
    pts = []
    corners = [(cx + w / 2 - r, cz + h / 2 - r, 0), (cx - w / 2 + r, cz + h / 2 - r, 90),
               (cx - w / 2 + r, cz - h / 2 + r, 180), (cx + w / 2 - r, cz - h / 2 + r, 270)]
    for x0, z0, a0 in corners:
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((x0 + r * math.cos(a), z0 + r * math.sin(a)))
    return pts


def slab(name, outline, y_front, y_back, coll=None):
    """Extrude an (x, z) outline between two y planes (mm)."""
    pts = [(m(x), m(z)) for x, z in outline]
    # rotation X +90°: local (x, y) -> world (x, z); local +Z -> world -Y
    return mk.extrude_profile(name, pts, m(y_back - y_front), location=(0, m(y_back), 0),
                              rotation=(90, 0, 0), coll=coll)


def cut(target, cutter):
    mk.boolean(target, cutter)
    mk.apply_modifiers(target)
    bpy.data.objects.remove(cutter, do_unlink=True)
    return target


def flat_face(name, outline, plane, coord, normal, uv_of, coll=None):
    """One flat n-gon in a world plane with UVs in [0, 1]; normal is the outward axis."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    verts = []
    for a, b in outline:
        if plane == "XZ":
            co = (m(a), m(coord), m(b))
        else:  # "YZ"
            co = (m(coord), m(a), m(b))
        verts.append(bm.verts.new(co))
    face = bm.faces.new(verts)
    bm.normal_update()
    if face.normal.dot(Vector(normal)) < 0:
        face.normal_flip()
    for loop in face.loops:
        x, y, z = (c / MM for c in loop.vert.co)
        u, v = uv_of(x, y, z)
        # V inverted on purpose: the glTF exporter flips V, and iBox's canvas
        # textures use flipY = true, so the artwork lands upright in the app.
        loop[uv].uv = (u, 1.0 - v)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    return mk._link(obj, coll)


def mat(name, color, rough, transmission=0.0, alpha=1.0, ior=1.49):
    mt = bpy.data.materials.new(name)
    mt.use_nodes = True
    b = mt.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["IOR"].default_value = ior
    b.inputs["Transmission Weight"].default_value = transmission
    b.inputs["Alpha"].default_value = alpha
    if alpha < 1.0:
        mt.surface_render_method = "BLENDED"
    return mt


def demo_art(name, w, h, top, bottom):
    """Original, licence-free demo artwork (pastel gradient) for review renders."""
    img = bpy.data.images.new(name, w, h)
    px = []
    for j in range(h):
        t = j / max(1, h - 1)
        c = [bottom[k] + (top[k] - bottom[k]) * t for k in range(3)]
        px.extend([c[0], c[1], c[2], 1.0] * w)
    img.pixels = px
    return img


def art_mat(name, img=None):
    mt = mat(name, (0.92, 0.92, 0.92), 0.45)
    if img is not None:
        nt = mt.node_tree
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    return mt


def parent(child, par):
    mw = child.matrix_world.copy()
    child.parent = par
    child.matrix_world = mw


# ------------------------------------------------------------------ materials
shell = mat("SHELL", PALETTE["shell"], PALETTE["rough"], transmission=PALETTE["transmission"])
inner = mat("SHELL_INNER", PALETTE["shell"], PALETTE["rough"] + 0.1, transmission=PALETTE["transmission"] * 0.8)
sleeve = mat("SLEEVE", (0.95, 0.96, 0.97), 0.06, alpha=0.10)
# back of the paper insert, seen from inside through the clear plastic
insert_inner = mat("INSERT_INNER", (0.80, 0.80, 0.78), 0.88)
card_mat = mat("CARD", PALETTE["card"], 0.42)
art_front = art_mat("ART_FRONT", demo_art("demo_front", 64, 96, (0.98, 0.86, 0.80), (0.72, 0.84, 0.96)))
art_back = art_mat("ART_BACK", demo_art("demo_back", 64, 96, (0.93, 0.93, 0.95), (0.85, 0.87, 0.92)))
art_spine = art_mat("ART_SPINE", demo_art("demo_spine", 8, 96, (0.98, 0.86, 0.80), (0.72, 0.84, 0.96)))
label_mat = art_mat("CARD_LABEL", demo_art("demo_label", 32, 32, (0.98, 0.92, 0.75), (0.80, 0.90, 0.98)))

root = bpy.data.objects.new("Case", None)
mk._link(root, None)

# ------------------------------------------------------------------ tray (back half)
outer = rounded_rect(W, H, R, cz=H / 2)
inner_outline = rounded_rect(W - 2 * T, H - 2 * T, R - T * 0.6, cz=H / 2)
tray = slab("Tray", outer, FRONT_Y + T, BACK_Y)
cavity = slab("tray_cavity", inner_outline, FRONT_Y, BACK_Y - T)
cut(tray, cavity)
mk.finish(tray, bevel=m(0.45), segments=2)
mk.assign(tray, shell)

# raised moulded rim around the inside of the back panel (adds the real "tray" read)
rim = slab("tray_rim_tmp", rounded_rect(W - 2 * T - 0.1, H - 2 * T - 0.1, R - 0.8, cz=H / 2), BACK_Y - T - 0.9, BACK_Y - T + 0.05)
rim_hole = slab("tray_rim_hole", rounded_rect(W - 2 * T - 4.0, H - 2 * T - 4.0, R - 1.5, cz=H / 2), BACK_Y - T - 2, BACK_Y)
cut(rim, rim_hole)
rim.name = "Tray_Rim"
mk.finish(rim, bevel=m(0.25), segments=2)
mk.assign(rim, inner)

# ------------------------------------------------------------------ front cover (hinged)
front_cover = slab("Front_Cover", outer, FRONT_Y, FRONT_Y + T)
mk.finish(front_cover, bevel=m(0.45), segments=2)
mk.assign(front_cover, shell)
lip = slab("Front_Lip", rounded_rect(W - 2 * LIP_INSET, H - 2 * LIP_INSET, R - 1.2, cz=H / 2),
           FRONT_Y + T - 0.05, FRONT_Y + T + LIP_H)
lip_hole = slab("lip_hole", rounded_rect(W - 2 * (LIP_INSET + LIP_T), H - 2 * (LIP_INSET + LIP_T), R - 1.6, cz=H / 2),
                FRONT_Y, FRONT_Y + T + LIP_H + 1)
cut(lip, lip_hole)
mk.finish(lip, bevel=m(0.2), segments=2)
mk.assign(lip, inner)

# living hinge: rib along the fold between the spine and the front cover
hinge = mk.cylinder("Hinge", m(0.65), m(H - 2 * R), location=(m(-W / 2 + 0.35), m(FRONT_Y + T), m(H / 2)), segments=16)
mk.finish(hinge, bevel=0)
mk.assign(hinge, shell)

# manual clips (inside the front cover, top and bottom of its centre line)
manual_clips = []
for tag, zc, sign in (("T", H - 9.0, -1), ("B", 9.0, 1)):
    base = mk.box(f"Manual_Clip_{tag}", (m(14), m(2.4), m(3.2)), location=(0, m(FRONT_Y + T + 1.15), m(zc)))
    hook = mk.box("hook_tmp", (m(13.4), m(0.9), m(1.6)), location=(0, m(FRONT_Y + T + 2.1), m(zc + sign * 1.9)))
    mk.boolean(base, hook, operation="UNION")
    mk.apply_modifiers(base)
    bpy.data.objects.remove(hook, do_unlink=True)
    mk.finish(base, bevel=m(0.3), segments=2)
    mk.assign(base, inner)
    manual_clips.append(base)

# ------------------------------------------------------------------ card holder (inside the tray)
panel_in = BACK_Y - T  # inner face of the back panel
pad = slab("Card_Pad", rounded_rect(CARD_W + 7, CARD_H + 7, 2.5, cx=CARD_CX, cz=CARD_CZ), panel_in - 0.8, panel_in + 0.05)
pad_hole = slab("pad_hole", rounded_rect(CARD_W + 0.6, CARD_H + 0.6, 1.0, cx=CARD_CX, cz=CARD_CZ), panel_in - 2, panel_in + 1)
cut(pad, pad_hole)
mk.finish(pad, bevel=m(0.25), segments=2)
mk.assign(pad, inner)

clips = []
clip_specs = [
    ("L", (CARD_CX - CARD_W / 2 - 0.9, CARD_CZ), (1.8, 7.0), (-1, 0)),
    ("R", (CARD_CX + CARD_W / 2 + 0.9, CARD_CZ), (1.8, 7.0), (1, 0)),
    ("T", (CARD_CX, CARD_CZ + CARD_H / 2 + 0.9), (7.0, 1.8), (0, 1)),
    ("B", (CARD_CX, CARD_CZ - CARD_H / 2 - 0.9), (7.0, 1.8), (0, -1)),
]
for tag, (cx, cz), (sx, sz), (dx, dz) in clip_specs:
    post = mk.box(f"Card_Clip_{tag}", (m(sx), m(CARD_T + 0.9), m(sz)), location=(m(cx), m(panel_in - (CARD_T + 0.9) / 2 + 0.05), m(cz)))
    # small hook that laps 0.6 mm over the card face
    hk = mk.box("clip_hook", (m(sx - 0.4 if dx == 0 else 2.4), m(0.7), m(sz - 0.4 if dz == 0 else 2.4)),
                location=(m(cx - dx * 0.6), m(panel_in - CARD_T - 0.45), m(cz - dz * 0.6)))
    mk.boolean(post, hk, operation="UNION")
    mk.apply_modifiers(post)
    bpy.data.objects.remove(hk, do_unlink=True)
    mk.finish(post, bevel=m(0.25), segments=2)
    mk.assign(post, inner)
    clips.append(post)

# ------------------------------------------------------------------ game card
card_outline = [
    (CARD_CX - CARD_W / 2, CARD_CZ - CARD_H / 2),
    (CARD_CX + CARD_W / 2, CARD_CZ - CARD_H / 2),
    (CARD_CX + CARD_W / 2, CARD_CZ + CARD_H / 2 - CARD_CHAMFER),
    (CARD_CX + CARD_W / 2 - CARD_CHAMFER, CARD_CZ + CARD_H / 2),
    (CARD_CX - CARD_W / 2, CARD_CZ + CARD_H / 2),
]
card = slab("Card_Body", card_outline, panel_in - CARD_T, panel_in)
mk.finish(card, bevel=m(0.35), segments=2, angle=40)
mk.assign(card, card_mat)
lab_w = CARD_W - 3.2
lab_h = lab_w / 0.83  # same aspect as iBox's card-label canvas (no stretching)
lab_cz = CARD_CZ - CARD_H / 2 + 1.6 + lab_h / 2
card_label = flat_face(
    "Card_Label", rounded_rect(lab_w, lab_h, 0.8, cx=CARD_CX, cz=lab_cz, seg=3), "XZ",
    panel_in - CARD_T - 0.05, (0, -1, 0),
    lambda x, y, z: ((x - (CARD_CX - lab_w / 2)) / lab_w, (z - (lab_cz - lab_h / 2)) / lab_h))
mk.assign(card_label, label_mat)
# raised border around the recessed label (moulded in the card)
card_rim = slab("Card_Rim", rounded_rect(lab_w + 1.2, lab_h + 1.2, 1.2, cx=CARD_CX, cz=lab_cz, seg=3),
                panel_in - CARD_T - 0.22, panel_in - CARD_T + 0.05)
rim_cut = slab("card_rim_hole", rounded_rect(lab_w + 0.1, lab_h + 0.1, 0.85, cx=CARD_CX, cz=lab_cz, seg=3),
               panel_in - CARD_T - 1, panel_in - CARD_T + 1)
cut(card_rim, rim_cut)
mk.finish(card_rim, bevel=m(0.08), segments=1)
mk.assign(card_rim, card_mat)

# ------------------------------------------------------------------ artwork + clear sleeve
art_outline = rounded_rect(W - 0.8, H - 0.8, R - 0.4, cz=H / 2)
art_f = flat_face("Art_Front", art_outline, "XZ", FRONT_Y - ART_OFF, (0, -1, 0),
                  lambda x, y, z: ((x + W / 2) / W, z / H))
art_b = flat_face("Art_Back", art_outline, "XZ", BACK_Y + ART_OFF, (0, 1, 0),
                  lambda x, y, z: ((W / 2 - x) / W, z / H))
spine_outline = [(-D / 2 + 0.6, 2.5), (D / 2 - 0.6, 2.5), (D / 2 - 0.6, H - 2.5), (-D / 2 + 0.6, H - 2.5)]
art_s = flat_face("Art_Spine", spine_outline, "YZ", -W / 2 - ART_OFF, (-1, 0, 0),
                  lambda x, y, z: ((D / 2 - y) / D, z / H))
for o, mt in ((art_f, art_front), (art_b, art_back), (art_s, art_spine)):
    mk.assign(o, mt)

sl_outline = rounded_rect(W - 0.2, H - 0.2, R - 0.1, cz=H / 2)
sleeve_f = flat_face("Sleeve_Front", sl_outline, "XZ", FRONT_Y - SLEEVE_OFF, (0, -1, 0), lambda x, y, z: ((x + W / 2) / W, z / H))
sleeve_b = flat_face("Sleeve_Back", sl_outline, "XZ", BACK_Y + SLEEVE_OFF, (0, 1, 0), lambda x, y, z: ((W / 2 - x) / W, z / H))
sleeve_s = flat_face("Sleeve_Spine", [(-D / 2 + 0.3, 1.5), (D / 2 - 0.3, 1.5), (D / 2 - 0.3, H - 1.5), (-D / 2 + 0.3, H - 1.5)],
                     "YZ", -W / 2 - SLEEVE_OFF, (-1, 0, 0), lambda x, y, z: ((D / 2 - y) / D, z / H))
for o in (sleeve_f, sleeve_b, sleeve_s):
    mk.assign(o, sleeve)

# inside faces of the insert (facing into the case), just under the art planes
ins_f = flat_face("Insert_Front", art_outline, "XZ", FRONT_Y - ART_OFF + 0.02, (0, 1, 0), lambda x, y, z: ((x + W / 2) / W, z / H))
ins_b = flat_face("Insert_Back", art_outline, "XZ", BACK_Y + ART_OFF - 0.02, (0, -1, 0), lambda x, y, z: ((W / 2 - x) / W, z / H))
ins_s = flat_face("Insert_Spine", spine_outline, "YZ", -W / 2 - ART_OFF + 0.02, (1, 0, 0), lambda x, y, z: ((D / 2 - y) / D, z / H))
for o in (ins_f, ins_b, ins_s):
    mk.assign(o, insert_inner)

# ------------------------------------------------------------------ hierarchy and pivots
front = bpy.data.objects.new("Front", None)
front.location = (m(-W / 2), m(FRONT_Y), 0)
mk._link(front, None)
card_root = bpy.data.objects.new("Card", None)
card_root.location = (m(CARD_CX), m(panel_in - CARD_T / 2), m(CARD_CZ))
mk._link(card_root, None)
bpy.context.view_layer.update()

for o in (front, card_root, tray, rim, hinge, pad, *clips, art_b, art_s, sleeve_b, sleeve_s, ins_b, ins_s):
    parent(o, root)
for o in (front_cover, lip, *manual_clips, art_f, sleeve_f, ins_f):
    parent(o, front)
for o in (card, card_rim, card_label):
    parent(o, card_root)
root["ibox_case"] = VARIANT
root["ibox_units"] = "metres (glTF), 1 m = 1000 mm"

# reference clips (iBox drives these pivots with springs; clips are for review tools)
scene = bpy.context.scene
scene.render.fps = 30
front.rotation_mode = "XYZ"
front.animation_data_create()
act = bpy.data.actions.new("Open")
front.animation_data.action = act
for frame, angle in ((1, 0.0), (24, -180.0)):
    front.rotation_euler = (0, 0, math.radians(angle))
    front.keyframe_insert("rotation_euler", index=2, frame=frame)
front.rotation_euler = (0, 0, 0)
front.animation_data.action = None
front.animation_data_clear()
act.use_fake_user = True

# review pose (renders only; the exported model is always closed)
if os.environ.get("IBOX_CASE_POSE") == "open":
    front.rotation_euler = (0, 0, math.radians(-180))
    card_root.location.y -= m(9.0)
    card_root.location.z += m(10.0)
    bpy.context.view_layer.update()
