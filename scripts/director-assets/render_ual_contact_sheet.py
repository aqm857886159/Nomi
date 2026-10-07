"""Render start/middle/end native UAL actions with a ground grid."""
import argparse, json, os
import bpy
from mathutils import Vector

BONES = ['DEF-foot.L','DEF-foot.R','DEF-toe.L','DEF-toe.R']

def parse():
    raw=os.sys.argv[os.sys.argv.index('--')+1:] if '--' in os.sys.argv else []
    p=argparse.ArgumentParser(); p.add_argument('--input',required=True); p.add_argument('--manifest',required=True); p.add_argument('--out-dir',required=True); return p.parse_args(raw)

def mat(name,color,rough=0.8):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True; bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(*color,1); bs.inputs['Roughness'].default_value=rough; return m

def point(arm,name): return arm.matrix_world @ arm.pose.bones[name].head

def setup_world():
    ground_mat=mat('ContactGround',(0.10,0.12,0.15),0.95); line_mat=mat('ContactGrid',(0.25,0.29,0.35),0.9)
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0,0,-0.002)); bpy.context.object.data.materials.append(ground_mat)
    for i in range(-6,7):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(i,0,0.002)); o=bpy.context.object; o.name='grid-x'; o.dimensions=(0.012,12,0.006); o.data.materials.append(line_mat); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0,i,0.003)); o=bpy.context.object; o.name='grid-y'; o.dimensions=(12,0.012,0.006); o.data.materials.append(line_mat); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    bpy.ops.object.light_add(type='AREA', location=(3,-4,5)); bpy.context.object.data.energy=850; bpy.context.object.data.shape='DISK'; bpy.context.object.data.size=4; bpy.context.object.rotation_euler=(0.5,0.0,0.55)
    bpy.ops.object.light_add(type='AREA', location=(-3,1,3)); bpy.context.object.data.energy=500; bpy.context.object.data.size=3; bpy.context.object.rotation_euler=(0.8,0, -1.0)
    bpy.ops.object.camera_add(location=(3.1,-4.8,2.4)); camera=bpy.context.object; target=Vector((0,0,0.9)); camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler(); camera.data.lens=52; bpy.context.scene.camera=camera

def main():
    a=parse(); os.makedirs(a.out_dir,exist_ok=True); bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=a.input)
    arms=[o for o in bpy.context.scene.objects if o.type=='ARMATURE']; meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    if len(arms)!=1: raise RuntimeError('expected one armature')
    arm=arms[0]; arm.animation_data_create(); setup_world()
    scene=bpy.context.scene; scene.world=bpy.data.worlds.new('ContactWorld'); scene.render.engine='BLENDER_EEVEE'; scene.render.resolution_x=320; scene.render.resolution_y=240; scene.render.resolution_percentage=100; scene.render.image_settings.file_format='PNG'; scene.render.film_transparent=False; scene.world.color=(0.025,0.03,0.04); scene.render.filepath=''
    manifest=json.load(open(a.manifest)); rows=[]
    for meta in manifest['actions']:
        action=next((x for x in bpy.data.actions if x.name==meta['id']),None)
        if action is None: raise RuntimeError(f'missing action {meta["id"]}')
        arm.animation_data.action=action; start,end=action.frame_range; samples=[('start',start),('mid',(start+end)/2),('end',max(start,end-0.001))]; sample_rows=[]
        for label,frame in samples:
            scene.frame_set(int(round(frame))); bpy.context.view_layer.update(); foot=min(point(arm,b).z for b in BONES); path=os.path.join(a.out_dir,f'{meta["id"]}__{label}.png'); scene.render.filepath=path; bpy.ops.render.render(write_still=True); sample_rows.append({'label':label,'frame':round(float(frame),4),'image':path,'footMinCm':round(float(foot*100),3),'grounded':foot<=0.03})
        rows.append({'id':meta['id'],'samples':sample_rows,'inspection':meta.get('inspection',''),'requiresStanding':meta['requiresStanding']})
    with open(os.path.join(a.out_dir,'contact-manifest.json'),'w') as f: json.dump({'actions':rows},f,ensure_ascii=False,indent=2); f.write('\n')
    print(json.dumps({'actions':len(rows),'outDir':a.out_dir},ensure_ascii=False))
if __name__=='__main__': main()
