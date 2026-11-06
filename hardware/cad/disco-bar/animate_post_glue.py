"""Actual frozen B/C connection animatics, with the cup already gripping the knob.

Only rigid transforms and inspection cutaways are applied to pinned STL files.
Legacy renderer imports provide raster utilities only, never old geometry/poses.
"""
from __future__ import annotations
import argparse,hashlib,importlib,json,math,subprocess,sys
from dataclasses import dataclass,asdict,replace
from pathlib import Path
import numpy as np
import trimesh
from PIL import Image,ImageDraw
HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(HERE));sys.path.insert(0,str(HERE/'verification'))
from publication_bundle import load as admitted
r=importlib.import_module('disco-bar.animate_final_c')
W,H=1440,900
COLORS=dict(bar=(118,160,196),cup=(74,163,126),collar=(173,132,208),hardware=(99,111,128),
            knob=(208,81,73),base=(172,181,190),buffer=(222,185,91),key3=(204,71,130),key4=(23,138,172))
BASE=Path('/Users/anulman/dev/show-tools/hardware/cad/build/compact-mount-v4/receipt.json')
BASE_SHA='29b85bff87c061eba9569b15b297d6f2109babcf30c14b96ff5576974282801b'


@dataclass(frozen=True)
class Pose:
    lift:float=50.
    turn:float=0.
    drop:float=0.
    index:float=0.
    key3:float=100.  # axial withdrawal;100 hidden
    key4:float=0.
    screw:float=0.  # turns


def timeline(concept):
    rows=[];p=Pose()
    def hold(label,detail,duration=1.4):rows.append((p,p,duration,label,detail))
    def move(label,detail,duration=1.4,**changes):
        nonlocal p
        end=replace(p,**changes);rows.append((p,end,duration,label,detail));p=end
    hold('Cup already grips the knob','Box and stock hex stay fixed. The bar is already glued into the ball.',2.)
    move('Lower the ball / glued bar over the cup','Hold the ball; the 4 mm key holds the drive from underneath.',2.,lift=0.)
    move('Turn the bayonet 35°' if concept=='B' else 'Turn only the separate collar 35°',
         'Cup and knob turn while the ball is held.' if concept=='B' else 'Cup, knob and ball stay aligned; hold the collar at its upper stop.',2.,turn=35.)
    if concept=='B':
        move('Withdraw the 4 mm key','Keep the ball supported with your other hand.',key4=100.)
        move('Reposition the whole rotor, both keys out','Small indexing move aligns the lock screw with the underside port.',index=5.)
        move('Insert the 3 mm key from beneath','Support the ball; seat the screw head with the key.',key3=0.)
    else:
        move('Ball rests on bearing: insert the 3 mm key','Two hands transfer the upward push from the 4 mm key to the 3 mm key.',key3=0.)
        hold('Transfer support, then release the 4 mm key','The ball rests on the bearing, freeing a hand for the second key.')
        move('Withdraw the 4 mm key','The 3 mm key now maintains the collar’s upper-stop position.',key4=100.)
    move('Lift the ball 2.1 mm to seat the nut','One hand lifts the ball; the other maintains key pressure.',lift=2.1)
    move('Tighten the lock screw three full turns','Follow the ball down onto the bearing. No side screw access is needed.',3.,lift=0.,drop=2.1,screw=3.)
    move('Remove the 3 mm key','The coupling is locked. The mounting box and hex have not moved.',key3=100.)
    move('Normal use: the whole ball spins freely','Bar, cup and knob turn together; the stationary box has no rotation stop.',3.,index=p.index+360.)
    hold('Now reverse the connection','Grip screws and box mounting remain untouched.',1.5)
    move('Insert the 3 mm key again','Maintain pressure on its socket floor; support the ball.',key3=0.)
    move('Unwind three turns while lifting the ball','Keep the nut threaded onto the screw; do not remove it inside the ball.',3.,lift=2.1,drop=0.,screw=0.)
    move('Lower the ball back onto the bearing','Keep the key pressing the head onto its seat.',lift=0.)
    if concept=='B':
        move('Withdraw the 3 mm key','Keep supporting the ball.',key3=100.)
        move('Reposition the whole rotor, both keys out','Return to the underside bayonet-drive position.',index=360.)
        move('Insert the 4 mm key','Hold the ball with the other hand.',key4=0.)
    else:
        move('Ball resting: reinsert the 4 mm key','Transfer the upper-stop push back to the 4 mm key.',key4=0.)
        hold('Transfer support back to the 4 mm key','Two keys are briefly fitted; two hands are sufficient.')
        move('Withdraw the 3 mm key','Keep the 4 mm key pushed against its drive floor.',key3=100.)
    move('Turn back 35° to release','Cup and knob turn back relative to the held ball.' if concept=='B' else
         'Only the collar turns back; the cup stays on the knob.',2.,turn=0.)
    move('Lift the ball / glued bar away','The complete cup stays on the mounted knob. The glue bond is untouched.',2.,lift=50.)
    hold('Disconnected; mounted grip unchanged','All coupling parts remain serviceable through the opening after glue.',2.)
    return rows


