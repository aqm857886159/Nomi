"""Prepare the approved Quaternius UAL Godot GLB as the native Director actor.

The source archive is never copied into Git.  The command extracts only the
registered Godot GLB, removes the preview sphere and source materials, assigns
one neutral white-model material, keeps the UAL armature and all 45 clips, and
exports a single GLB.  A single file keeps the native skeleton/action contract
intact and lets the runtime select clips lazily by name.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
import zipfile

import bpy
from mathutils import Vector

SOURCE_MEMBER = "Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb"
EXCLUDED_ACTIONS = {"A_TPose"}
STANDING_EXEMPT = {
    "Crouch_Fwd_Loop", "Crouch_Idle_Loop", "Death01", "Driving_Loop", "Fixing_Kneeling",
    "Jump_Land", "Jump_Loop", "Jump_Start", "PickUp_Table", "Roll", "Roll_RM",
    "Sitting_Enter", "Sitting_Exit", "Sitting_Idle_Loop", "Sitting_Talking_Loop",
    "Swim_Fwd_Loop", "Swim_Idle_Loop", "Jog_Fwd_Loop", "Sprint_Loop", "Push_Loop",
    "Sword_Attack", "Sword_Attack_RM", "Sword_Idle",
}
UAL_SEMANTIC = {
    "hips": "DEF-hips",
    "spine": "DEF-spine.001",
    "chest": "DEF-spine.002",
    "neck": "DEF-neck",
    "head": "DEF-head",
    "leftUpperArm": "DEF-upper_arm.L",
    "leftLowerArm": "DEF-forearm.L",
    "leftHand": "DEF-hand.L",
    "rightUpperArm": "DEF-upper_arm.R",
    "rightLowerArm": "DEF-forearm.R",
    "rightHand": "DEF-hand.R",
    "leftUpperLeg": "DEF-thigh.L",
    "leftLowerLeg": "DEF-shin.L",
    "leftFoot": "DEF-foot.L",
    "rightUpperLeg": "DEF-thigh.R",
    "rightLowerLeg": "DEF-shin.R",
    "rightFoot": "DEF-foot.R",
}


def args():
    raw = os.sys.argv[os.sys.argv.index("--") + 1 :] if "--" in os.sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--source", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--manifest", required=True)
    return p.parse_args(raw)


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_source(archive: str) -> tuple[str, str]:
    temp = tempfile.mkdtemp(prefix="nomi-ual-native-")
    output = os.path.join(temp, "AnimationLibrary_Godot_Standard.glb")
    with zipfile.ZipFile(archive) as zf:
        with zf.open(SOURCE_MEMBER) as source, open(output, "wb") as target:
            shutil.copyfileobj(source, target)
    return output, temp


def action_channels(action):
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves


def action_metadata(action, fps: float):
    start, end = action.frame_range
    paths = list(action_channels(action))
    root_location = [fc for fc in paths if fc.data_path == 'pose.bones["root"].location']
    root_motion = any(
        abs(max((kp.co[1] for kp in fc.keyframe_points), default=0.0)
            - min((kp.co[1] for kp in fc.keyframe_points), default=0.0)) > 1e-5
        for fc in root_location
    )
    return {
        "id": action.name,
        "frameStart": round(float(start), 4),
        "frameEnd": round(float(end), 4),
        "durationSec": round(float(max(0.0, end - start) / fps), 4),
        "loop": action.name.endswith("_Loop"),
        "rootMotion": root_motion,
        "requiresStanding": action.name not in STANDING_EXEMPT,
    }


def main():
    options = args()
    os.makedirs(os.path.dirname(os.path.abspath(options.output)), exist_ok=True)
    os.makedirs(os.path.dirname(os.path.abspath(options.manifest)), exist_ok=True)
    source_glb, temp = extract_source(options.source)
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=source_glb)
        armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
        if len(armatures) != 1:
            raise RuntimeError(f"expected one UAL armature, found {len(armatures)}")
        armature = armatures[0]
        armature.name = "UAL_Mannequin_Rig"
        # The Godot package includes a large preview sphere unrelated to the actor.
        for obj in list(bpy.context.scene.objects):
            if obj.type == "MESH" and obj.parent != armature:
                bpy.data.objects.remove(obj, do_unlink=True)
        meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.parent == armature]
        if len(meshes) != 1:
            raise RuntimeError(f"expected one skinned UAL mesh, found {len(meshes)}")
        mesh = meshes[0]
        mesh.name = "UAL_Mannequin_Mesh"

        # Measure the rest pose before removing the source materials.
        bpy.context.scene.frame_set(0)
        bpy.context.view_layer.update()
        world_bounds = [armature.matrix_world @ Vector(c) for c in mesh.bound_box]
        ground = min(v.z for v in world_bounds)
        ceiling = max(v.z for v in world_bounds)
        height = ceiling - ground
        if height <= 1.0 or height >= 3.0:
            raise RuntimeError(f"unexpected UAL rest height {height}")
        armature.location.z -= ground

        neutral = bpy.data.materials.new("UAL_WhiteModel")
        neutral.diffuse_color = (0.62, 0.66, 0.72, 1.0)
        neutral.use_nodes = True
        principled = neutral.node_tree.nodes.get("Principled BSDF")
        if principled:
            principled.inputs["Base Color"].default_value = (0.62, 0.66, 0.72, 1.0)
            principled.inputs["Roughness"].default_value = 0.86
        mesh.data.materials.clear()
        mesh.data.materials.append(neutral)
        for image in list(bpy.data.images):
            bpy.data.images.remove(image)

        # A_TPose is the source bind-pose marker, not one of the 45 action clips.
        for action in list(bpy.data.actions):
            if action.name in EXCLUDED_ACTIONS:
                bpy.data.actions.remove(action)
        actions = sorted(bpy.data.actions, key=lambda action: action.name)
        if len(actions) != 45:
            raise RuntimeError(f"expected 45 UAL actions after excluding bind pose, found {len(actions)}")
        for semantic, bone_name in UAL_SEMANTIC.items():
            if bone_name not in armature.data.bones:
                raise RuntimeError(f"missing semantic bone {semantic}: {bone_name}")

        bpy.context.scene.render.fps = 25
        bpy.ops.object.select_all(action="DESELECT")
        armature.select_set(True)
        mesh.select_set(True)
        bpy.context.view_layer.objects.active = armature
        bpy.ops.export_scene.gltf(
            filepath=os.path.abspath(options.output),
            export_format="GLB",
            use_selection=True,
            export_animations=True,
            export_animation_mode="ACTIONS",
            export_action_filter=False,
            export_nla_strips=False,
            export_skins=True,
            export_def_bones=False,
            export_materials="EXPORT",
            export_image_format="AUTO",
            export_force_sampling=False,
            export_optimize_animation_size=False,
            export_optimize_animation_keep_anim_armature=True,
            export_optimize_animation_keep_anim_object=False,
            export_bake_animation=False,
        )
        manifest = {
            "sourceArchive": os.path.abspath(options.source),
            "sourceArchiveSha256": sha256(options.source),
            "sourceMember": SOURCE_MEMBER,
            "sourceGlbSha256": sha256(source_glb),
            "author": "Quaternius",
            "license": "CC0-1.0",
            "licenseText": "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication",
            "modified": "Removed preview sphere and source materials/textures; assigned neutral white-model material; normalized rest-pose ground to z=0; retained UAL mesh, skeleton, and native actions.",
            "file": os.path.relpath(options.output),
            "heightM": round(float(height), 6),
            "origin": "ground-min-z",
            "fps": 25,
            "semanticBones": UAL_SEMANTIC,
            "actions": [action_metadata(action, 25.0) for action in actions],
        }
        manifest["outputBytes"] = os.path.getsize(options.output)
        manifest["outputSha256"] = sha256(options.output)
        with open(options.manifest, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
    finally:
        shutil.rmtree(temp, ignore_errors=True)


if __name__ == "__main__":
    main()
