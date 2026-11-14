"""Build one iBox case model: run its model.py, save the .blend source, export the GLB.

    blender --background --factory-startup --python 3d-assets/scripts/build/build_case.py -- \
        --model 3d-assets/source/nintendo-switch/model.py --variant switch \
        --blend 3d-assets/source/nintendo-switch/switch-case.blend \
        --glb 3d-assets/exports/nintendo-switch/case.glb

Artwork images are never embedded: Art_* / Card_Label keep named materials that
iBox fills at runtime with each game's covers. No network access.
"""
import argparse
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # vendored modelkit

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--variant", default="switch")
ap.add_argument("--blend", required=True)
ap.add_argument("--glb", required=True)
args = ap.parse_args(argv)

os.environ["IBOX_CASE_VARIANT"] = args.variant
os.environ.pop("IBOX_CASE_POSE", None)

bpy.ops.wm.read_factory_settings(use_empty=True)
with open(args.model, encoding="utf-8-sig") as f:
    code = compile(f.read(), args.model, "exec")
exec(code, {"__name__": "__main__", "__file__": args.model})

# helper cutters never ship
for o in list(bpy.data.objects):
    if o.name.startswith("_"):
        bpy.data.objects.remove(o, do_unlink=True)

os.makedirs(os.path.dirname(os.path.abspath(args.blend)), exist_ok=True)
os.makedirs(os.path.dirname(os.path.abspath(args.glb)), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend), compress=True)

bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(args.glb),
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_image_format="NONE",
    export_extras=True,
    export_cameras=False,
    export_lights=False,
    export_animations=True,
)

tris = 0
for o in bpy.data.objects:
    if o.type == "MESH":
        me = o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
mats = sorted({s.material.name for o in bpy.data.objects if o.type == "MESH" for s in o.material_slots if s.material})
print(f"IBOX_BUILD variant={args.variant} triangles={tris} materials={len(mats)} {mats}")
print(f"IBOX_BUILD glb={os.path.abspath(args.glb)} bytes={os.path.getsize(args.glb)}")
