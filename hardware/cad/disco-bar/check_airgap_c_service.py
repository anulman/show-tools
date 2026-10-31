"""Continuous serial ordinary-key recovery with the ball held in the other hand."""
from __future__ import annotations
import argparse,hashlib,importlib,json,math,sys
from copy import deepcopy
from pathlib import Path
from build123d import Axis,Compound,import_step
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
e=importlib.import_module('disco-bar.check_reduced_c_external')
u=e.u;m=e.m;c=e.c;a=e.a;v=importlib.import_module('disco-bar.check_post_glue_candidates')


def axial_bounds(angle,af,extra):
    """Exact cylindrical/prismatic outer sums; all coordinates in cup source frame."""
    point=m.old.xy(38. if af==3 else 38.5,angle)
    if af==3:
        # Ordinary AF3: 3mm working hex, 123mm stem, 20mm return arm.
        operation=c.cyl(2.,126.+extra,(*point,67.5+extra/2))
        operation+=c.cyl(22.,4.+extra,(*point,128.5+extra/2))
        entry=c.hexagon(3/math.sqrt(3),103.+extra,(*point,56.+extra/2)).rotate(Axis((*point,0),(0,0,1)),35.)
        entry+=c.cyl(2.,223.+extra,(*point,119.+extra/2))
        entry+=c.cyl(22.,104.+extra,(*point,178.5+extra/2))
    else:
        operation=c.hexagon(4/math.sqrt(3),7.+extra,(*point,8.+extra/2)).rotate(Axis((*point,0),(0,0,1)),angle-260.)
        operation+=c.cyl(3.,133.+extra,(*point,78.+extra/2))
        operation+=c.cyl(28.,5.+extra,(*point,142.+extra/2))
        entry=c.hexagon(4/math.sqrt(3),107.+extra,(*point,58.+extra/2)).rotate(Axis((*point,0),(0,0,1)),angle-260.)
        entry+=c.cyl(3.,233.+extra,(*point,128.+extra/2))
        entry+=c.cyl(28.,105.+extra,(*point,192.+extra/2))
    return dict(entry=entry,operation=operation,withdrawal=entry)


def actual4(angle):
    if angle!=260.:return actual4(260.).rotate(Axis.Z,angle-260.)
    point=m.old.xy(38.5,angle)
    tool=c.hexagon(4/math.sqrt(3),7.,(*point,8.))
    tool+=c.cyl(3.,133.,(*point,78.))
    tool+=c.cyl(2.5,25.,(point[0]+12.5,point[1],142.),'x')
    return tool


