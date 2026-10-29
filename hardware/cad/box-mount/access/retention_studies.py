"""Private stock-hex retention candidates; no strength or adhesive certification."""
from __future__ import annotations

import argparse
from dataclasses import asdict
import hashlib
import json
import math
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import access_study as cad
from build123d import Align,Axis,Box,Compound,Cone,Cylinder,export_step,import_step

MIN_Z=(Align.CENTER,Align.CENTER,Align.MIN)


def box(x,y,z,at=(0,0,0)):
    return Box(x,y,z,align=MIN_Z).translate(at)


def cyl(r,h,at):
    return Cylinder(r,h,align=MIN_Z).translate(at)


def translate_xy(shape,xy):
    return shape.translate((xy[0],xy[1],0))


def flush_fastener(roof,retainer,xy,r=1.5,head_r=3.2,nut_af=6.,top_z=3.):
    """Proposed mating hardware envelopes. These are not selected screw standards."""
    hole=cyl(r+.2,15+top_z,(*xy,-11))
    head=Cone(r,head_r,2.4,align=MIN_Z).translate((*xy,top_z-2.4))
    pocket=translate_xy(cad.hex_prism(nut_af+.4,3,-10),xy)
    roof=roof-hole-head-pocket
    retainer=retainer-hole-head
    bolt=cyl(r,top_z+7.1,(*xy,-9.5))+head
    nut=translate_xy(cad.hex_prism(nut_af,2.6,-9.8),xy)-cyl(r+.05,4,(*xy,-10))
    driver=cyl(1.2,30,(*xy,top_z))
    return roof,retainer,[bolt,nut],driver


def make_study(kind,p,base,thickness=3.):
    roof=base['shell']
    retainers=[]
    hardware=[]
    tools=[]
    if kind=='R1-tape':
        retainers=[box(52,4,.3,(0,sign*17.5,0)) for sign in (-1,1)]
    elif kind=='R2-keeper-tabs':
        for sign in (-1,1):
            tab=box(8,25,thickness,(0,sign*28,0))
            roof,tab,fasteners,driver=flush_fastener(roof,tab,(0,sign*36),top_z=thickness)
            retainers.append(tab)
            hardware.extend(fasteners)
            tools.append(driver)
    elif kind=='R3-swing-clips':
        for sign in (-1,1):
            pivot=(sign*27,0)
            clip=box(11,6,thickness,(sign*21.5,0,0))+cyl(4,thickness,(*pivot,0))
            pivot_hole=cyl(2.2,14,(*pivot,-11))
            pivot_nut_pocket=translate_xy(cad.hex_prism(7.8,3.2,-10),pivot)
            roof=roof-pivot_hole-pivot_nut_pocket
            clip-=pivot_hole
            # Captured shoulder-pin envelope; actual hardware remains unselected.
            pin=cyl(2,thickness+9.9,(*pivot,-9.8))+cyl(3.5,.2,(*pivot,thickness+.1))
            nut=translate_xy(cad.hex_prism(7.4,2.8,-9.8),pivot)-cyl(2.05,4,(*pivot,-10))
            roof,clip,lock,driver=flush_fastener(roof,clip,(sign*22,0),r=1,head_r=2.3,nut_af=4.8,top_z=thickness)
            retainers.append(clip)
            hardware.extend([pin,nut,*lock])
            tools.append(driver)
    else:
        raise ValueError(f'Unknown retention study: {kind}')
    return dict(kind=kind,shell=roof,retainers=retainers,hardware=hardware,driver_paths=tools,thickness_mm=thickness)


