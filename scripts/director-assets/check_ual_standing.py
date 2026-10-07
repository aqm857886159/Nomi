"""Deterministic first-frame ground/hip check for native UAL actions."""
import argparse, json, os
import bpy
from mathutils import Vector

SEMANTIC = {
    "hips": "DEF-hips", "head": "DEF-head",
    "leftFoot": "DEF-foot.L", "rightFoot": "DEF-foot.R",
    "leftToe": "DEF-toe.L", "rightToe": "DEF-toe.R",
}

def parse():
    raw = os.sys.argv[os.sys.argv.index('--') + 1:] if '--' in os.sys.argv else []
    p=argparse.ArgumentParser(); p.add_argument('--input',required=True); p.add_argument('--manifest',required=True); p.add_argument('--output',required=True); return p.parse_args(raw)

def point(arm, name): return arm.matrix_world @ arm.pose.bones[name].head

def main():
    a=parse(); bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=a.input)
    arms=[o for o in bpy.context.scene.objects if o.type=='ARMATURE']
    if len(arms)!=1: raise RuntimeError('expected one UAL armature')
    arm=arms[0]; manifest=json.load(open(a.manifest)); height=float(manifest['heightM'])
    for sem,bone in SEMANTIC.items():
        if bone not in arm.pose.bones: raise RuntimeError(f'missing {sem}: {bone}')
    actions={x.name:x for x in bpy.data.actions}; rows=[]
    for meta in manifest['actions']:
        action=actions.get(meta['id']);
        if action is None: raise RuntimeError(f'missing action {meta["id"]}')
        arm.animation_data_create(); arm.animation_data.action=action
        frame=int(round(action.frame_range[0])); bpy.context.scene.frame_set(frame); bpy.context.view_layer.update()
        foot_min=min(point(arm, SEMANTIC[n]).z for n in ('leftFoot','rightFoot','leftToe','rightToe'))
        hip_ratio=point(arm,SEMANTIC['hips']).z/height
        row={'id':meta['id'],'frame':frame,'requiresStanding':meta['requiresStanding'],'footMinCm':round(float(foot_min*100),4) if meta['requiresStanding'] else None,'hipRatio':round(float(hip_ratio),5) if meta['requiresStanding'] else None,'pass':(not meta['requiresStanding']) or (foot_min <= 0.03 and 0.45 <= hip_ratio <= 0.60)}
        rows.append(row)
    result={'heightM':height,'actions':rows,'pass':all(x['pass'] for x in rows)}
    with open(a.output,'w') as f: json.dump(result,f,ensure_ascii=False,indent=2); f.write('\n')
    print(json.dumps(result,ensure_ascii=False,indent=2))
    if not result['pass']: raise SystemExit(1)
if __name__=='__main__': main()