def run(source,output):
    if output.exists():raise ValueError('Use a fresh serial service namespace')
    output.mkdir(parents=True);raw=source.read_bytes();data=json.loads(raw)
    paths={str(source.resolve()):hashlib.sha256(raw).hexdigest()}
    for module in (sys.modules[__name__],e,u,m,c,a,v):paths[str(Path(module.__file__).resolve())]=hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest()
    def load(record):
        for kind in ('step','stl'):
            path=Path(record[kind]);sha=hashlib.sha256(path.read_bytes()).hexdigest()
            if sha!=record[kind+'_sha256']:raise ValueError('Changed actual artifact')
            paths[str(path.resolve())]=sha
        shape=import_step(record['step'])
        if not shape.is_valid or len(shape.solids())!=1:raise ValueError('Invalid actual solid')
        return shape.solids()[0]
    def volume(kind,left,right):return a.channel_material_volume(a.channel_boolean(kind,deepcopy(left).wrapped,deepcopy(right).wrapped))
    def empty(left,right,label):
        value=volume(a.BRepAlgoAPI_Common,left,right)
        if value>1e-5:raise ValueError(label+': '+str(value))
    def contains(part,bound,label):
        if volume(a.BRepAlgoAPI_Cut,part,bound)>1e-5:raise ValueError(label)
    bar=load(data['environment']);records=[];snapshots=[]
    for stage,drive in (('inserted',260.),('turned',295.)):
        rows=data['stages'][stage]['components'];parts={q['name']:load(q) for q in rows};snapshots.append((parts,rows))
        fixed={n:s for n,s in parts.items() if n=='removable padded knob cup' or n.startswith(('-1','+1'))}
        moving={n:s for n,s in parts.items() if n not in fixed}
        cases=[(4,drive,1.1,0.)]
        if stage=='turned':cases.append((3,145.,1.6,.5))
        for af,angle,total,relative in cases:
            original=e.key3(angle,head_shift=-.7) if af==3 else actual4(angle)
            relative_bounds=axial_bounds(angle,af,relative);world=axial_bounds(angle,af,total)
            outputs={};contacts=[]
            targets={n:s for n,s in moving.items() if (n.startswith('axial M4x12 socket screw') if af==3 else n in e.BODY_NAMES)}
            for name,target in targets.items():
                empty(original,target,'Actual ordinary key nominal socket collision '+name)
                hit=a.channel_boolean(a.BRepAlgoAPI_Common,deepcopy(original.translate((0,0,-.01))).wrapped,deepcopy(target).wrapped)
                amount=a.channel_material_volume(hit)
                if amount>1e-5:
                    contacts.extend(v.export_piece(c.Piece(f'{stage} AF{af} floor contact {len(contacts)}',deepcopy(solid),'positive overtravel witness only'),output/'contacts') for solid in Compound(hit).solids())
            if not contacts:raise ValueError('No actual socket floor for key recovery')
            for phase,bound in world.items():
                contains(original,bound,'Ordinary key not contained at nominal floor')
                contains(original.translate((0,0,total)),bound,'Ordinary key not contained at released extreme')
                if phase!='operation':contains(original.translate((0,0,100.+total)),bound,'Whole withdrawn key not contained')
                for name,solid in dict(fixed,**{'bare glued bar':bar}).items():empty(bound,solid,f'{stage} AF{af} {phase} fixed collision '+name)
                for name,solid in moving.items():
                    if af==3 and name.startswith('axial M4x12 socket screw'):continue
                    empty(relative_bounds[phase],solid,f'{stage} AF{af} {phase} relative collar collision '+name)
                outputs[phase]=[v.export_piece(c.Piece(f'{stage} AF{af} serial recovery {phase} {i}',deepcopy(solid),'cup-fixed source continuous full-key bound'),output/'bounds') for i,solid in enumerate(bound.solids())]
            records.append(dict(id=f'{stage} AF{af} serial recovery',tool_name=f'{af} mm hex key',tool_part='Wera 950 L '+('05021615001' if af==3 else '05021620001'),stage=stage,axis_source=dict(point=[*m.old.xy(38. if af==3 else 38.5,angle),4.5],direction=[0,0,-1]),coordinate_frame='cup-fixed source; pose at nominal air-gap mouth, not lifted bar mouth',collar_recovery_mm=1.1,head_recovery_mm=.5 if af==3 else 0.,fixed_frame_additional_axial_range_mm=[0.,total],collar_relative_additional_axial_range_mm=[0.,relative],phases=outputs,socket_floor_contacts=contacts,nominal_key_socket_clear=True,whole_actual_key_contained=True,fixed_and_relative_frames_native_clear=True,withdrawal_rule='Key retreat is at least collar following travel; collar follows at most1.1mm to its captured lower stop. Relative key motion is withdrawal only. Reverse insertion first seats head if AF3, then recovers upper stop.',contact_authority='Exact old floor/seat and race witnesses plus the new continuous clearance bounds; target AF3 socket contact is licensed, not a missing collision check'))
    for parts,rows in snapshots:u.unchanged(parts,rows)
    u.unchanged({data['environment']['name']:bar},[data['environment']])
    for path,sha in paths.items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=sha:raise ValueError('Changed service input')
    report=dict(schema=1,variant='air-gap-C-serial-service',source_receipt_sha256=paths[str(source.resolve())],input_files=paths,actual_subjects_reimport_unchanged=True,actual_delivered_step_only=True,serial_key_recovery_verified=True,requires_other_hand_on_ball=True,simultaneous_keys_permitted=False,requires_upper_stop_before_rotation=True,requires_head_seated_before_seating_and_clamp=True,base_integration_verified=False,physical_fit_verified=False,root_tool_operations=records)
    (output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print('AIRGAP SERIAL FULL-KEY RECOVERY PASS',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('source','output'):parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args();run(args.source,args.output)