def verify_study(p,base,study):
    host=dict(base,shell=study['shell'])
    cad.verify_stack(p,host)
    parts=[study['shell'],*study['retainers'],*study['hardware']]
    for part in parts:
        cad.require(part.is_valid and len(part.solids())==1 and part.volume>0,'Invalid retention component')
    for tab in study['retainers']:
        for obstruction in (study['shell'],base['spacer'],base['buffer'],base['stock_hex_keepout']):
            cad.empty_intersection(tab,obstruction,'Retainer interferes in seated state')
    for hardware in study['hardware']:
        for obstruction in (study['shell'],base['spacer'],base['buffer'],base['stock_hex_keepout']):
            cad.empty_intersection(hardware,obstruction,'Fastener envelope interferes in seated state')
    for first,second in zip(study['retainers'],reversed(study['retainers'])):
        if first is not second:
            cad.empty_intersection(first,second,'Retainers overlap')
    lifted_hex=base['stock_hex_keepout'].translate((0,0,.2))
    overlap=sum(cad.box_cad.volume(lifted_hex & tab) for tab in study['retainers'])
    cad.require(overlap>cad.EPS,'Retainer has no geometric overlap with rising stock hex')
    maximum=max(part.bounding_box().max.Z for part in [*study['retainers'],*study['hardware']])
    actor_minimum=p.bar_mouth_z-4.5
    cad.require(maximum<actor_minimum,'Retainer exceeds preliminary closed actor height boundary')
    for path in study['driver_paths']:
        for obstruction in (study['shell'],base['spacer'],base['buffer'],*study['retainers']):
            cad.empty_intersection(path,obstruction,'Nominal bar-off fastener driver path blocked')
    result=dict(stock_hex_rise_attempt_mm=.2,retainer_intersection_mm3=overlap,
                highest_fixed_retainer_z_mm=maximum,preliminary_rotating_actor_min_z_mm=actor_minimum,
                preliminary_vertical_gap_mm=actor_minimum-maximum,
                actual_latch_mesh_interference_verified=False,
                driver_paths_scope="box only; bar/baseplate/knob/harness omitted",installed_tool_access_verified=False,
                stock_hex_fit_or_strength_verified=False)
    if study['kind']=='R1-tape':
        result.update(adhesive_bond_verified=False,positive_mechanical_retention=False,
                      release='peel/replace consumable; no rigid peel-force model')
    elif study['kind']=='R2-keeper-tabs':
        for index,tab in enumerate(study['retainers']):
            head=study['hardware'][index*2]
            cad.require(cad.box_cad.volume(tab.translate((0,0,.1)) & head)>cad.EPS,'Keeper tab has no screw-head restraint')
            nut=study['hardware'][index*2+1]
            distance=nut.distance_to(study['shell'])
            cad.require(math.isclose(distance,.2,abs_tol=1e-6),'Keeper nut seating allowance changed')
            cad.require(cad.box_cad.volume(nut.translate((0,0,.3)) & study['shell'])>cad.EPS,'Keeper fastener nut has no upward roof reaction')
        # With spacer/buffer removed, independent tabs leave radially without
        # crossing the central body. This is maintenance, not routine bar release.
        for index,sign in enumerate((-1,1)):
            tab=study['retainers'][index]
            for distance in (1,5,10,20,40):
                moved=tab.translate((0,sign*distance,0))
                cad.empty_intersection(moved,study['shell'],'Keeper tab maintenance removal hits roof')
                cad.empty_intersection(moved,base['stock_hex_keepout'],'Keeper tab removal hits stock hex')
        result.update(positive_mechanical_retention_geometry=True,screw_head_restraint=True,
                      keeper_fastener_nut_seating_allowance_mm=.2,nut_up_attempt_mm=.3,nut_up_attempt_blocked=True,
                      maintenance='remove bar and any obstructing baseplate/spacer/buffer; remove keeper screws, withdraw tabs radially',
                      routine_bar_release_changes_keeper=False)
    else:
        for index,sign in enumerate((-1,1)):
            clip=study['retainers'][index]
            pin=study['hardware'][index*4]
            lock=study['hardware'][index*4+2]
            axis=Axis((sign*27,0,0),(0,0,1))
            attempted=clip.rotate(axis,sign*5)
            cad.require(cad.box_cad.volume(attempted & lock)>cad.EPS,'Closed clip can bypass its locking fastener')
            cad.require(cad.box_cad.volume(clip.translate((0,0,.2)) & pin)>cad.EPS,'Clip has no captive pivot restraint')
            for angle in (0,15,30,45,60,75,90):
                moved=clip.rotate(axis,sign*angle)
                for obstacle in (study['shell'],base['spacer'],base['buffer'],base['stock_hex_keepout'],pin):
                    cad.empty_intersection(moved,obstacle,'Unlocked clip swing blocked')
            # Conservative full-circle sweep contains the actual clip. It proves
            # clearance continuously, independently of the display samples.
            sweep=cad.ring(2.2,12,study['thickness_mm']).translate((sign*27,0,0))
            cad.require(cad.box_cad.volume(clip-sweep)<cad.EPS,'Clip exceeds continuous swing envelope')
            for obstacle in (study['shell'],base['spacer'],base['buffer'],base['stock_hex_keepout'],pin):
                cad.empty_intersection(sweep,obstacle,'Continuous clip swing envelope obstructed')
            opened=clip.rotate(axis,sign*90)
            for rise in (1,3,6,10):
                cad.empty_intersection(base['stock_hex_keepout'].translate((0,0,rise)),opened,'Open clip blocks stock-hex extraction')
        result.update(positive_mechanical_retention_geometry=True,locked_rotation_attempt_blocked=True,
                      captive_pivot_restraint=True,continuous_swing_envelope_clear=True,sampled_unlock_swing_degrees=[0,15,30,45,60,75,90],
                      release='remove independent lock fasteners, then swing clips90degrees; pivots stay captured')
    return result