def rz(mesh,angle):
    copy=mesh.copy();copy.apply_transform(trimesh.transformations.rotation_matrix(math.radians(angle),(0,0,1)));return copy


def shift(mesh,xyz):copy=mesh.copy();copy.apply_translation(xyz);return copy


def cyl(radius,height,z,xy=(0,0),sections=48):
    return shift(trimesh.creation.cylinder(radius=radius,height=height,sections=sections),(xy[0],xy[1],z))


def key_mesh(af,angle,spin=0.,retreat=0.,concept='C'):
    radius=38. if af==3 else 38.5
    x,y=radius*math.cos(math.radians(angle)),radius*math.sin(math.radians(angle))
    if af==3:
        floor=4.5 if concept=='C' else 5.;head=cyl(3/math.sqrt(3),3.,floor+1.5,sections=6)
        stem=cyl(2.,123.,floor+3.+61.5)
        handle=trimesh.creation.cylinder(radius=2.,height=20.,sections=12)
        handle.apply_transform(trimesh.transformations.rotation_matrix(math.pi/2,(0,1,0)));handle.apply_translation((10,0,floor+124))
    else:
        floor=4.5 if concept=='C' else 5.5;tip_length=7. if concept=='C' else 6.5
        head=cyl(4/math.sqrt(3),tip_length,floor+tip_length/2,sections=6)
        stem_length=133. if concept=='C' else 133.5
        stem=cyl(3.,stem_length,floor+tip_length+stem_length/2)
        handle=trimesh.creation.cylinder(radius=2.5,height=25.,sections=12)
        handle.apply_transform(trimesh.transformations.rotation_matrix(math.pi/2,(0,1,0)));handle.apply_translation((12.5,0,floor+137.5))
    tool=trimesh.util.concatenate([head,stem,handle]);tool=rz(tool,spin);tool.apply_translation((x,y,retreat));return tool


def inputs(selector,concept):
    records=admitted(selector);_,admission,report,_=next(q for q in records if q[0]==concept)
    pins={str(selector):hashlib.sha256(selector.read_bytes()).hexdigest()}
    def read(record):
        path=Path(record['stl']);sha=hashlib.sha256(path.read_bytes()).hexdigest()
        if sha!=record['stl_sha256']:raise ValueError('Changed actual mesh')
        pins[str(path)]=sha;return trimesh.load_mesh(path,process=True)
    module={q['name']:(read(q),q['role']) for q in report['stages']['inserted']['components']}
    bar=read(report['environment'])
    if hashlib.sha256(BASE.read_bytes()).hexdigest()!=BASE_SHA:raise ValueError('Unexpected base')
    pins[str(BASE)]=BASE_SHA;base_report=json.loads(BASE.read_text());base={}
    initial_index=-90. if concept=='B' else 280.
    for q in base_report['review_components']:
        if q['name'].startswith('ballast'):continue
        mesh=rz(read(q),-initial_index);mesh.vertices*=np.array([1.,-1.,-1.]);mesh.apply_translation((0,0,5.))
        base[q['name']]=mesh
    # Existing socket envelope only: no claim that these are newly measured OEM meshes.
    base['nominal stationary hex']=cyl(34.925/math.sqrt(3),6.35,8.425,sections=6)
    base['nominal stationary barrel']=cyl(28.575/2,11.6,5.8)
    knob=cyl(44.35475/2,25.4,-12.7)
    # A visible marker makes knob rotation legible without changing actual CAD.
    marker=trimesh.creation.box((2.,5.,1.));marker.apply_translation((0,17,-25.9))
    return admission,report,module,bar,base,knob,marker,pins



