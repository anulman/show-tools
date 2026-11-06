"""Continuous C root insertion, turn, seating and threaded release on actual STEP solids."""
from __future__ import annotations
from copy import deepcopy
import argparse,hashlib,importlib,json,math,sys
from pathlib import Path
from build123d import Axis,Compound,import_step
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
r=importlib.import_module('disco-bar.reduced_c')
u=importlib.import_module('disco-bar.reduced_c_subjects')
BODY_NAMES={r.LOCK_HALF,r.FUSED_HALF}
m=importlib.import_module('disco-bar.post_glue_couplings');c=m.c;a=m.channels
p=importlib.import_module('disco-bar.check_couplings')
v=importlib.import_module('disco-bar.check_post_glue_candidates')
ENTRY,END,JOINT_R=110.,145.,37.2


def collar_axial(extra,margin=0.):
    negative=m.old.ring(33.5-margin,35.+margin,-9.5-margin,-6.1+extra+margin)
    for start,end in ((35.,112.),(205.,285.)):negative+=m.sector(34.5-margin,39.5+margin,-9.5-margin,-6.1+extra+margin,start-.02,end+.02)
    for angle in (35.,50.,220.):negative+=m.old.radial(c.box(5.+2*margin,6.+2*margin,2.+extra+2*margin,(41.,0,-8.+extra/2)),angle)
    for angle in (90.,215.,275.):negative+=m.sector(37.-margin,39.5+margin,-6.1-margin,1.+extra+margin,angle-3-.02,angle+3+.02)
    negative-=m.sector(33.4,44.,-12.,60.,134.02,155.98)
    return negative+m.old.ring(33.5-margin,43.7+margin,1.-margin,11.5+extra+margin)


def cup_axial(extra,margin=.01):
    shape=c.cyl(33.+margin,28.4875+extra+2*margin,(0,0,(-25.4875+extra)/2))
    races=m.old.ring(32.5-margin,35.5+margin,-11.-margin,-9.5+extra+margin)+m.old.ring(32.5-margin,35.5+margin,-5.-margin,-3.5+extra+margin)
    races-=m.sector(33.,44.,-12.,60.,100.02,164.98)
    shape+=races
    for angle in (60.,240.):shape+=m.old.radial(c.box(11.+2*margin,5.+2*margin,4.+extra+2*margin,(37.5,0,-18.+extra/2)),angle)
    return shape


def arc_tube(radius,profile_radius,low,high,start,end):
    shape=m.sector(radius-profile_radius,radius+profile_radius,low,high,start,end)
    for angle in (start,end):shape+=c.cyl(profile_radius,high-low,(*m.old.xy(radius,angle),(low+high)/2))
    return shape


