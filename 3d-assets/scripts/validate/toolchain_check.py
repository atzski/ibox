"""Vérifie la chaîne d'outils Blender d'iBox (à lancer avec Blender en mode automatisé).

    blender --background --factory-startup --python 3d-assets/scripts/validate/toolchain_check.py -- <dossier_sortie>

Crée un objet, modifie sa géométrie, applique un matériau, sauvegarde un .blend,
exporte un .glb et produit un rendu. Aucun accès réseau.
"""
import os
import sys

import bpy

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.abspath("toolchain-check")
os.makedirs(out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
print("Blender", bpy.app.version_string)

# 1. objet de test
bpy.ops.mesh.primitive_cube_add(size=1)
obj = bpy.context.active_object
obj.name = "toolchain_cube"
# 2. géométrie modifiée : biseau appliqué
bev = obj.modifiers.new("Bevel", "BEVEL")
bev.width = 0.08
bev.segments = 3
bpy.ops.object.modifier_apply(modifier=bev.name)
obj.scale = (1.05, 1.7, 0.11)
bpy.ops.object.transform_apply(scale=True)
print("faces", len(obj.data.polygons))
# 3. matériau PBR
mat = bpy.data.materials.new("plastic_test")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.85, 0.88, 0.92, 1)
bsdf.inputs["Roughness"].default_value = 0.35
obj.data.materials.append(mat)
# 4. sauvegarde .blend
blend = os.path.join(out, "toolchain.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend)
# 5. export GLB
glb = os.path.join(out, "toolchain.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=False)
# 6. rendu (Eevee, petite taille)
scene = bpy.context.scene
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
cam.location = (2.6, -3.2, 2.0)
cam.rotation_euler = (1.1, 0, 0.68)
scene.camera = cam
light = bpy.data.objects.new("key", bpy.data.lights.new("key", "AREA"))
light.data.energy = 400
light.location = (2, -2, 3)
scene.collection.objects.link(light)
scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items} else "BLENDER_EEVEE_NEXT"
scene.render.resolution_x = 480
scene.render.resolution_y = 360
scene.render.filepath = os.path.join(out, "toolchain.png")
bpy.ops.render.render(write_still=True)

for p in (blend, glb, scene.render.filepath):
    print("OK" if os.path.isfile(p) and os.path.getsize(p) > 0 else "MANQUANT", p, os.path.getsize(p) if os.path.isfile(p) else 0)
