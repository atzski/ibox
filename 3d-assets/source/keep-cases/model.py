"""Hinged game cases of the other consoles, iBox master models (one generator).

GameCube, Wii, PlayStation 2, PC (DVD-size keep cases), PlayStation (jewel
case), PSP (UMD case), Nintendo DS and 3DS (card cases). Same construction and
conventions as source/nintendo-switch/model.py: the case is the same object
everywhere — a back tray, a hinged front cover with a closing lip, a living
hinge, manual clips, a clear outer sleeve over a paper insert — only the
outside size, the plastic and what is held inside change.

Sizes in millimetres (iBox's caseSpecs.ts, x100). Blender in metres. Z up,
front faces -Y, case standing on z = 0. No logo, no official artwork: the
Art_* faces and the media label carry neutral materials iBox replaces at run
time (ART_FRONT, ART_SPINE, ART_BACK, CARD_LABEL, DISC_ART).

    IBOX_CASE_VARIANT = gamecube | wii | ps2 | pc | ps1 | psp | ds | 3ds
"""
import math
import os

import bmesh
import bpy
from mathutils import Vector

import modelkit as mk

VARIANT = os.environ.get("IBOX_CASE_VARIANT", "wii")
MM = 0.001


def srgb(hexstr):
    """'#rrggbb' (sRGB) -> linear RGB tuple, as Blender expects."""
    h = hexstr.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


# Outside sizes and media placement follow iBox's caseSpecs.ts (same numbers,
# x100), so the detailed model and the simplified fallback line up exactly.
# holder: "disc" (hub + disc), "umd" (UMD cartridge), "card" (game card + clips)
VARIANTS = {
    # 8 cm mini-disc, dark charcoal case (opaque)
    "gamecube": dict(W=136, H=191, D=14, R=3.0, shell="#202329", inner="#2b2f37", trans=0.0, rough=0.42,
                     holder="disc", disc_r=40, hole_r=7.5, media_at=(13, 12), disc_color="#c9ccd2"),
    # DVD-size case, white opaque plastic
    "wii": dict(W=136, H=191, D=14, R=3.5, shell="#f2f3f5", inner="#e1e4e9", trans=0.0, rough=0.36,
                holder="disc", disc_r=60, hole_r=7.5, media_at=(3, 8), disc_color="#d9dce2"),
    # DVD-size case, black opaque plastic
    "ps2": dict(W=135, H=190, D=14, R=3.0, shell="#15171b", inner="#20242a", trans=0.0, rough=0.4,
                holder="disc", disc_r=60, hole_r=7.5, media_at=(3, 8), disc_color="#2b3a66"),
    # DVD-size case, frosted clear plastic (most PC boxes)
    "pc": dict(W=135, H=190, D=14, R=3.0, shell="#e9f4f6", inner="#d6e7ea", trans=0.8, rough=0.2,
               holder="disc", disc_r=60, hole_r=7.5, media_at=(3, 8), disc_color="#d0d4da"),
    # CD jewel case: square corners, thin, dark tray
    "ps1": dict(W=142, H=125, D=10, R=1.2, shell="#1b1d22", inner="#25282e", trans=0.0, rough=0.3,
                holder="disc", disc_r=58, hole_r=7.5, media_at=(6, 0), disc_color="#20232a"),
    # UMD case (tall, narrow), dark plastic
    "psp": dict(W=104, H=180, D=14, R=4.0, shell="#17191d", inner="#22252b", trans=0.0, rough=0.38,
                holder="umd", media_at=(6, 38)),
    # DS: landscape case (137 x 125 mm, like its cover scans), light frosted, dark game card
    "ds": dict(W=137, H=125, D=14, R=3.5, shell="#e6e9ed", inner="#d6dae0", trans=0.75, rough=0.24,
               holder="card", card=(35, 33, 3.8), card_color="#3a3d44", media_at=(24, 24)),
    # 3DS: white frosted case
    "3ds": dict(W=137, H=125, D=14, R=3.5, shell="#f3f4f6", inner="#e3e6ea", trans=0.7, rough=0.24,
                holder="card", card=(35, 33, 3.8), card_color="#2f3238", media_at=(24, 24)),
}
P = VARIANTS[VARIANT]

