"""Isolated arcade proposal with original low/front and elevated high/back outlets."""
from __future__ import annotations
import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import buffer_ear_trial as ear
from build123d import Axis,Compound,export_step,import_step
base=ear.base
r=base.r
cad=base.cad
audit=base.audit
BRIDGE_BOTTOM_ABOVE_FLOOR=22.
BRIDGE_THICKNESS=2.
REAR_OUTLET_BOTTOM_ABOVE_FLOOR=26.5


def inputs_unchanged(data):
    data['snapshot'].unchanged()
    audit.require(data['producer']==data['snapshot'].parse(),'Parsed base differs from captured bytes')
    for path,sha in data['sources'].items():
        audit.require(audit.digest(Path(path))==sha,'Dual-exit source changed: '+path)
    data['artifacts'].unchanged()
    data['snapshot'].unchanged()


def prepare(receipt):
    paths=(*ear.SOURCE_PATHS.values(),Path(ear.__file__).resolve(),Path(__file__).resolve())
    sources={str(path):audit.digest(path) for path in paths}
    snapshot=ear.ReceiptSnapshot.capture(receipt);producer=snapshot.parse()
    audit.require(producer['concept'].endswith('-arcade-inclined'),'Expected arcade source')
    audit.require(producer['independent_base_geometry_checks_pass'] is True,'Failed arcade source')
    ear.source_files_match(producer)
    artifacts=audit.Artifacts()
    data=dict(snapshot=snapshot,producer=producer,sources=sources,artifacts=artifacts)
    inputs_unchanged(data)
    candidate=base.build('arcade-inclined');parts=candidate['parts'];p=candidate['box']
    expected={record['name']:artifacts.load(record) for record in producer['review_components']}
    audit.require(set(expected)==set(parts),'Expected complete four-part arcade source')
    identity={name:ear.equal(part,expected[name],'Actual arcade source differs: '+name) for name,part in parts.items()}
    original=dict(parts)
    floor=candidate['original']['floor_z']
    bridge=r.block(46,28,BRIDGE_THICKNESS,(0,46,floor+BRIDGE_BOTTOM_ABOVE_FLOOR))
    rear_ties=r.cable_tiedowns(bridge,floor+BRIDGE_BOTTOM_ABOVE_FLOOR+BRIDGE_THICKNESS,180)
    # The bridge overlaps the rear wall by 2 mm and stays 6 mm above the old tray roof.
    parts['shell']+=rear_ties['bottom']
    length=p.tilted_length
    rear_channel=r.block(p.channel_width,length/2+8,p.channel_depth+p.exit_height,
                         (0,length/4-1,floor+REAR_OUTLET_BOTTOM_ABOVE_FLOOR))
    parts['shell']-=rear_channel
    # A straight corridor from the free interior above the tray to outside the rear wall.
    # Its 9 x 8.5 mm section is the original proposed outlet reserve, not a measured connector.
    rear_reserve=r.block(p.channel_width-2*p.envelope_gap,length/2+3-19,
                         p.channel_depth+p.exit_height-2*p.envelope_gap,
                         (0,(19+length/2+3)/2,floor+REAR_OUTLET_BOTTOM_ABOVE_FLOOR+p.envelope_gap))
    data.update(candidate=candidate,original_parts=original,source_identity=identity,
                rear_channel=rear_channel,rear_reserve=rear_reserve,rear_ties=rear_ties)
    inputs_unchanged(data)
    return data


def fixed_parts(candidate):
    fixed=dict(candidate['parts'])
    fixed.update({f'hardware-{i}':part for i,part in enumerate(base.candidate_hardware(candidate))})
    fixed.update({f'cube-{i}':part for i,part in enumerate(candidate['ballast_cubes'])})
    return fixed