def export_all(output):
    output.mkdir(parents=True,exist_ok=True)
    receipt_path=output/'receipt.json'
    receipt_path.unlink(missing_ok=True)
    p=cad.StackProposal(spacer_height=8,contact_outer_radius=45.5)
    base=cad.stack(p)
    report=dict(scope='PRIVATE_STOCK_HEX_RETENTION_STUDIES',print_readiness='NOT_READY',units='mm',
        parameters_proposed=asdict(p),stock_hex='existing part in flush top well; no added unit mounting nut',
        sources_sha256={path.name:hashlib.sha256(path.read_bytes()).hexdigest()
                        for path in (Path(__file__),Path(cad.__file__),Path(cad.box_cad.__file__))},studies={})
    for kind in ('R1-tape','R2-keeper-tabs','R3-swing-clips'):
        study=make_study(kind,p,base)
        checks=verify_study(p,base,study)
        directory=output/kind
        prints={'shell':study['shell'],**{f'retainer-{i}':part for i,part in enumerate(study['retainers'])}}
        exports={name:cad.export_part(part,directory/f'{name}-PRIVATE-PROPOSAL') for name,part in prints.items()}
        assembly=Compound(children=[*prints.values(),*study['hardware'],base['bottom'],base['spacer'],base['buffer']])
        path=directory/'assembly-PRIVATE-PROPOSAL.step'
        cad.require(export_step(assembly,path),'Retention assembly export failed')
        restored=import_step(path)
        cad.require(restored.is_valid and len(restored.solids())==len(assembly.solids()),'Retention assembly round trip invalid')
        cad.require(cad.box_cad.volume(assembly-restored)<cad.EPS,'Retention STEP assembly removed material')
        cad.require(cad.box_cad.volume(restored-assembly)<cad.EPS,'Retention STEP assembly added material')
        report['studies'][kind]=dict(checks=checks,exports=exports,
                                   assembly_step_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                                   assembly_step_roundtrip=True,consumable_envelopes_only=kind=='R1-tape')
    # Synthesis keeps two individually removable low keeper tabs and countersunk
    # hardware from R2. Tape bonding and the extra pivots/locks of R3 add no proven
    # benefit for an otherwise stationary stock hex.
    thin_p=cad.StackProposal(spacer_height=5,contact_outer_radius=45.5)
    thin_base=cad.stack(thin_p)
    thin=make_study('R2-keeper-tabs',thin_p,thin_base,thickness=1.)
    report['thin_packaging_comparison']=dict(bar_mouth_z_proposed_mm=6,tab_thickness_proposed_mm=1,
        checks=verify_study(thin_p,thin_base,thin),strength_verified=False,selected=False)
    report['simplest_final_private_candidate']=dict(base='R2-keeper-tabs',tab_thickness_proposed_mm=3,
        bar_mouth_z_proposed_mm=9,
        reason='two independent rigid keeper tabs, two flush-head fasteners; no tape bond or swing-pivot dependency',
        fit_strength_and_installed_control_clearance_verified=False)
    final=make_study('R2-keeper-tabs',p,base)
    final_path=output/'simplest-final-private'
    final_parts=dict(shell=final['shell'],bottom=base['bottom'],spacer=base['spacer'],buffer=base['buffer'],
                     keeper_tab_0=final['retainers'][0],keeper_tab_1=final['retainers'][1])
    final_records={name:cad.export_part(part,final_path/f'{name}-PRIVATE-PROPOSAL') for name,part in final_parts.items()}
    final_assembly=Compound(children=[*final_parts.values(),*final['hardware']])
    assembly_path=final_path/'assembly-PRIVATE-PROPOSAL.step'
    cad.require(export_step(final_assembly,assembly_path),'Final private assembly export failed')
    restored=import_step(assembly_path)
    cad.require(restored.is_valid and len(restored.solids())==10,'Final private assembly round trip invalid')
    cad.require(cad.box_cad.volume(final_assembly-restored)<cad.EPS,'Final assembly removed material')
    cad.require(cad.box_cad.volume(restored-final_assembly)<cad.EPS,'Final assembly added material')
    interface=dict(units='mm',roof_plane_z_mm=0,proposed_bar_mouth_z_mm=p.bar_mouth_z,
        source_to_box_matrix=[[1,0,0,0],[0,-1,0,0],[0,0,-1,p.bar_mouth_z],[0,0,0,1]],
        stock_hex_well=dict(across_flats_proposed_mm=p.hex_across_flats,depth_proposed_mm=p.hex_depth,
                           bearing_z_mm=-p.hex_depth,flush_top_z_mm=0,additional_unit_mounting_nut=False),
        keeper=dict(kind='two removable keeper tabs',height_proposed_mm=3,fastener_xy_mm=[[0,-36],[0,36]],
                    fastener_hardware='proposed flush-head screws and captured fastener nuts; thread fit unverified'),
        contact_annulus_proposed=dict(inner_radius_mm=p.contact_inner_radius,outer_radius_mm=p.contact_outer_radius,
                                      top_z_mm=p.bar_mouth_z,actual_bar_contact_verified=False),
        early_closed_actor_clearance=dict(source_positive_z_max_mm=4.5,physical_min_z_mm=p.bar_mouth_z-4.5,
                                         note='preliminary worker envelope, not validated actual mesh clearance'),
        installed_service_access='BLOCKED/UNVERIFIED: table, actual controls and support procedure still required',
        parts=final_records,source_sha256=report['sources_sha256'])
    interface_path=final_path/'interface.json'
    interface_path.write_text(json.dumps(interface,indent=2)+'\n')
    # Inspection-only CAD projections; no publishing and no synthetic component references.
    views={}
    top=Compound(children=[part.solids()[0] for part in [final['shell'],*final['retainers'],*final['hardware']]])
    for label,origin in (('top',(160,-240,300)),('inside',(160,-240,-300))):
        file=final_path/f'inspection-{label}.svg'
        views[file.name]=cad.box_cad.export_inspection(top,file,origin)
    report['simplest_final_private_candidate'].update(exports=final_records,
        assembly_step_sha256=hashlib.sha256(assembly_path.read_bytes()).hexdigest(),assembly_step_roundtrip=True,
        interface_sha256=hashlib.sha256(interface_path.read_bytes()).hexdigest(),inspection_svg_sha256=views)
    receipt_path.write_text(json.dumps(report,indent=2)+'\n')
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    export_all(args.output)
    print(args.output/'receipt.json')


if __name__=='__main__':
    main()