def verify_endpoints(concept,report,module,bar,base,knob,marker,pins):
    from scipy.spatial import cKDTree
    checks=[]
    poses={'inserted':Pose(lift=0.),'turned':Pose(lift=0.,turn=35.),
           'nuts-seated':Pose(lift=2.1,turn=35.),'locked':Pose(lift=0.,turn=35.,drop=2.1,screw=3.)}
    for stage,pose in poses.items():
        rendered={name:mesh for name,mesh,_ in compose(concept,pose,module,bar,base,knob,marker)}
        source_shift=report['stages'][stage]['source_pose']['shift']
        for item in report['stages'][stage]['components']:
            path=Path(item['stl']);sha=hashlib.sha256(path.read_bytes()).hexdigest()
            if sha!=item['stl_sha256']:raise ValueError('Endpoint mesh changed')
            pins[str(path)]=sha
            actual=shift(trimesh.load_mesh(path,process=True),(0,0,-source_shift))
            proposed=rendered[item['name']]
            error=max(float(cKDTree(actual.vertices).query(proposed.vertices)[0].max()),
                      float(cKDTree(proposed.vertices).query(actual.vertices)[0].max()))
            if error>1e-3:raise ValueError('Animation differs from actual endpoint '+stage+' '+item['name']+': '+str(error))
            checks.append(dict(stage=stage,component=item['name'],max_vertex_distance_mm=error))
    return checks

def compose(concept,p,module,bar,base,knob,marker):
    objects=[]
    for name,mesh in base.items():objects.append((name,mesh,COLORS['buffer'] if name=='buffer' else COLORS['base']))
    knob_angle=p.index+(p.turn if concept=='B' else 0.)
    objects.extend([('nominal knob',rz(knob,knob_angle),COLORS['knob']),('knob rotation mark',rz(marker,knob_angle),COLORS['hardware'])])
    objects.append(('glued bar',shift(rz(bar,p.index),(0,0,-p.lift)),COLORS['bar']))
    for name,(mesh,role) in module.items():
        rotating=concept=='B' or not (name=='removable padded knob cup' or name.startswith(('-1','+1')))
        angle=p.index+(p.turn if rotating else 0.)
        actual=mesh
        if name.startswith('threaded M4 full nut'):actual=shift(actual,(0,0,p.drop))
        if name.startswith('axial M4x12 socket screw'):
            point=np.array([38*math.cos(math.radians(95. if concept=='B' else 110.)),38*math.sin(math.radians(95. if concept=='B' else 110.)),0])
            actual=shift(rz(shift(actual,-point),-p.screw*360),point)
        actual=rz(actual,angle)
        color=COLORS['hardware'] if role=='hardware' else COLORS['buffer'] if role=='pad' else COLORS['collar'] if concept=='C' and rotating else COLORS['cup']
        if name.startswith('threaded M4 full nut'):color=(231,169,62)
        objects.append((name,actual,color))
    if p.key3<99.:
        angle=(95. if concept=='B' else 110.)+p.turn+p.index
        objects.append(('3 mm key',key_mesh(3,angle,p.turn+p.index-p.screw*360,p.key3,concept),COLORS['key3']))
    if p.key4<99.:
        angle=(225. if concept=='B' else 260.)+p.turn+p.index
        objects.append(('4 mm key',key_mesh(4,angle,p.turn+p.index,p.key4,concept),COLORS['key4']))
    return objects