W, H, D = float(P["W"]), float(P["H"]), float(P["D"])
T = 1.2  # wall / panel thickness
R = P["R"]
ART_OFF = 0.12
SLEEVE_OFF = 0.35
LIP_INSET, LIP_T, LIP_H = 1.45, 0.8, 1.2
FRONT_Y = -D / 2
BACK_Y = D / 2
MEDIA_CX, MEDIA_CZ = P["media_at"][0], H / 2 + P["media_at"][1]


def m(v):
    return v * MM


def rounded_rect(w, h, r, cx=0.0, cz=0.0, seg=8):
    """Counter-clockwise outline (x, z) of a rounded rectangle, in mm."""
    r = max(0.05, min(r, w / 2 - 0.01, h / 2 - 0.01))
    pts = []
    corners = [(cx + w / 2 - r, cz + h / 2 - r, 0), (cx - w / 2 + r, cz + h / 2 - r, 90),
               (cx - w / 2 + r, cz - h / 2 + r, 180), (cx + w / 2 - r, cz - h / 2 + r, 270)]
    for x0, z0, a0 in corners:
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((x0 + r * math.cos(a), z0 + r * math.sin(a)))
    return pts


def circle(r, cx, cz, seg=64):
    return [(cx + r * math.cos(2 * math.pi * i / seg), cz + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]


def slab(name, outline, y_front, y_back, coll=None):
    """Extrude an (x, z) outline between two y planes (mm)."""
    pts = [(m(x), m(z)) for x, z in outline]
    return mk.extrude_profile(name, pts, m(y_back - y_front), location=(0, m(y_back), 0),
                              rotation=(90, 0, 0), coll=coll)


def cut(target, cutter):
    mk.boolean(target, cutter)
    mk.apply_modifiers(target)
    bpy.data.objects.remove(cutter, do_unlink=True)
    return target


def ring(name, r_out, r_in, cx, cz, y_front, y_back):
    o = slab(name, circle(r_out, cx, cz), y_front, y_back)
    return cut(o, slab(name + "_hole", circle(r_in, cx, cz), y_front - 1, y_back + 1))


def _uv_face(bm, uv, verts, normal, uv_of):
    face = bm.faces.new(verts)
    face.normal_update()
    if face.normal.dot(Vector(normal)) < 0:
        face.normal_flip()
    for loop in face.loops:
        x, y, z = (c / MM for c in loop.vert.co)
        u, v = uv_of(x, y, z)
        # V inverted on purpose (glTF flips V; iBox canvas textures use flipY)
        loop[uv].uv = (u, 1.0 - v)


def flat_face(name, outline, plane, coord, normal, uv_of, coll=None):
    """One flat n-gon in a world plane with UVs in [0, 1]; normal is the outward axis."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    verts = []
    for a, b in outline:
        co = (m(a), m(coord), m(b)) if plane == "XZ" else (m(coord), m(a), m(b))
        verts.append(bm.verts.new(co))
    _uv_face(bm, uv, verts, normal, uv_of)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return mk._link(bpy.data.objects.new(name, me), coll)


def annulus_face(name, r_out, r_in, cx, cz, y, normal, uv_of, seg=64):
    """Flat ring (disc label with its centre hole) in an XZ plane, planar UVs."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    outer = [bm.verts.new((m(cx + r_out * math.cos(2 * math.pi * i / seg)), m(y), m(cz + r_out * math.sin(2 * math.pi * i / seg)))) for i in range(seg)]
    inner = [bm.verts.new((m(cx + r_in * math.cos(2 * math.pi * i / seg)), m(y), m(cz + r_in * math.sin(2 * math.pi * i / seg)))) for i in range(seg)]
    for i in range(seg):
        j = (i + 1) % seg
        _uv_face(bm, uv, [outer[i], outer[j], inner[j], inner[i]], normal, uv_of)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return mk._link(bpy.data.objects.new(name, me), None)


def mat(name, color, rough, transmission=0.0, alpha=1.0, ior=1.49, metal=0.0):
    mt = bpy.data.materials.new(name)
    mt.use_nodes = True
    b = mt.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
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
shell = mat("SHELL", srgb(P["shell"]), P["rough"], transmission=P["trans"])
inner = mat("SHELL_INNER", srgb(P["inner"]), P["rough"] + 0.1, transmission=P["trans"] * 0.8)
sleeve = mat("SLEEVE", (0.95, 0.96, 0.97), 0.06, alpha=0.10)
insert_inner = mat("INSERT_INNER", (0.80, 0.80, 0.78), 0.88)
art_front = art_mat("ART_FRONT", demo_art("demo_front", 64, 96, (0.98, 0.86, 0.80), (0.72, 0.84, 0.96)))
art_back = art_mat("ART_BACK", demo_art("demo_back", 64, 96, (0.93, 0.93, 0.95), (0.85, 0.87, 0.92)))
art_spine = art_mat("ART_SPINE", demo_art("demo_spine", 8, 96, (0.98, 0.86, 0.80), (0.72, 0.84, 0.96)))

root = bpy.data.objects.new("Case", None)
mk._link(root, None)

# ------------------------------------------------------------------ tray (back half)
outer = rounded_rect(W, H, R, cz=H / 2)
inner_outline = rounded_rect(W - 2 * T, H - 2 * T, R - T * 0.6, cz=H / 2)
tray = slab("Tray", outer, FRONT_Y + T, BACK_Y)
cut(tray, slab("tray_cavity", inner_outline, FRONT_Y, BACK_Y - T))
mk.finish(tray, bevel=m(0.45), segments=2)
mk.assign(tray, shell)

rim = slab("tray_rim_tmp", rounded_rect(W - 2 * T - 0.1, H - 2 * T - 0.1, R - 0.8, cz=H / 2), BACK_Y - T - 0.9, BACK_Y - T + 0.05)
cut(rim, slab("tray_rim_hole", rounded_rect(W - 2 * T - 4.0, H - 2 * T - 4.0, R - 1.5, cz=H / 2), BACK_Y - T - 2, BACK_Y))
rim.name = "Tray_Rim"
mk.finish(rim, bevel=m(0.25), segments=2)
mk.assign(rim, inner)

# ------------------------------------------------------------------ front cover (hinged)
front_cover = slab("Front_Cover", outer, FRONT_Y, FRONT_Y + T)
mk.finish(front_cover, bevel=m(0.45), segments=2)
mk.assign(front_cover, shell)
lip = slab("Front_Lip", rounded_rect(W - 2 * LIP_INSET, H - 2 * LIP_INSET, R - 1.2, cz=H / 2), FRONT_Y + T - 0.05, FRONT_Y + T + LIP_H)
cut(lip, slab("lip_hole", rounded_rect(W - 2 * (LIP_INSET + LIP_T), H - 2 * (LIP_INSET + LIP_T), R - 1.6, cz=H / 2),
              FRONT_Y, FRONT_Y + T + LIP_H + 1))
mk.finish(lip, bevel=m(0.2), segments=2)
mk.assign(lip, inner)

hinge = mk.cylinder("Hinge", m(0.65), m(H - 2 * max(R, 3.0)), location=(m(-W / 2 + 0.35), m(FRONT_Y + T), m(H / 2)), segments=16)
mk.finish(hinge, bevel=0)
mk.assign(hinge, shell)

# manual clips (inside the front cover); a jewel case has none
manual_clips = []
if VARIANT != "ps1":
    for tag, zc, sign in (("T", H - 9.0, -1), ("B", 9.0, 1)):
        base = mk.box(f"Manual_Clip_{tag}", (m(14), m(2.4), m(3.2)), location=(0, m(FRONT_Y + T + 1.15), m(zc)))
        hook = mk.box("hook_tmp", (m(13.4), m(0.9), m(1.6)), location=(0, m(FRONT_Y + T + 2.1), m(zc + sign * 1.9)))
        mk.boolean(base, hook, operation="UNION")
        mk.apply_modifiers(base)
        bpy.data.objects.remove(hook, do_unlink=True)
        mk.finish(base, bevel=m(0.3), segments=2)
        mk.assign(base, inner)
        manual_clips.append(base)

# ------------------------------------------------------------------ media holder + media
panel_in = BACK_Y - T  # inner face of the back panel
holder_parts = []  # fixed to the tray
media_parts = []  # moves with the "Card" pivot
media_centre_y = panel_in

if P["holder"] == "disc":
    rd, rh = float(P["disc_r"]), float(P["hole_r"])
    disc_t = 1.2
    seat = 1.6  # the disc sits on the hub's shoulder, above the panel
    # moulded well around the disc edge
    well = ring("Card_Pad", rd + 3.0, rd + 0.8, MEDIA_CX, MEDIA_CZ, panel_in - 0.8, panel_in + 0.05)
    mk.finish(well, bevel=m(0.2), segments=1)
    holder_parts.append(well)
    # hub: shoulder ring + rosette of flexible teeth through the disc hole
    shoulder = ring("Card_Hub", rh + 6.0, rh - 0.2, MEDIA_CX, MEDIA_CZ, panel_in - seat, panel_in + 0.05)
    mk.finish(shoulder, bevel=m(0.2), segments=1)
    holder_parts.append(shoulder)
    for i in range(10):
        a = 2 * math.pi * i / 10
        tooth = mk.box(f"Card_Tooth_{i}", (m(2.2), m(seat + disc_t + 1.4), m(1.2)),
                       location=(m(MEDIA_CX + (rh - 0.9) * math.cos(a)), m(panel_in - (seat + disc_t + 1.4) / 2 + 0.05),
                                 m(MEDIA_CZ + (rh - 0.9) * math.sin(a))),
                       rotation=(0, -math.degrees(a) + 90, 0))
        mk.finish(tooth, bevel=m(0.2), segments=1)
        holder_parts.append(tooth)
    for o in holder_parts:
        mk.assign(o, inner)
    # the disc: data side silver/coloured, printed side carries DISC_ART
    disc_mat = mat("DISC", srgb(P["disc_color"]), 0.18, metal=0.85)
    y_front = panel_in - seat - disc_t
    disc = ring("Card_Disc", rd, rh, MEDIA_CX, MEDIA_CZ, y_front, panel_in - seat)
    mk.finish(disc, bevel=m(0.15), segments=1, angle=40)
    mk.assign(disc, disc_mat)
    disc_art = mat("DISC_ART", (0.92, 0.92, 0.92), 0.45)
    label = annulus_face("Card_DiscArt", rd - 0.4, rh + 4.5, MEDIA_CX, MEDIA_CZ, y_front - 0.04, (0, -1, 0),
                         lambda x, y, z: ((x - (MEDIA_CX - rd)) / (2 * rd), (z - (MEDIA_CZ - rd)) / (2 * rd)))
    mk.assign(label, disc_art)
    media_parts += [disc, label]
    media_centre_y = panel_in - seat - disc_t / 2

elif P["holder"] == "umd":
    UW, UH, UT = 64.0, 65.0, 4.2
    pad = slab("Card_Pad", rounded_rect(UW + 7, UH + 7, 5, cx=MEDIA_CX, cz=MEDIA_CZ), panel_in - 0.8, panel_in + 0.05)
    cut(pad, slab("pad_hole", rounded_rect(UW + 0.8, UH + 0.8, 4.2, cx=MEDIA_CX, cz=MEDIA_CZ), panel_in - 2, panel_in + 1))
    mk.finish(pad, bevel=m(0.25), segments=2)
    mk.assign(pad, inner)
    holder_parts.append(pad)
    # UMD: rounded shell, a rounded top edge, a clear window over the disc
    umd_mat = mat("CARD", srgb("#2a2c31"), 0.35, transmission=0.3)
    body = slab("Card_Body", rounded_rect(UW, UH, 4.0, cx=MEDIA_CX, cz=MEDIA_CZ), panel_in - UT, panel_in)
    mk.finish(body, bevel=m(0.5), segments=2, angle=40)
    mk.assign(body, umd_mat)
    disc_art = mat("DISC_ART", (0.92, 0.92, 0.92), 0.45)
    wr = 25.0
    wcz = MEDIA_CZ - 4.0
    window = annulus_face("Card_DiscArt", wr, 5.5, MEDIA_CX, wcz, panel_in - UT - 0.05, (0, -1, 0),
                          lambda x, y, z: ((x - (MEDIA_CX - wr)) / (2 * wr), (z - (wcz - wr)) / (2 * wr)))
    mk.assign(window, disc_art)
    media_parts += [body, window]
    media_centre_y = panel_in - UT / 2

else:  # card
    CW, CH, CT = P["card"]
    CH_CHAMFER = 2.6
    pad = slab("Card_Pad", rounded_rect(CW + 7, CH + 7, 2.5, cx=MEDIA_CX, cz=MEDIA_CZ), panel_in - 0.8, panel_in + 0.05)
    cut(pad, slab("pad_hole", rounded_rect(CW + 0.6, CH + 0.6, 1.0, cx=MEDIA_CX, cz=MEDIA_CZ), panel_in - 2, panel_in + 1))
    mk.finish(pad, bevel=m(0.25), segments=2)
    mk.assign(pad, inner)
    holder_parts.append(pad)
    for tag, (cx, cz), (sx, sz), (dx, dz) in [
        ("L", (MEDIA_CX - CW / 2 - 0.9, MEDIA_CZ), (1.8, 8.0), (-1, 0)),
        ("R", (MEDIA_CX + CW / 2 + 0.9, MEDIA_CZ), (1.8, 8.0), (1, 0)),
        ("T", (MEDIA_CX, MEDIA_CZ + CH / 2 + 0.9), (8.0, 1.8), (0, 1)),
        ("B", (MEDIA_CX, MEDIA_CZ - CH / 2 - 0.9), (8.0, 1.8), (0, -1)),
    ]:
        post = mk.box(f"Card_Clip_{tag}", (m(sx), m(CT + 0.9), m(sz)), location=(m(cx), m(panel_in - (CT + 0.9) / 2 + 0.05), m(cz)))
        hk = mk.box("clip_hook", (m(sx - 0.4 if dx == 0 else 2.4), m(0.7), m(sz - 0.4 if dz == 0 else 2.4)),
                    location=(m(cx - dx * 0.6), m(panel_in - CT - 0.45), m(cz - dz * 0.6)))
        mk.boolean(post, hk, operation="UNION")
        mk.apply_modifiers(post)
        bpy.data.objects.remove(hk, do_unlink=True)
        mk.finish(post, bevel=m(0.25), segments=2)
        mk.assign(post, inner)
        holder_parts.append(post)
    card_mat = mat("CARD", srgb(P["card_color"]), 0.42)
    outline = [
        (MEDIA_CX - CW / 2, MEDIA_CZ - CH / 2), (MEDIA_CX + CW / 2, MEDIA_CZ - CH / 2),
        (MEDIA_CX + CW / 2, MEDIA_CZ + CH / 2 - CH_CHAMFER), (MEDIA_CX + CW / 2 - CH_CHAMFER, MEDIA_CZ + CH / 2),
        (MEDIA_CX - CW / 2, MEDIA_CZ + CH / 2),
    ]
    card = slab("Card_Body", outline, panel_in - CT, panel_in)
    mk.finish(card, bevel=m(0.35), segments=2, angle=40)
    mk.assign(card, card_mat)
    # label: same aspect as iBox's card-label canvas (0.86 x 0.7 of the card)
    lab_w = CW * 0.86
    lab_h = lab_w * (CH * 0.7) / (CW * 0.86)
    lab_cz = MEDIA_CZ + CH / 2 - 2.2 - lab_h / 2
    label_mat = art_mat("CARD_LABEL", demo_art("demo_label", 32, 32, (0.98, 0.92, 0.75), (0.80, 0.90, 0.98)))
    card_label = flat_face("Card_Label", rounded_rect(lab_w, lab_h, 0.8, cx=MEDIA_CX, cz=lab_cz, seg=3), "XZ",
                           panel_in - CT - 0.05, (0, -1, 0),
                           lambda x, y, z: ((x - (MEDIA_CX - lab_w / 2)) / lab_w, (z - (lab_cz - lab_h / 2)) / lab_h))
    mk.assign(card_label, label_mat)
    # grip ridges along the bottom edge of the card
    for i in range(5):
        rib = mk.box(f"Card_Rib_{i}", (m(CW * 0.6), m(0.25), m(0.5)),
                     location=(m(MEDIA_CX), m(panel_in - CT - 0.1), m(MEDIA_CZ - CH / 2 + 1.6 + i * 1.1)))
        mk.assign(rib, card_mat)
        media_parts.append(rib)
    media_parts += [card, card_label]
    media_centre_y = panel_in - CT / 2

# ------------------------------------------------------------------ artwork + clear sleeve
art_outline = rounded_rect(W - 0.8, H - 0.8, R - 0.4, cz=H / 2)
art_f = flat_face("Art_Front", art_outline, "XZ", FRONT_Y - ART_OFF, (0, -1, 0), lambda x, y, z: ((x + W / 2) / W, z / H))
art_b = flat_face("Art_Back", art_outline, "XZ", BACK_Y + ART_OFF, (0, 1, 0), lambda x, y, z: ((W / 2 - x) / W, z / H))
spine_outline = [(-D / 2 + 0.6, 2.5), (D / 2 - 0.6, 2.5), (D / 2 - 0.6, H - 2.5), (-D / 2 + 0.6, H - 2.5)]
art_s = flat_face("Art_Spine", spine_outline, "YZ", -W / 2 - ART_OFF, (-1, 0, 0), lambda x, y, z: ((D / 2 - y) / D, z / H))
for o, mt in ((art_f, art_front), (art_b, art_back), (art_s, art_spine)):
    mk.assign(o, mt)

sl_outline = rounded_rect(W - 0.2, H - 0.2, R - 0.1, cz=H / 2)
sleeve_f = flat_face("Sleeve_Front", sl_outline, "XZ", FRONT_Y - SLEEVE_OFF, (0, -1, 0), lambda x, y, z: ((x + W / 2) / W, z / H))
sleeve_b = flat_face("Sleeve_Back", sl_outline, "XZ", BACK_Y + SLEEVE_OFF, (0, 1, 0), lambda x, y, z: ((W / 2 - x) / W, z / H))
sleeve_s = flat_face("Sleeve_Spine", [(-D / 2 + 0.3, 1.5), (D / 2 - 0.3, 1.5), (D / 2 - 0.3, H - 1.5), (-D / 2 + 0.3, H - 1.5)],
                     "YZ", -W / 2 - SLEEVE_OFF, (-1, 0, 0), lambda x, y, z: ((D / 2 - y) / D, z / H))
for o in (sleeve_f, sleeve_b, sleeve_s):
    mk.assign(o, sleeve)

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
card_root.location = (m(MEDIA_CX), m(media_centre_y), m(MEDIA_CZ))
mk._link(card_root, None)
bpy.context.view_layer.update()

for o in (front, card_root, tray, rim, hinge, *holder_parts, art_b, art_s, sleeve_b, sleeve_s, ins_b, ins_s):
    parent(o, root)
for o in (front_cover, lip, *manual_clips, art_f, sleeve_f, ins_f):
    parent(o, front)
for o in media_parts:
    parent(o, card_root)
root["ibox_case"] = VARIANT
root["ibox_media"] = P["holder"]
root["ibox_units"] = "metres (glTF), 1 m = 1000 mm"

if os.environ.get("IBOX_CASE_POSE") == "open":
    front.rotation_euler = (0, 0, math.radians(-180))
    card_root.location.y -= m(6.0)
    bpy.context.view_layer.update()