def verify_routes(data):
    candidate=data['candidate'];fixed=fixed_parts(candidate)
    routes=dict(low_front=candidate['original']['cable_envelope'],high_back=data['rear_reserve'])
    rows={}
    for name,reserve in routes.items():
        overlaps={key:audit.intersection(reserve,part) for key,part in fixed.items()}
        audit.require(all(value<1e-6 for value in overlaps.values()),'Cable route blocked: '+name+': '+str(overlaps))
        bounds=reserve.bounding_box();edge=(-1 if name=='low_front' else 1)*candidate['box'].tilted_length/2
        audit.require(bounds.min.Y<edge<bounds.max.Y,'Cable reserve does not cross exterior wall: '+name)
        interior_y=(-1 if name=='low_front' else 1)*(candidate['box'].tilted_length/2-candidate['box'].wall-1)
        audit.require(bounds.min.Y<interior_y<bounds.max.Y,'Cable reserve does not reach interior: '+name)
        rows[name]=dict(intersections_mm3=overlaps,nominal_opening_width_height_mm=[10,9.5],
                        conservative_reserve_width_height_mm=[bounds.size.X,bounds.size.Z],
                        reserve_z_mm=[bounds.min.Z,bounds.max.Z],interior_and_exterior_connected_with_cover_installed=True)
    return rows


def rear_tie_witnesses(data):
    candidate=data['candidate'];floor=data['rear_ties']['floor'];fixed=fixed_parts(candidate)
    checks=r.verify_tiedowns(data['rear_ties'],candidate['original']['floor_z']+BRIDGE_BOTTOM_ABOVE_FLOOR)
    rows=[]
    for diameter in (3.,8.):
        low=1.35;high=diameter+4.45;height=high-low
        outer=r.Plane.XZ*r.RectangleRounded(33.2,height,1.5)
        inner=r.Plane.XZ*r.RectangleRounded(30.6,height-2.6,.2)
        loop=r.extrude(outer-inner,amount=1.25,both=True).translate((0,-38,floor+(low+high)/2))
        head=r.block(4.8,4.7,3.7,(-18.5,-38,floor+1.25))
        loop=(loop+head).rotate(Axis.Z,180)
        # Continue the same unmeasured diameter gauges straight from the anchor to the wall.
        bundle=cad.cyl(diameter/2,48,-24).rotate(Axis.X,90).translate((0,43,floor+3+diameter/2))
        for label,shape in (('complete tie',loop),('straight bundle gauge',bundle)):
            overlaps={name:audit.intersection(shape,part) for name,part in fixed.items()}
            audit.require(all(value<1e-6 for value in overlaps.values()),'Rear '+label+' blocked: '+str(overlaps))
        rows.append(dict(unmeasured_bundle_gauge_diameter_mm=diameter,
                         complete_tie_and_head_clear=True,straight_anchor_to_exterior_route_clear=True))
    return dict(anchor_checks=checks,witnesses=rows,actual_OD_bend_radius_and_pull_strength_verified=False)


def verify(data):
    inputs_unchanged(data)
    candidate=data['candidate'];parts=candidate['parts'];p=candidate['box'];floor=candidate['original']['floor_z']
    checks=base.verify(candidate)
    for name in ('bottom','ballast_body','ballast_lid'):
        ear.equal(parts[name],data['original_parts'][name],'Changed preserved arcade '+name)
    # Protect every original surface above the floor hardware/ballast zone, including the sloped pocket.
    roof_region=r.block(300,300,115,(0,0,-15))
    ear.equal(parts['shell']&roof_region,data['original_parts']['shell']&roof_region,'Changed arcade roof/counterbore')
    tray=r.block(p.tray_width,p.tray_length,p.tray_height+p.tray_roof,(0,p.tray_y,floor))
    ear.equal(parts['shell']&tray,data['original_parts']['shell']&tray,'Changed original ballast enclosure')
    for x,y in candidate['original']['fastener_axes']:
        region=cad.cyl(p.boss_radius,p.boss_height,floor).translate((x,y,0))
        ear.equal(parts['shell']&region,data['original_parts']['shell']&region,'Changed cover fastener region')
    corridor=cad.cyl(p.corridor_radius,p.clearance_mm,-p.clearance_mm).rotate(Axis.X,p.tilt)
    for name,part in fixed_parts(candidate).items():
        audit.require(audit.intersection(part,corridor)<1e-6,'Dual outlet enters 63.5 mm axial reserve: '+name)
    wall_band=r.block(p.channel_width,p.wall,p.channel_depth+p.exit_height,
                      (0,p.tilted_length/2-p.wall/2,floor+REAR_OUTLET_BOTTOM_ABOVE_FLOOR))
    removed=audit.volume(data['original_parts']['shell']&wall_band)-audit.volume(parts['shell']&wall_band)
    audit.require(removed>1,'Rear wall outlet has no measured effect')
    audit.require(audit.volume(data['rear_ties']['bottom']-parts['shell'])<1e-6,
                  'Missing integral rear tie bridge or anchor')
    support_overlap=audit.intersection(data['rear_ties']['bottom'],data['original_parts']['shell'])
    audit.require(support_overlap>1,'Rear tie bridge is not joined to original shell')
    routes=verify_routes(data);ties=rear_tie_witnesses(data)
    checks.update(source_material_identity_before_changes=data['source_identity'],dual_exit_routes=routes,
                  rear_tiedowns=ties,unchanged_bottom_and_ballast_capsule=True,
                  roof_counterbore_and_cover_fastener_regions_preserved=True,
                  original_ballast_enclosure_preserved=True,all_parts_and_hardware_clear_axial_reserve=True,
                  rear_wall_material_removed_mm3=removed,rear_bridge_wall_overlap_mm3=support_overlap,
                  rear_bridge_bottom_above_tray_roof_mm=BRIDGE_BOTTOM_ABOVE_FLOOR-p.tray_height-p.tray_roof,
                  low_front_exit_bottom_above_floor_mm=-p.channel_depth,
                  high_back_exit_bottom_above_floor_mm=REAR_OUTLET_BOTTOM_ABOVE_FLOOR,
                  bottom_skin_under_low_channel_mm=p.bottom_thickness-p.channel_depth,
                  rear_bridge_thickness_mm=BRIDGE_THICKNESS)
    inputs_unchanged(data)
    return checks