def views(objects,concept,p):
    direction=np.array([-.65,.75,.65]);direction/=np.linalg.norm(direction)
    cut_normal=-direction.copy();cut_normal[2]=0
    main=[]
    for name,mesh,color in objects:
        if name=='glued bar' or name in base_names or name=='removable padded knob cup':mesh=r.cut(mesh,[0,0,0],cut_normal)
        main.append((mesh,color))
    overview=r.render_scene(main,(730,620),[0,0,-15.],direction,2.2)
    # Lock detail follows the actual screw axis. Section printed bodies behind
    #the axis, preserving the complete purchased screw/nut for visibility.
    angle=math.radians((95. if concept=='B' else 110.)+p.turn+p.index)
    point=np.array([38*math.cos(angle),38*math.sin(angle),-1.])
    eye=np.array([math.cos(angle),math.sin(angle),.65]);eye/=np.linalg.norm(eye)
    normal=-eye.copy();normal[2]=0
    close=[]
    for name,mesh,color in objects:
        if name in base_names or name.startswith('nominal stationary') or name=='knob rotation mark':continue
        mesh=r.crop(mesh,point+[-18,-18,-19],point+[18,18,24])
        if name=='glued bar' or name=='removable padded knob cup' or name.startswith('removable collar') or name=='nominal knob':
            mesh=r.cut(mesh,point,normal)
        if len(mesh.faces):close.append((mesh,color))
    detail=r.render_scene(close,(650,500),point+[0,0,3],eye,10.)
    return overview,detail


base_names={'shell','bottom','spacer','buffer','keeper_tab_0','keeper_tab_1','ballast_body','ballast_lid'}


def frame(objects,concept,p,label,detail,step,total):
    image=Image.new('RGB',(W,H),'#ffffff');draw=ImageDraw.Draw(image)
    title='B  ·  BAYONET + ONE LOCK SCREW' if concept=='B' else 'C  ·  INDEPENDENT ROTARY COLLAR'
    draw.text((28,18),title,font=r.font(19,True),fill='#4b6075')
    draw.text((28,54),label,font=r.font(29,True),fill='#182d43')
    draw.text((28,99),detail,font=r.font(21),fill='#3f546b')
    overview,zoom=views(objects,concept,p);image.paste(overview,(14,150));image.paste(zoom,(772,165))
    draw.text((30,153),'ALREADY-MOUNTED CUP + MOVING BALL/BAR',font=r.font(16,True),fill='#4b6075')
    draw.text((790,153),'LOCK SCREW / SECTION VIEW',font=r.font(16,True),fill='#4b6075')
    draw.text((790,688),f'Bayonet turn {p.turn:04.1f}°     Ball lift {p.lift:04.1f} mm',font=r.font(20),fill='#283f57')
    draw.text((790,720),f'Lock screw: {p.screw:03.1f} / 3 turns',font=r.font(20),fill='#283f57')
    draw.text((790,750),'Gold nut seats in the blue bar’s hex pocket.',font=r.font(18),fill='#283f57')
    legend=[('bar','Glued bar'),('cup','Cup gripping knob')]
    if concept=='C':legend.append(('collar','Separate collar'))
    legend += [('key3','3 mm lock key'),('key4','4 mm drive key')]
    for i,(color,text) in enumerate(legend):
        x=30+i*280;draw.rectangle((x,799,x+16,815),fill=COLORS[color]);draw.text((x+24,794),text,font=r.font(17),fill='#283f57')
    draw.text((30,835),'Actual frozen CAD meshes; box/bar/cup cut away for visibility. Ball shell omitted; knob is a nominal envelope.',font=r.font(17),fill='#536a80')
    draw.text((30,862),'Box supported for underside access. This animatic explains motion; physical fit, grip and strength remain untested.',font=r.font(16),fill='#536a80')
    draw.rectangle((30,775,W-30,780),fill='#dfe5ea');draw.rectangle((30,775,30+(W-60)*step/max(1,total-1),780),fill='#466a8b')
    return image