def run(source,output):
    output.mkdir(parents=True,exist_ok=True);(output/'receipt.json').unlink(missing_ok=True)
    paths={Path(f).resolve():hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in (__file__,r.__file__,u.__file__,m.__file__,c.__file__,a.__file__,p.__file__,v.__file__)}
    paths[source.resolve()]=hashlib.sha256(source.read_bytes()).hexdigest();data=json.loads(source.read_text())
    if data['concept']!='post-glue C':raise ValueError('C only')
    def load(record):
        for kind in ('step','stl'):
            file=Path(record[kind]);sha=hashlib.sha256(file.read_bytes()).hexdigest()
            if sha!=record[kind+'_sha256']:raise ValueError('Artifact changed')
            paths[file.resolve()]=sha
        shape=import_step(record['step'])
        if not shape.is_valid or len(shape.solids())!=1:raise ValueError('Invalid actual solid')
        return shape.solids()[0]
    def op(kind,left,right):return a.channel_boolean(kind,left.wrapped,right.wrapped)
    def empty(left,right,label,kind=a.BRepAlgoAPI_Common):
        amount=a.channel_material_volume(op(kind,left,right))
        if amount>1e-5:raise ValueError(label+': '+str(amount))
        return amount
    def contains(part,bound,label):return empty(part,bound,label,a.BRepAlgoAPI_Cut)
    bar=load(data['environment']);initial={q['name']:load(q) for q in data['stages']['inserted']['components']};turned={q['name']:load(q) for q in data['stages']['turned']['components']}
    if 'axial M4x12 socket screw '+str(ENTRY) not in initial:raise ValueError('Unexpected C layout')
    for stage in data['stages'].values():
        if stage['source_pose'].get('collar_shift')!=-.5:raise ValueError('Upper stop required')
    records=[]
    def evidence(label,actors,bound,method,obstacles=None):
        if not bound.is_valid:raise ValueError('Invalid continuous bound '+label)
        for name,obstacle in (obstacles or {'glued bar':bar}).items():empty(bound,obstacle,label+' blocked by '+name)
        exports=[v.export_piece(c.Piece(label+' '+str(i),deepcopy(solid),'continuous analytic motion bound'),output/'bounds') for i,solid in enumerate(bound.solids())]
        records.append(dict(id=label,moving_parts=actors,method=method,components=exports,native_common_mm3=0.,proof_authority='Hash-bound checker recomputes analytic in-memory bounds, matches actual input STEP solids and runs strict native predicates. Bound STEP/STL exports are inspection aids; recorded source/export identity INCONCLUSIVE is not changed to PASS.'))
    # Full insertion/reverse uses exact translated primitive unions, with actual STEP containment.
    fixed=['removable padded knob cup']+[name for name in initial if name.startswith(('-1','+1'))]
    cup=cup_axial(0.)
    for name in fixed:contains(initial[name],cup,'Fixed module outside matched cup/key decomposition '+name)
    evidence('complete fixed cup axial entry and reverse',fixed,cup_axial(50.),'Cylinder, notched race profiles and exact key boxes Minkowski-summed with +Z50mm segment; every actual fixed actor contained.')
    for name,part in initial.items():
        if name in fixed:continue
        if name in BODY_NAMES:
            contains(part,collar_axial(0.,.01),'Collar outside matched entry decomposition')
            bound=collar_axial(50.,.01)
        elif name.startswith('threaded M4 full nut'):
            point=m.old.xy(38.,ENTRY);bound=c.cyl(7/math.sqrt(3),53.2,(*point,19.8))
        elif name.startswith('axial M4x12 socket screw'):
            point=m.old.xy(38.,ENTRY);bound=c.cyl(2.,62.,(*point,21.5))+c.cyl(3.5,54.,(*point,29.5))
        elif name.startswith('external collar M2'):
            joint=float(name.rsplit(' ',1)[1]);bound=m.sector(34.8,39.7,-10.1,45.9,joint-9,joint+9)
        else:
            low=part.bounding_box().min.Z;high=part.bounding_box().max.Z+50.
            if low<1.-1e-6:raise ValueError('Unexpected below-root actor '+name)
            bound=m.old.ring(33.5,44.,low,high)
        contains(part,bound,'Actual actor outside insertion bound '+name);contains(part.translate((0,0,50)),bound,'Outside endpoint not contained')
        evidence(name+' axial entry and reverse',[name],bound,'Matched primitive translated through complete +Z0..50mm segment; exact profiles/annuli are conservative outer material bounds.')
    # Whole 35 degree turn. All below-root radial/height profiles are explicit.
    half_turn=m.old.ring(33.49,35.01,-9.51,-6.09)+m.old.ring(33.49,43.71,.99,11.51)
    for start,end in ((35.,147.),(205.,320.)):half_turn+=m.sector(34.49,39.51,-9.51,-6.09,start-.02,end+.02)
    lug_half=math.degrees(math.atan2(3.,38.5));lug_outer=math.hypot(43.5,3.)
    for angle in (35.,50.,220.):half_turn+=m.sector(38.49,lug_outer+.01,-9.01,-6.99,angle-lug_half-.02,angle+35.+lug_half+.02)
    for angle in (90.,215.,275.):half_turn+=m.sector(36.99,39.51,-6.11,1.01,angle-3.02,angle+38.02)
    fixed_host=c.cyl(33.001,28.511,(0,0,-12.7545))+m.old.ring(32.5,35.501,-11.,-9.5)+m.old.ring(32.5,35.501,-5.,-3.5)
    fixed_all=fixed_host
    for key_angle in (60.,240.):fixed_all+=m.old.radial(c.box(11.02,5.02,4.02,(37.5,0,-18.)),key_angle)
    for fixed_name in fixed:contains(initial[fixed_name],fixed_all,'Fixed actual actor outside axisymmetric host and known separated keys')
    internal_rotation=[]
    for name,part in initial.items():
        if name in fixed:continue
        if not name.startswith('threaded M4 full nut'):
            empty(part,fixed_host,'Actual initial rotor/fixed axisymmetric host')
            if part.bounding_box().min.Z< -9.500001:raise ValueError('Moving actor can reach fixed cup keys')
            internal_rotation.append(dict(actor=name,method='Strict native actual actor vs axisymmetric fixed host is empty. Global Z rotation preserves this intersection at every angle. Fixed cup keys endatZ-16, below all moving actors.'))
        if name in BODY_NAMES:
            bound=half_turn
            contains(part,bound,'Actual initial collar outside full turn bound');contains(turned[name],bound,'Actual turned collar outside full turn bound')
            evidence(name+' full 35 degree turn and reverse',[name],bound,'Actual matched ring/lobe/lug/pad/stem profiles swept continuously through angular intervals enlarged by corner atan2 bounds.',{'glued bar':bar})
        elif name.startswith('threaded M4 full nut'):
            radius=7/math.sqrt(3);spread=math.degrees(math.atan2(radius,38.-radius))
            bound=m.sector(38.-radius,38.+radius,-6.8,-3.1,ENTRY-spread,END+spread)
            contains(part,bound,'Nut outside angular bound');contains(turned[name],bound,'Turned nut outside angular bound');contains(part.translate((0,0,.5)),bound,'Floating initial nut outside angular bound');contains(turned[name].translate((0,0,.5)),bound,'Floating turned nut outside angular bound')
            evidence(name+' full 35 degree turn and reverse',[name],bound,'Circumradius and atan2 bound for every point of the rotating hex nut; fixed cup notch covers entire angular/height interval.',{'glued bar':bar,'actual fixed cup':initial['removable padded knob cup']})
        elif name.startswith('axial M4x12 socket screw'):
            bound=arc_tube(38.,2.,-9.5,3.,ENTRY,END)+m.sector(34.5,41.5,2.5,7.,ENTRY-6,END+6)
            contains(part,bound,'Screw outside angular tube');contains(turned[name],bound,'Turned screw outside angular tube');contains(part.translate((0,0,.5)),bound,'Floating initial screw outside angular tube');contains(turned[name].translate((0,0,.5)),bound,'Floating turned screw outside angular tube')
            evidence(name+' full 35 degree turn and reverse',[name],bound,'Exact circular-shaft arc Minkowski tube plus conservative above-root head sector.',{'glued bar':bar})
        elif name.startswith('external collar M2'):
            # Radius/Z are invariant under rigid global Z rotation. Full race rings are stricter than actual notched cup.
            empty(part,fixed_host,'M2 fixed cup axial symmetry check')
            joint=float(name.rsplit(' ',1)[1]);bound=m.sector(34.8,39.7,-10.1,-5.4,joint-9,joint+44)
            contains(part,bound,'M2 outside radial/Z rotation invariant');contains(turned[name],bound,'Turned M2 outside radial/Z invariant')
            evidence(name+' full 35 degree turn and reverse',[name],bound,'Every point remains R<39.7 at unchanged Z; no root lip intersection. Full axisymmetric fixed cup/races clear nominal actual M2 solid, so all angles clear them.')
        else:
            low=part.bounding_box().min.Z;high=part.bounding_box().max.Z
            bound=m.old.ring(33.5,44.,low,high);contains(part,bound,'Above-root actor outside R/Z turn bound')
            evidence(name+' full 35 degree turn and reverse',[name],bound,'All-angle radius and positive source-Z bound; Each actual actor stays R>=33.5; fixed cup/grip withinR33 above sourceZ-3.5, and bar maxsourceZ0. Fixed torque keys endatZ-16, below every moving actor.')
    # Cup/collar move +Z2.1 while nuts seat, then reverse while each screw makes three RH turns.
    evidence('fixed cup seating and clamp translation',fixed,cup_axial(2.1),'Complete 2.1mm axial Minkowski sum, same reverse path; fixed torque keys remain in their original axial slots.')
    for name,part in turned.items():
        if name in fixed:continue
        if name in BODY_NAMES:bound=collar_axial(2.1,.01).rotate(Axis.Z,35.)
        elif name.startswith('threaded M4 full nut'):bound=m.old.radial(c.hexagon(7/math.sqrt(3),5.3,(38.,0,-4.15)),END)
        elif name.startswith('axial M4x12 socket screw'):
            point=m.old.xy(38.,END);bound=c.cyl(2.,14.1,(*point,-2.45))+c.cyl(3.5,6.1,(*point,5.55))
        elif name.startswith('external collar M2'):
            joint=float(name.rsplit(' ',1)[1])+35.;bound=m.sector(34.8,39.7,-10.1,-3.3,joint-9,joint+9)
        else:
            low=part.bounding_box().min.Z;high=part.bounding_box().max.Z+2.1
            bound=m.old.ring(33.5,44.,low,high)
        contains(part,bound,'Seating origin outside bound');contains(part.translate((0,0,2.1)),bound,'Seating end outside bound')
        evidence(name+' continuous seating clamp and reverse',[name],bound,'Complete 2.1mm axial interval. M4 circular shaft/head outer regions bound all three RH turns; the nut is seated at a fixed bar-relative end during clamp.')
    nut_name='threaded M4 full nut '+str(ENTRY);nut_bound=m.old.radial(c.hexagon(7/math.sqrt(3),5.3,(38.,0,-4.15)),END)
    evidence('M4 nut relative module thread travel',[nut_name],nut_bound,'Nut 2.1mm translation relative module; matching M4 screw is the only licensed thread contact.',{name:part for name,part in turned.items() if name not in {nut_name,'axial M4x12 socket screw '+str(ENTRY)}})
    u.unchanged(initial,data['stages']['inserted']['components']);u.unchanged(turned,data['stages']['turned']['components'])
    u.unchanged({data['environment']['name']:bar},[data['environment']])
    for file,sha in paths.items():
        if hashlib.sha256(file.read_bytes()).hexdigest()!=sha:raise ValueError('Input changed during root proof')
    result=dict(schema=1,concept=data['concept'],variant='reduced-cover-B',actual_delivered_step_only=True,actual_subjects_reimport_unchanged=True,source_receipt=str(source.resolve()),source_receipt_sha256=paths[source.resolve()],input_files={str(f):sha for f,sha in paths.items()},evidence=records,internal_rotation_invariance=internal_rotation,bar_proof_outer_margin_mm=.01,continuous_root_geometry_verified=True,root_entry_and_reverse_mm=[0.,50.],collar_turn_and_reverse_deg=[0.,35.],seating_and_reverse_mm=[0.,2.1],RH_thread_turns=3,requires_upper_stop_delta_mm=-.5,head_float_during_turn_source_mm=[0.,.5],requires_head_seated_before_seating_and_clamp=True,requires_bottomed_4mm_key_to_hold_upper_stop_during_turn=True,loose_state_turn_verified=False,base_tool_integration_verified=False,lifecycle_verified=False,physical_fit_verified=False)
    (output/'receipt.json').write_text(json.dumps(result,indent=2)+'\n');print('ACTUAL C CONTINUOUS ROOT MOTION PASS',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();run(args.source,args.output)