def export(data,output):
    output.mkdir(parents=True,exist_ok=True);target=output/'receipt.json';target.unlink(missing_ok=True)
    checks=verify(data);candidate=data['candidate'];validation=audit.Artifacts();records=[]
    for name,part in candidate['parts'].items():
        stem=output/'print-candidates'/name
        record=cad.export_part(part,stem);record.update(name=name,role='resin dual-exit arcade print candidate; not released')
        for kind in ('step','stl'):
            path=stem.with_suffix('.'+kind).resolve();record[kind]=str(path);record[kind+'_sha256']=audit.digest(path)
        ear.equal(validation.load(record),part,'Export changed arcade '+name);records.append(record)
    assembly=Compound(children=[part.solids()[0] for part in fixed_parts(candidate).values()])
    path=output/'assembly-ARCADE-DUAL-EXIT-PRIVATE.step'
    audit.require(export_step(assembly,path),'Arcade assembly export failed')
    sha=audit.digest(path);validation.files[str(path)]=sha
    restored=import_step(path)
    audit.require(restored.is_valid and len(restored.solids())==len(assembly.solids()),'Arcade assembly solids changed')
    ear.equal(assembly,restored,'Arcade assembly material changed')
    inputs_unchanged(data);validation.unchanged()
    report=dict(concept='resin-arcade-dual-exit-arcade-inclined',
                scope='PRIVATE_ARCADE_DUAL_EXIT_GEOMETRY_PROPOSAL',units='mm',geometry_checks_pass=True,
                independent_base_geometry_checks_pass=True,proposed_box_parameters=asdict(candidate['box']),
                standard_hardware=asdict(r.H),hardware_sources=r.SOURCES,
                geometry_review_pass=False,print_readiness='NOT_READY',review_components=records,checks=checks,
                producer_receipt=str(data['snapshot'].path),producer_receipt_sha256=data['snapshot'].sha256,
                source_code_sha256={Path(path).name:sha for path,sha in data['sources'].items()},
                validated_input_files=data['artifacts'].files,assembly_step=str(path.resolve()),assembly_step_sha256=sha,
                outlet_placement='Low/front retains floor notch; high/back raised above unchanged ballast tray',
                pending=['Actual plug and cable dimensions, minimum bend radius and preferred wire direction',
                         'Resin/process orientation, rear bridge support cleanup and hardware fit',
                         'Physical tie threading, abrasion protection, pull test and stability'],
                physical_connector_passage_and_cable_bend_verified=False,
                no_existing_sources_or_exports_modified=True,no_viewer_or_services_started=True)
    target.write_text(json.dumps(report,indent=2)+'\n')
    try:inputs_unchanged(data);validation.unchanged()
    except Exception:
        target.unlink(missing_ok=True)
        raise
    print(target)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-receipt',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();export(prepare(args.base_receipt),args.output)