def run(selector,concept,output):
    if output.exists():raise ValueError('Use a fresh output namespace')
    output.mkdir(parents=True)
    admission,report,module,bar,base,knob,marker,pins=inputs(selector,concept)
    endpoint_checks=verify_endpoints(concept,report,module,bar,base,knob,marker,pins)
    rows=timeline(concept);frames=[];poses=[];contact=[];fps=8
    for step,(start,end,duration,label,detail) in enumerate(rows):
        n=1 if start==end else max(2,round(duration*fps))
        for i in range(n):
            t=i/max(1,n-1);t=t*t*(3-2*t)
            p=Pose(**{key:getattr(start,key)+(getattr(end,key)-getattr(start,key))*t for key in asdict(start)})
            path=output/f'frame-{len(frames):04d}.png'
            picture=frame(compose(concept,p,module,bar,base,knob,marker),concept,p,label,detail,step,len(rows));picture.save(path)
            frames.append((path,duration/n));poses.append(dict(stage=label,pose=asdict(p)))
            if i==n//2:contact.append(path)
        print(concept,step+1,'/',len(rows),label,flush=True)
    listing=output/'frames.ffconcat';listing.write_text('ffconcat version 1.0\n'+''.join(f"file '{p.name}'\nduration {d}\n" for p,d in frames)+f"file '{frames[-1][0].name}'\n")
    video=output/f'{concept.lower()}-connect-and-release.mp4'
    subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-safe','0','-i',str(listing),'-vf','fps=24,format=yuv420p','-c:v','libx264','-crf','22','-movflags','+faststart',str(video)],check=True)
    selected=np.linspace(0,len(contact)-1,8).round().astype(int);sheet=Image.new('RGB',(1440,1800),'white')
    for i,index in enumerate(selected):sheet.paste(Image.open(contact[index]).resize((720,450)),((i%2)*720,(i//2)*450))
    sheet.save(output/'contact-sheet.png');Image.open(frames[0][0]).save(output/'poster.png')
    # A compact overview GIF accompanies the full-resolution, captioned video.
    subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(video),'-vf','fps=5,scale=864:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer','-loop','-1',str(output/f'{concept.lower()}-connect-and-release.gif')],check=True)
    for path,sha in pins.items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=sha:raise ValueError('Input changed during rendering')
    manifest=dict(schema=1,kind='ACTUAL_MESH_CONNECTION_ANIMATIC',concept=concept,
        selector_sha256=hashlib.sha256(selector.read_bytes()).hexdigest(),candidate_receipt_sha256=admission['candidate_receipt']['sha256'],
        inputs=pins,source_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        fixed_baseplate_assumption='Cup grips installed knob; fixed box and stock hex do not rotate. B cup/knob turn for bayonet action; C collar turns independently.',
        clips=[dict(title=label,duration_seconds=d,start=asdict(s),end=asdict(e)) for s,e,d,label,_ in rows],
        actual_endpoint_checks=endpoint_checks,frames=poses,seconds=sum(row[2] for row in rows),physical_simulation=False,
        visual_omissions=['ball shell; bar remains full height','front bar, box and cup halves; printed-body section at lock detail','operator hands and bench supports'],
        schematic_only=['nominal knob/barrel/hex envelopes','knob rotation marker','ordinary hex key meshes'],
        artifacts={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (video,output/f'{concept.lower()}-connect-and-release.gif',output/'poster.png',output/'contact-sheet.png')})
    (output/'animation.json').write_text(json.dumps(manifest,indent=2)+'\n');print(video,flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--selector',type=Path,required=True);p.add_argument('--concept',choices=['B','C'],required=True);p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();run(args.selector,args.concept,args.output)
