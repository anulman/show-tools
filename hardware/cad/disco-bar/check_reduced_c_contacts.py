"""Positive contact witnesses for actual delivered post-glue fastener constraints."""
from __future__ import annotations
from copy import deepcopy
import argparse,hashlib,importlib,json,sys,math
from pathlib import Path
from build123d import Axis,Compound,import_step
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
r=importlib.import_module('disco-bar.reduced_c')
u=importlib.import_module('disco-bar.reduced_c_subjects')
BODY_NAMES={r.LOCK_HALF,r.FUSED_HALF}
m=importlib.import_module('disco-bar.post_glue_couplings');c=m.c;a=m.channels
p=importlib.import_module('disco-bar.check_couplings')


def run(source,output):
    output.mkdir(parents=True,exist_ok=True);(output/'receipt.json').unlink(missing_ok=True)
    paths={Path(f).resolve():hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in (__file__,r.__file__,u.__file__,m.__file__,c.__file__,a.__file__,p.__file__)}
    paths[source.resolve()]=hashlib.sha256(source.read_bytes()).hexdigest();data=json.loads(source.read_text())
    def load(record):
        for kind in ('step','stl'):
            file=Path(record[kind]);sha=hashlib.sha256(file.read_bytes()).hexdigest()
            if sha!=record[kind+'_sha256']:raise ValueError('Artifact changed')
            paths[file.resolve()]=sha
        shape=import_step(record['step'])
        if not shape.is_valid or len(shape.solids())!=1:raise ValueError('Invalid actual solid')
        return shape.solids()[0]
    def common(left,right):return a.channel_boolean(a.BRepAlgoAPI_Common,left.wrapped,right.wrapped)
    def empty(left,right,label):
        amount=a.channel_material_volume(common(left,right))
        if amount>1e-5:raise ValueError('Nominal constraint already interferes '+label)
    def witness(label,left,right):
        raw=common(left,right);amount=a.channel_material_volume(raw)
        if amount<=1e-5:raise ValueError('No positive constraint '+label)
        return dict(native_common_mm3=amount,components=[p.export_piece(c.Piece(label+' '+str(i),deepcopy(solid),'positive overtravel witness only; NOT PRINT GEOMETRY'),output/'witnesses') for i,solid in enumerate(Compound(raw).solids())])
    bar=load(data['environment']);inserted={q['name']:load(q) for q in data['stages']['inserted']['components']};seated={q['name']:load(q) for q in data['stages']['nuts-seated']['components']};result=[]
    for name,screw in inserted.items():
        if not name.startswith('axial M4x12 socket screw '):continue
        cover=inserted[r.FUSED_HALF];empty(screw,cover,'head/cover')
        empty(screw.translate((0,0,.5)),cover,'head float limit')
        record=dict(screw=name,head_capture_at_source_float_mm=.5,cover_capture=witness(name+' head cover capture',screw.translate((0,0,.51)),cover),head_seats=[])
        for host,body in inserted.items():
            if host!='removable padded knob cup' and not host in BODY_NAMES:continue
            empty(screw,body,'head/seat')
            pressed=screw.translate((0,0,-.01))
            if a.channel_material_volume(common(pressed,body))>1e-5:record['head_seats'].append(dict(host=host,evidence=witness(name+' head seat '+host,pressed,body)))
        if not record['head_seats']:raise ValueError('Missing head seat')
        entry=float(name.rsplit(' ',1)[1]);nut_name='threaded M4 full nut '+str(entry);nut=seated[nut_name]
        axis=Axis((*m.old.xy(38.,entry+35.),0),(0,0,1));empty(nut,bar,'seated nut/bar')
        record['nut_axial_floor_seat']=witness(nut_name+' axial floor seat',nut.translate((0,0,.01)),bar)
        record['nut_anti_rotation']={str(angle):witness(nut_name+' hex pocket '+str(angle),nut.rotate(axis,angle),bar) for angle in (-10.,10.)}
        if data['concept']=='post-glue A':
            lagged=nut.translate((0,0,-1.2));empty(lagged,bar,'Worst-case A transient nut nominal')
            record['worst_transient_nut_register_loss_mm']=1.2
            record['worst_transient_nut_anti_rotation']={str(turn):witness(nut_name+' worst transient hex pocket '+str(turn),lagged.rotate(axis,turn),bar) for turn in (-10.,10.)}
        record['shaft_bearings']={}
        for direction in (-2.,2.):
            bearings=[]
            for host,body in seated.items():
                if host!='removable padded knob cup' and not host in BODY_NAMES:continue
                empty(body,seated[name],'shaft/printed bore')
                turned=body.rotate(Axis.Z,direction)
                if a.channel_material_volume(common(turned,seated[name]))>1e-5:bearings.append(dict(host=host,evidence=witness(name+' shaft bearing '+host+' '+str(direction),turned,seated[name])))
            if not bearings:raise ValueError('No positive shaft bearing in direction '+str(direction))
            record['shaft_bearings'][str(direction)]=bearings
        result.append(record)
    cup_drive={};collar_joints=[];cover_joints=[]
    if data['concept']=='post-glue C':
        cup=inserted['removable padded knob cup'];empty(cup,bar,'fixed cup/bar keys')
        cup_drive={str(angle):witness('fixed cup bar key '+str(angle),cup.rotate(Axis.Z,angle),bar) for angle in (-2.,2.)}
        for angle in (() if not any(n.startswith('external collar M2') for n in inserted) else (90.,270.)):
            screw_name='external collar M2x8 screw '+str(angle);nut_name='external collar M2 nut '+str(angle)
            screw,nut=inserted[screw_name],inserted[nut_name]
            direction=m.old.xy(1.,angle+90.);centre=nut.bounding_box().center()
            axis=Axis((centre.X,centre.Y,centre.Z),(*direction,0))
            joint=dict(screw=screw_name,nut=nut_name,head_seats=[],nut_seats=[],nut_anti_rotation={})
            for name,host in inserted.items():
                if not name in BODY_NAMES:continue
                empty(screw,host,'M2 screw/head seat');empty(nut,host,'M2 nut/reaction seat')
                for item,part,delta in [('head_seats',screw,-.01),('nut_seats',nut,.01)]:
                    pushed=part.translate((direction[0]*delta,direction[1]*delta,0))
                    if a.channel_material_volume(common(pushed,host))>1e-5:joint[item].append(dict(host=name,evidence=witness(item+' '+str(angle)+' '+name,pushed,host)))
                for turn in (-20.,20.):
                    rotated=nut.rotate(axis,turn)
                    if a.channel_material_volume(common(rotated,host))>1e-5:joint['nut_anti_rotation'].setdefault(str(turn),[]).append(dict(host=name,evidence=witness('M2 nut pocket '+str(angle)+' '+str(turn)+' '+name,rotated,host)))
            if not joint['head_seats'] or not joint['nut_seats'] or set(joint['nut_anti_rotation'])!={'-20.0','20.0'}:raise ValueError('Incomplete M2 positive joint contacts')
            collar_joints.append(joint)
    for name,screw in inserted.items():
        if not name.startswith('external cover M3x8 screw '):continue
        angle=float(name.rsplit(' ',1)[1]);nut_name='external cover M3 nut '+str(angle);nut=inserted[nut_name]
        cover=inserted[r.FUSED_HALF];empty(screw,cover,'M3 cover screw nominal')
        item=dict(screw=name,nut=nut_name,source_axis_xy_mm=list(m.old.xy(38.,angle)),cover_head_seat=witness(name+' cover head seat',screw.translate((0,0,-.01)),cover),post_reaction_seats=[],cover_shank_bearings={})
        for direction in (-.5,.5):item['cover_shank_bearings'][str(direction)]=witness(name+' cover bore bearing '+str(direction),cover.translate((direction,0,0)),screw)
        for host,body in inserted.items():
            if host!='removable padded knob cup' and not host in BODY_NAMES:continue
            empty(nut,body,'M3 post nut nominal')
            pressed=nut.translate((0,0,.01))
            if a.channel_material_volume(common(pressed,body))>1e-5:
                item['post_reaction_seats'].append(dict(host=host,evidence=witness(name+' post nut floor '+host,pressed,body)))
        if not item['post_reaction_seats']:raise ValueError('Missing M3 post nut reaction floor')
        cover_joints.append(item)
    if data['concept']=='post-glue C' and not collar_joints:
        owners={name:0 for name in inserted if name in BODY_NAMES}
        for item in cover_joints:
            for seat in item['post_reaction_seats']:owners[seat['host']]+=1
        if len(cover_joints)!=2 or owners!={r.LOCK_HALF:2,r.FUSED_HALF:0}:raise ValueError('Two remaining joints must restrain the lock half')
    bridges=[]
    fused=inserted[r.FUSED_HALF]
    for angle in (15.,310.):
        bridge=c.cyl(3.,2.,(*m.old.xy(38.,angle),7.))
        raw=a.channel_boolean(a.BRepAlgoAPI_Cut,bridge.wrapped,fused.wrapped)
        if a.channel_material_volume(raw)>1e-5:raise ValueError('Missing continuous printed cover/post bridge')
        bridges.append(dict(angle_source_deg=angle,cross_section_mm2=math.pi*9.,components=[p.export_piece(c.Piece('integral cover bridge '+str(angle),bridge,'positive material bridge; NOT SEPARATE PRINT'),output/'witnesses')]))
    screw=inserted['axial M4x12 socket screw 110.0'];nut=inserted['threaded M4 full nut 110.0'];host=inserted[r.LOCK_HALF]
    empty(nut.translate((0,0,4.6)),host,'Uncapped nut capture limit')
    nu_bound=m.old.radial(c.hexagon(7/math.sqrt(3),7.8,(38.,0,-2.9)),110.)
    point=m.old.xy(38.,110.);screw_bound=c.cyl(2.,16.6,(*point,-1.2))+c.cyl(3.5,8.6,(*point,6.8))
    for bound in (nu_bound,screw_bound):
        empty(bound,host,'Uncapped pair continuous capture motion blocked by A')
        empty(bound,inserted['removable padded knob cup'],'Uncapped pair blocked by cup')
    uncapped=dict(continuous_pair_float_checked=True,only_while_entire_module_outside=True,head_float_source_range_mm=[0.,4.6],head_seat=result[0]['head_seats'],nut_lower_capture=witness('uncapped M4 nut lower axial capture',nut.translate((0,0,4.61)),host),thread_pair_remains_engaged=True)
    u.unchanged(inserted,data['stages']['inserted']['components']);u.unchanged(seated,data['stages']['nuts-seated']['components'])
    u.unchanged({data['environment']['name']:bar},[data['environment']])
    for file,sha in paths.items():
        if hashlib.sha256(file.read_bytes()).hexdigest()!=sha:raise ValueError('Input changed')
    receipt=dict(schema=1,concept=data['concept'],variant='reduced-cover-B',actual_delivered_step_only=True,actual_subjects_reimport_unchanged=True,source_receipt=str(source.resolve()),source_receipt_sha256=paths[source.resolve()],input_files={str(f):sha for f,sha in paths.items()},fastener_contacts=result,positive_fixed_cup_bar_keys=cup_drive,positive_external_collar_joints=collar_joints,positive_capture_cover_joints=cover_joints,integral_cover_bridges=bridges,uncapped_M4_pair_capture=uncapped,scope='FINITE POSITIVE FASTENER/KEY CONTACT WITNESSES; NOT STRENGTH, ZERO BACKLASH OR LIFECYCLE PROOF',physical_strength_verified=False,lifecycle_verified=False)
    (output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print('ACTUAL POSITIVE CONTACT WITNESSES PASS',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();run(args.source,args.output)
