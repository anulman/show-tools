"""Additional gates for the channel-preserving C2 candidate and unchanged base."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import math
from build123d import Axis, Compound, extrude, import_step
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.collections import List_TopoDS_Shape
from . import debond_collar as m

c=m.c
BASELINE_SHA='83886c072ce113015196fd621a74c663830b305d3989904e0873e9158d08251d'
COMPACT_SHA='29b85bff87c061eba9569b15b297d6f2109babcf30c14b96ff5576974282801b'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def pinned_receipt(path, expected):
    data=Path(path).read_bytes()
    if hashlib.sha256(data).hexdigest()!=expected:
        raise ValueError('Unexpected frozen receipt: '+str(path))
    return json.loads(data)


def equal(a,b,label):
    c.assert_empty(a-b,label+' lost material')
    c.assert_empty(b-a,label+' gained material')


def frozen_parts(report):
    result={}
    for record in report['review_components']:
        for kind in ('step','stl'):
            if digest(record[kind])!=record[kind+'_sha256']:
                raise ValueError('Frozen '+kind+' changed: '+record['name'])
        part=import_step(record['step'])
        if not part.is_valid or len(part.solids())!=1:
            raise ValueError('Invalid frozen STEP: '+record['name'])
        result[record['name']]=part.solids()[0]
    return result


def posed(part,gap):
    return part.solids()[0].rotate(Axis.X,180).rotate(Axis.Z,-90).translate((0,0,gap))


def source_channels(reference):
    """Independent oracle from original lumen walls, root plane and outer cylinder."""
    cylinders=[];planes=[]
    for face in reference.faces():
        surface=BRepAdaptor_Surface(face.wrapped)
        if surface.GetType()==GeomAbs_Cylinder:
            cylinder=surface.Cylinder();point=cylinder.Location();axis=cylinder.Axis().Direction()
            if abs(axis.Z())>1-1e-8:
                cylinders.append((point.X(),point.Y(),cylinder.Radius(),face.bounding_box().min.Z))
        elif surface.GetType()==GeomAbs_Plane:
            plane=surface.Plane()
            if abs(plane.Axis().Direction().Z())>1-1e-8:planes.append(plane.Location().Z())
    root=max(planes)
    if abs(root)>1e-8:raise ValueError('Original root plane changed')
    outer=max(radius for x,y,radius,_ in cylinders if abs(x)<1e-8 and abs(y)<1e-8)
    lateral=[item for item in cylinders if abs(item[0])>40 and abs(item[1])<1e-8]
    lumen_radius=min(item[2] for item in lateral)
    selected=[item for item in lateral if abs(item[2]-lumen_radius)<1e-8]
    result={}
    for x,y,radius,low in selected:
        label='+' if x>0 else '-'
        low=min(item[3] for item in selected if abs(item[0]-x)<1e-8)
        height=root-low
        envelope=c.cyl(radius,height,(x,y,(root+low)/2))
        profile=c.cyl(outer,height,(0,0,(root+low)/2))
        result[label]=dict(envelope=envelope,profile=profile,void=(envelope&profile)-reference,
                           center_xy_mm=[x,y],radius_mm=radius,low_source_z_mm=low,root_source_z_mm=root)
    if set(result)!={'+','-'}:raise ValueError('Incomplete original channel oracle')
    return result


def validate_channel_baseline(reference,claimed):
    oracle=source_channels(reference)
    if set(claimed)!=set(oracle):raise ValueError('Incomplete claimed channel baseline')
    for label,record in oracle.items():equal(claimed[label],record['void'],'Claimed source channel '+label)
    return oracle


def channel_boolean(kind,left,right):
    """Only a completed, valid native Boolean may establish empty material."""
    if left is None or right is None:raise ValueError("Missing channel Boolean input")
    if left.IsNull() or right.IsNull():raise ValueError("Null channel Boolean input")
    arguments=List_TopoDS_Shape();arguments.Append(left)
    tools=List_TopoDS_Shape();tools.Append(right)
    operation=kind();operation.SetArguments(arguments);operation.SetTools(tools)
    operation.SetNonDestructive(True);operation.SetFuzzyValue(0.)
    operation.Build()
    if not operation.IsDone():raise ValueError('Channel Boolean kernel failure: '+kind.__name__)
    result=operation.Shape()
    if result.IsNull():raise ValueError("Null channel Boolean result")
    if not BRepCheck_Analyzer(result).IsValid():raise ValueError('Invalid channel Boolean result')
    return result


def checked_channel_mass(properties):
    value=properties.Mass()
    if not math.isfinite(value) or value<0:raise ValueError('Invalid channel material mass')
    return value


def channel_material_volume(shape):
    if shape is None or shape.IsNull():raise ValueError('Missing channel volume shape')
    if not BRepCheck_Analyzer(shape).IsValid():raise ValueError('Invalid channel volume shape')
    properties=GProp_GProps();BRepGProp.VolumeProperties_s(shape,properties)
    return checked_channel_mass(properties)


def channel_hits(parts,oracle,reference,shift=0):
    """Equivalent to part intersection with the original empty lumen region.

    Intersect simple analytic cutters first, then measure material added to the
    original solid by the exact clipped-material difference. Every actor must
    contain exactly one valid solid; failed kernel operations are never empty.
    """
    for name,part in parts.items():
        if not part.is_valid or len(part.solids())!=1:
            raise ValueError('Expected one valid solid per channel actor: '+name)
    hits=[]
    for label,record in oracle.items():
        for name,part in parts.items():
            local=part.solids()[0].translate((0,0,-shift))
            if disjoint(local,record['envelope']):continue
            overlap=channel_boolean(BRepAlgoAPI_Common,local.wrapped,record['envelope'].wrapped)
            overlap=channel_boolean(BRepAlgoAPI_Common,overlap,record['profile'].wrapped)
            difference=channel_boolean(BRepAlgoAPI_Cut,overlap,reference.wrapped)
            amount=channel_material_volume(difference)
            if amount < -1e-5:raise ValueError('Negative channel Boolean material volume')
            if amount>1e-5:hits.append(dict(channel=label,part=name,volume_mm3=amount))
    return hits


def carrier_reactions(parts):
    receiver=parts['fixed receiver half A']+parts['fixed receiver half B']
    rows=[]
    for angle in m.CARRIER_ANGLES:
        head=m.old.radial(c.cyl(2.8,.1,(44.45,0,-7),'x')-c.cyl(1.9,.3,(44.45,0,-7),'x'),angle)
        nut=m.old.radial(c.cyl(2.6,.1,(40.05,0,-7),'x')-c.cyl(1.9,.3,(40.05,0,-7),'x'),angle)
        c.assert_empty(head-parts['full-height bar'],'Carrier head seat removed')
        c.assert_empty(nut-receiver,'Carrier nut reaction removed')
        rows.append(dict(angle_degrees=angle,head_backed_witness_mm3=head.volume,
                         nut_backed_witness_mm3=nut.volume,head_underface_radial_mm=44.5,
                         nut_outerface_radial_mm=39.9,receiver_innerface_radial_mm=40.,
                         nominal_nut_takeup_gap_mm=.1,
                         screw_tip_radial_mm=36.5,nut_innerface_radial_mm=37.5,
                         nominal_thread_beyond_nut_mm=1.,physical_preload_verified=False))
    return rows


def contact_witness(bar):
    ring=m.old.ring(44,45.5,-1,0)
    band=next(f for f in ring.faces() if abs(f.bounding_box().min.Z)<1e-7 and abs(f.bounding_box().max.Z)<1e-7)
    witnesses=[]
    area=0.
    for face in bar.faces():
        bb=face.bounding_box()
        if abs(bb.min.Z)<1e-7 and abs(bb.max.Z)<1e-7:
            for patch in (face&band).faces():
                witnesses.append(extrude(patch,amount=.1,dir=(0,0,1)))
                area+=patch.area
    if not witnesses:
        raise ValueError('No actual bar contact patches')
    result=witnesses[0]
    for shape in witnesses[1:]:result+=shape
    return result,area


def disjoint(a,b):
    aa,bb=a.bounding_box(),b.bounding_box()
    return any(getattr(aa.max,k)<=getattr(bb.min,k)+1e-7 or getattr(bb.max,k)<=getattr(aa.min,k)+1e-7 for k in ('X','Y','Z'))


def base_obstacles(report,oldparts,gap):
    record=report['assemblies'][str(gap)]
    if digest(record['step'])!=record['sha256']:
        raise ValueError('Frozen complete base assembly changed')
    assembly=import_step(record['step'])
    expected_count=66 if gap==5 else 67
    remaining=list(assembly.solids())
    if not assembly.is_valid or len(remaining)!=expected_count:
        raise ValueError('Invalid frozen complete base assembly')
    # Remove the exact 25 old C2 actors, leaving actual base prints, PTFE,
    # nominal stock hex, all base fasteners and contained ballast cubes.
    for name,part in oldparts.items():
        target=posed(part,gap);tb=target.bounding_box();matches=[]
        for index,body in enumerate(remaining):
            bb=body.bounding_box()
            if abs(body.volume-target.volume)>1e-3:continue
            if any(abs(getattr(bb.min,k)-getattr(tb.min,k))>1e-5 or abs(getattr(bb.max,k)-getattr(tb.max,k))>1e-5 for k in ('X','Y','Z')):continue
            if c.volume(body-target)<1e-5 and c.volume(target-body)<1e-5:matches.append(index)
        if len(matches)!=1:raise ValueError('Frozen assembly C2 identity mismatch: '+name)
        remaining.pop(matches[0])
    if len(remaining)!=(41 if gap==5 else 42):raise ValueError('Incomplete fixed base inventory')
    return remaining


def compact_gate(report,oldparts,states,tools,newbar):
    result={}
    for gap in (5,7):
        fixed=base_obstacles(report,oldparts,gap)
        print('ACTUAL FROZEN BASE',gap,len(fixed),'fixed solids',flush=True)
        # The central radius-33 shadow extends down to the well floor, so
        # a positive-Z withdrawal cannot enter an overhanging central part.
        bounds=[c.cyl(33,16,(0,0,-5)),m.old.ring(44,100,-13,gap)]
        for index,part in enumerate(fixed):
            bb=part.bounding_box()
            if bb.max.Z<=-13+1e-7:continue
            above=part&c.box(250,250,250,(0,0,112))
            captured=sum(c.volume(part&bound) for bound in bounds)
            if c.volume(above)-captured>1e-5:raise ValueError('Frozen base escapes invariant bounds '+str(index))
        minimum=math.inf
        for state,parts in states.items():
            for name,source in parts.items():
                actor=posed(source,gap);minimum=min(minimum,actor.bounding_box().min.Z)
                if actor.bounding_box().min.Z < -12.5-1e-6:raise ValueError('Actor below well floor clearance')
                for bound in bounds:c.assert_empty(actor&bound,'New actor enters compact invariant bound: '+name)
                for obstacle in fixed:
                    if not disjoint(actor,obstacle):c.assert_empty(actor&obstacle,'New actor hits actual fixed base: '+state+'/'+name)
        for name,source in tools:
            tool=posed(source,gap)
            for obstacle in fixed:
                if not disjoint(tool,obstacle):c.assert_empty(tool&obstacle,'Whole tool hits actual fixed base: '+name)
        oldcontact,oldarea=contact_witness(oldparts['full-height bar'])
        newcontact,newarea=contact_witness(newbar)
        equal(newcontact,oldcontact,'Actual selected bearing patches')
        baseparts=frozen_parts(report)
        sheet=baseparts['buffer'].translate((0,0,gap-5))
        support=baseparts['spacer'].translate((0,0,gap-5))
        witness=posed(newcontact,gap)
        c.assert_empty(witness-sheet,'Actual bar patch outside PTFE')
        c.assert_empty(witness.translate((0,0,-1))-support,'Actual bar patch lacks rigid support')
        tool_bottom=min(posed(s,gap).bounding_box().min.Z for _,s in tools)
        base_bottom=min(s.bounding_box().min.Z for s in fixed)
        if tool_bottom<base_bottom-180:raise ValueError('Whole tool staging exceeds proposed service lift')
        print('COMPACT BASE PASS',gap,flush=True)
        result[str(gap)]=dict(actual_fixed_solids=len(fixed),all_six_states_clear=True,
                               whole_tools_clear=True,rotation_invariant_bounds_pass=True,
                               continuous_positive_Z_withdrawal_clear=True,minimum_actor_to_well_floor_mm=minimum+13,
                               bearing_patch_area_mm2=newarea,original_bearing_area_mm2=oldarea,
                               actual_bearing_material_unchanged=True,minimum_service_lift_mm=base_bottom-tool_bottom,
                               proposed_service_lift_mm=180)
    return result


def bottom_entry(parts,voids):
    """Prove a connected geometric route from free below to original root faces."""
    moving={name:part for name,part in parts.items() if not name.startswith('preset / ')}
    high=math.ceil(max(part.bounding_box().max.Z for part in moving.values()))+1
    def area_at(shape,z):
        return sum(face.area for face in shape.faces()
                   if abs(face.bounding_box().min.Z-z)<1e-6 and abs(face.bounding_box().max.Z-z)<1e-6)
    result={}
    for label,void in voids.items():
        faces=[face for face in void.faces()
               if abs(face.bounding_box().min.Z)<1e-6 and abs(face.bounding_box().max.Z)<1e-6]
        if not faces:raise ValueError('Original root entry face missing')
        routes=[]
        for face in faces:
            residual=extrude(face,amount=high,dir=(0,0,1))
            for part in moving.values():
                if part.bounding_box().max.Z<=0 or residual is None:continue
                if c.volume(residual&part)>1e-7:residual-=part
            for solid in ([] if residual is None else residual.solids()):
                root_area=area_at(solid,0);free_area=area_at(solid,high)
                if root_area>1e-6 and free_area>1e-6:
                    routes.append(dict(open_root_area_mm2=root_area,free_bottom_area_mm2=free_area,
                                       connected_void_volume_mm3=solid.volume))
        if not routes:raise ValueError('No connected bottom entry: '+label)
        result[label]=dict(original_root_entry_area_mm2=sum(face.area for face in faces),
                           free_bottom_plane_source_z_mm=high,connected_routes=routes)
    return result


def verify(reference,locked,pose,baseline_path,compact_path):
    baseline=pinned_receipt(baseline_path,BASELINE_SHA)
    compact=pinned_receipt(compact_path,COMPACT_SHA)
    oldparts=frozen_parts(baseline)
    if len(locked.parts)!=25 or len({q.name for q in locked.parts})!=25:
        raise ValueError('Incomplete candidate component inventory')
    if any(not q.shape.is_valid or len(q.shape.solids())!=1 for q in locked.parts):
        raise ValueError('Candidate actor is not one valid solid')
    pieces={q.name:q.shape.solids()[0] for q in locked.parts}
    expected=set(oldparts)
    for angle in (0,120,240):
        expected.remove('M3x8 carrier button screw '+str(angle))
        expected.remove('M3 carrier nut '+str(angle))
    for angle in m.CARRIER_ANGLES:
        expected.add('M3x8 carrier button screw '+str(angle))
        expected.add('M3 carrier nut '+str(angle))
    if set(pieces)!=expected:raise ValueError('Unexpected candidate component inventory')
    # Reconstructing the historical layout without restoration must reproduce
    # its actual exports, before any candidate layout is trusted.
    reproduced=m.build(reference,carrier_angles=(0,120,240),preserve_channels=False)
    for part in reproduced.parts:equal(part.shape,oldparts[part.name],'Historical reconstruction '+part.name)
    voids=m.original_channel_voids(reference)
    oracle=validate_channel_baseline(reference,voids)
    # A producer cannot shrink its claimed baseline to hide part of a passage.
    narrowed={label:(void&c.box(200,100,200,(0,50,-50))) for label,void in voids.items()}
    try:validate_channel_baseline(reference,narrowed)
    except ValueError as error:
        if 'Claimed source channel' not in str(error):raise
    else:raise ValueError('Narrowed producer baseline accepted')
    voids={label:record['void'] for label,record in oracle.items()}
    # One positive actual counterexample per channel is enough to reject the
    # old design; no claim about other old zero-volume pairs is needed.
    old_receivers={name:part for name,part in oldparts.items() if name.startswith('fixed receiver half ')}
    oldhits=channel_hits(old_receivers,oracle,reference)
    if {row['channel'] for row in oldhits}!={'+','-'}:raise ValueError('Old obstruction control did not fail both channels')
    print('CHANNEL ORACLE AND OLD COUNTEREXAMPLES PASS',flush=True)
    expected_states={'locked','screw-clear','screw-captive-stop','collar-midway','released','detached'}
    if set(m.STATES)!=expected_states:raise ValueError('Incomplete candidate state inventory')
    states={}
    for state,(angle,travel,lift) in m.STATES.items():
        stateparts={q.name:q.shape.solids()[0] for q in pose(locked,state,angle,travel,lift).parts}
        if channel_hits(stateparts,oracle,reference,lift):raise ValueError('New state occupies original debond void: '+state)
        if any(not p.is_valid for p in stateparts.values()):raise ValueError('Invalid posed state')
        states[state]=stateparts
    print('ALL SIX SOURCE CHANNEL STATES PASS',flush=True)
    blocked=dict(pieces, synthetic_bottom_cap=c.cyl(60,1,(0,0,1.5)))
    try:bottom_entry(blocked,voids)
    except ValueError as error:
        if 'No connected bottom entry' not in str(error):raise
    else:raise ValueError('Blocked bottom-entry control accepted')
    mutant=dict(pieces)
    protrusion=c.box(3,1,1,(-37.8,0,-4))
    mutant['full-height bar']=pieces['full-height bar']+protrusion
    if not mutant['full-height bar'].is_valid or len(mutant['full-height bar'].solids())!=1:
        raise ValueError('Channel mutation must be one connected valid solid')
    if not channel_hits(mutant,oracle,reference):raise ValueError('Blocked channel control accepted')
    satellite=c.box(1,1,1,(-39,0,-4))
    for children in ([pieces['full-height bar'],satellite],[satellite,pieces['full-height bar']]):
        disconnected=dict(pieces)
        disconnected['full-height bar']=Compound(children=children)
        try:channel_hits(disconnected,oracle,reference)
        except ValueError as error:
            if 'Expected one valid solid per channel actor' not in str(error):raise
        else:raise ValueError('Disconnected channel actor accepted')
    entry={state:bottom_entry(states[state],voids) for state in ('locked','released')}
    print('CONNECTED BOTTOM ENTRY AND NEGATIVE CONTROLS PASS',flush=True)
    for angle in m.CARRIER_ANGLES:
        for prefix,point in [('M3x8 carrier button screw ',(44.5,0,-7)),('M3 carrier nut ',(38.7,0,-7))]:
            actual=pieces[prefix+str(angle)]
            nominal=m.button_screw(point) if 'screw' in prefix else m.nut(point,'x')
            equal(actual,m.old.radial(nominal,angle),'Uncut purchased carrier hardware')
    changed={'full-height bar','fixed receiver half A','fixed receiver half B'}
    for name,part in pieces.items():
        if name in changed or name.startswith(('M3x8 carrier button screw ','M3 carrier nut ')):continue
        equal(part,oldparts[name],'Unchanged source component '+name)
    tools=m.control_sweeps()
    expected_tools={'2.5 mm lock key operating envelope','2.5 mm lock key full axial staging',
                    '4 mm collar key operating quarter arc','4 mm collar key full axial staging'}
    if {name for name,_ in tools}!=expected_tools:raise ValueError('Incomplete whole tool inventory')
    forbidden=c.box(400,400,200,(0,0,-100))
    for name,tool in tools:c.assert_empty(tool&forbidden,'Routine tool requires above-lip access: '+name)
    return dict(original_void_volumes_mm3={k:v.volume for k,v in voids.items()},old_C2_receiver_counterexamples=oldhits,
                original_voids_clear_all_six_states=True,actual_purchased_hardware_uncut=True,
                connected_bottom_entry_cup_absent=entry,blocked_channel_and_bottom_entry_controls_rejected=True,producer_narrowed_baseline_rejected=True,channel_native_IsDone_and_validity_required=True,channel_fuzzy_tolerance_mm=0.,disconnected_actor_both_orders_rejected=True,
                unchanged_components_and_tools_preserved=True,carrier_reactions=carrier_reactions(pieces),
                routine_tools_below_root_min_mm=min(t.bounding_box().min.Z for _,t in tools),
                compact_base=compact_gate(compact,oldparts,states,tools,pieces['full-height bar']),
                baseline_receipt_sha256=BASELINE_SHA,compact_receipt_sha256=COMPACT_SHA,
                no_flow_threshold_or_solvent_compatibility_claim=True)
