"""Two-part arcade box: original inclined interfaces, no ballast structures."""
from __future__ import annotations
import argparse
from copy import deepcopy
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import sys
import zipfile
sys.path.insert(0,str(Path(__file__).resolve().parent))
import arcade_dual_exit as dual
from post_glue_base_gate import intersection,outside_volume
from build123d import Axis,extrude
r,cad,audit=dual.r,dual.cad,dual.audit
PARENT_SHA='fa2a4758e78568e396055f652add4088708fa2a2cea6d8da5aa298ae878745bb'
REAR_ANCHOR_SHIFT_Y=17.


def require(value,message):audit.require(value,message)


def equal(first,second,label):
    require(outside_volume(first,second)<1e-6 and outside_volume(second,first)<1e-6,label)


def unchanged(data):
    dual.inputs_unchanged(data);data['dual_snapshot'].unchanged()
    require(data['dual_snapshot'].parse()==data['dual_manifest'],'Parsed dual-exit source changed')


def prepare(receipt):
    snapshot=dual.ear.ReceiptSnapshot.capture(receipt);require(snapshot.sha256==PARENT_SHA,'Expected exact dual-exit arcade source')
    manifest=snapshot.parse();data=dual.prepare(Path(manifest['producer_receipt']))
    require(data['snapshot'].sha256==manifest['producer_receipt_sha256'],'Wrong underlying arcade source')
    for path in (Path(__file__).resolve(),Path(sys.modules[intersection.__module__].__file__).resolve()):
        data['sources'][str(path)]=audit.digest(path)
    actual={record['name']:data['artifacts'].load(record) for record in manifest['review_components']}
    for name,part in data['candidate']['parts'].items():equal(part,actual[name],'Actual dual-exit source differs: '+name)
    candidate=data['candidate'];p=candidate['box'];floor=candidate['original']['floor_z']
    # The enclosing walls start outside this footprint. The old rear ribs are
    # removed only up to the inner wall plane, retaining their wall overlap.
    front=p.tray_y-p.tray_length/2;back=p.tilted_length/2-p.wall
    mask=r.block(p.tray_width,back-front,p.tray_height+p.tray_roof+.1,
                 (0,(front+back)/2,floor-.05))
    before=actual['shell']-mask
    rear_region=r.block(46,28.1,8.2,(0,46.05,floor+21.9))
    rear_cut=r.block(46,26,8.2,(0,45,floor+21.9))
    # Each closed eye directly overlaps the existing rear wall by1mm. The
    # removal stops at the inner wall plane; no shelf or support pad remains.
    bare=before-rear_cut
    rear_local=r.cable_tiedowns(bare.translate((0,-REAR_ANCHOR_SHIFT_Y,0)),floor+24,180)
    anchors=(rear_local['eyes'][0]+rear_local['eyes'][1]).translate((0,REAR_ANCHOR_SHIFT_Y,0))
    shell=rear_local['bottom'].translate((0,REAR_ANCHOR_SHIFT_Y,0))
    require(shell.is_valid and len(shell.solids())==1,'Tray removal disconnects arcade shell')
    candidate['parts']=dict(shell=shell,bottom=actual['bottom'])
    candidate['capsule']=dict(candidate['capsule'],pairs=[]);candidate['ballast_cubes']=[]
    candidate['ties']=dict(candidate['ties'],bottom=actual['bottom'])
    data.update(dual_snapshot=snapshot,dual_manifest=manifest,original_dual_parts=actual,removal_mask=mask,
                before_rear_cleanup=before,rear_anchor_region=rear_region,rear_removal_cut=rear_cut,compact_rear_local=rear_local,
                compact_rear_anchors=anchors)
    unchanged(data);return data


def fixed(data):
    candidate=data['candidate'];result=dict(candidate['parts'])
    result.update({'cover-hardware-'+str(i):part for i,part in enumerate(r.joint_hardware(candidate['covers']['pairs']))})
    return result


def verify_rear_anchors(data):
    candidate=data['candidate'];shell=candidate['parts']['shell'];floor=data['compact_rear_local']['floor']
    # Work in the old anchor's local coordinates for its complete closed-eye,
    # threading, loop and head checks, then check the actual assembly natively.
    local=dict(data['compact_rear_local'],bottom=shell.translate((0,-REAR_ANCHOR_SHIFT_Y,0)))
    anchors=r.verify_tiedowns(local,candidate['original']['floor_z'])
    obstacles=fixed(data);rows=[]
    for diameter in (3.,8.):
        low=1.35;high=diameter+4.45;height=high-low
        outer=r.Plane.XZ*r.RectangleRounded(33.2,height,1.5)
        inner=r.Plane.XZ*r.RectangleRounded(30.6,height-2.6,.2)
        loop=r.extrude(outer-inner,amount=1.25,both=True).translate((0,-38,floor+(low+high)/2))
        head=r.block(4.8,4.7,3.7,(-18.5,-38,floor+1.25))
        loop=(loop+head).rotate(Axis.Z,180).translate((0,REAR_ANCHOR_SHIFT_Y,0))
        bundle=cad.cyl(diameter/2,48,-24).rotate(Axis.X,90).translate((0,43,floor+3+diameter/2))
        for label,shape in (('tie loop and head',loop),('straight cable gauge',bundle)):
            for name,part in obstacles.items():require(intersection(shape,part)<1e-6,'Compact rear '+label+' blocked: '+name)
        rows.append(dict(nominal_bundle_diameter_mm=diameter,actual_loop_head_and_route_clear=True))
    supports=[]
    for x in (-11,11):
        eye=next(part.translate((0,REAR_ANCHOR_SHIFT_Y,0)) for part in data['compact_rear_local']['eyes']
                 if abs(part.bounding_box().center().X-x)<1e-6)
        overlap=intersection(eye,data['before_rear_cleanup'])
        require(overlap>=44.7,'Compact rear eye has no positive wall attachment')
        supports.append(dict(anchor_x_mm=x,anchor_y_mm=55,eye_outer_dimensions_mm=[8,8,5.6],wall_overlap_mm3=overlap,
                             shelf_or_support_pad=False))
    return dict(closed_anchor_checks=anchors,whole_tie_and_cable_witnesses=rows,supports=supports,
                one_tie_serves_both_eyes=True,actual_cable_bend_radius_and_pull_strength_verified=False)


def verify(data):
    unchanged(data);candidate=data['candidate'];parts=candidate['parts'];p=candidate['box'];floor=p.floor_z
    require(set(parts)=={'shell','bottom'},'Expected exactly two printed parts')
    for name,part in parts.items():require(part.is_valid and len(part.solids())==1,'Invalid arcade part: '+name)
    require(intersection(parts['shell'],parts['bottom'])<1e-6,'Arcade shell and bottom overlap')
    equal(parts['bottom'],data['original_dual_parts']['bottom'],'Arcade bottom changed')
    expected=(data['before_rear_cleanup']-data['rear_removal_cut'])+data['compact_rear_anchors']
    equal(parts['shell'],expected,'Cleanup changed material outside tray/rear-anchor regions')
    equal(parts['shell']-data['rear_anchor_region'],data['before_rear_cleanup']-data['rear_anchor_region'],
          'Material changed outside explicit rear-anchor region')
    require(intersection(parts['shell'],data['removal_mask'])<1e-6,'Internal ballast tray or ribs remain')
    removed=intersection(data['original_dual_parts']['shell'],data['removal_mask']);require(removed>1000,'Ballast removal is ineffective')
    roof=r.block(300,300,115,(0,0,-15))
    equal(parts['shell']&roof,data['original_dual_parts']['shell']&roof,'Inclined roof or counterbore changed')
    for x,y in candidate['original']['fastener_axes']:
        region=cad.cyl(p.boss_radius,p.boss_height,floor).translate((x,y,0))
        equal(parts['shell']&region,data['original_dual_parts']['shell']&region,'Cover joint feature changed')
    require(p.clearance_mm==63.5 and p.tilt==5. and p.recess==17.5,'Confirmed arcade datums changed')
    corridor=cad.cyl(p.corridor_radius,p.clearance_mm,-p.clearance_mm).rotate(Axis.X,p.tilt)
    obstacles=fixed(data)
    for name,part in obstacles.items():require(intersection(corridor,part)<1e-6,'63.5mm button-axis reserve blocked: '+name)
    routes={}
    for name,reserve in dict(front=candidate['original']['cable_envelope'],rear=data['rear_reserve']).items():
        for obstacle,part in obstacles.items():require(intersection(reserve,part)<1e-6,'Cable outlet blocked: '+name+'/'+obstacle)
        routes[name]=dict(actual_reserve_clear=True,width_height_mm=[reserve.bounding_box().size.X,reserve.bounding_box().size.Z])
    require(outside_volume(data['compact_rear_anchors'],parts['shell'])<1e-6,'Compact rear anchors missing')
    wall=r.block(50,5,12,(0,60.5,floor+21))
    equal(parts['shell']&wall,data['before_rear_cleanup']&wall,'Rear enclosing wall or outlet changed')
    front_ties=r.verify_tiedowns(candidate['ties'],candidate['original']['underside_z'])
    rear_ties=verify_rear_anchors(data)
    joint_checks=r.check_joints(candidate['covers']['pairs'],parts['shell']+parts['bottom'])
    loading=r.verify_nut_loading(candidate['covers']['pairs'],parts['shell'])
    for item in r.joint_hardware(candidate['covers']['pairs']):
        for name,part in parts.items():require(intersection(item,part)<1e-6,'Cover hardware obstructed: '+name)
    # Copies prevent temporary sweeps from changing the checked imported faces.
    removal=deepcopy(parts['bottom'])
    for face in parts['bottom'].faces():
        if face.normal_at().Z>.9:removal=removal+extrude(deepcopy(face),amount=-100,dir=(0,0,1))
    require(intersection(removal,parts['shell'])<1e-6,'Bottom cannot withdraw and refit')
    tools=[]
    for joint in candidate['covers']['pairs']:
        x,y=joint.expected_xy;tip=joint.screw.bounding_box().min.Z+1.
        whole=cad.cyl(1.2,106,tip-106).translate((x,y,0))+cad.cyl(18,8.4,tip-107.2).translate((x,y,0))
        for name,part in parts.items():require(intersection(whole,part)<1e-6,'Whole ordinary AF2 cover key blocked: '+name)
        tools.append(dict(joint=joint.name,AF_mm=2,whole_key_entry_operation_withdrawal_clear=True))
    require(all(part.is_valid for part in parts.values()),'Temporary verification mutated actual parts')
    unchanged(data)
    saved=intersection(data['before_rear_cleanup'],data['rear_anchor_region'])-intersection(parts['shell'],data['rear_anchor_region'])
    require(saved>1800,'Rear shelf was not materially simplified')
    return dict(exactly_two_parts=True,removed_ballast_material_mm3=removed,no_ballast_parts_or_dedicated_hardware=True,
        rear_shelf_replaced_by_two_compact_wall_anchors=True,net_rear_material_saved_mm3=saved,
        roof_counterbore_and_all_four_cover_interfaces_preserved=True,button_axis_reserve_mm=63.5,
        tilt_degrees=5.,counterbore_recess_mm=17.5,cable_routes=routes,front_tiedowns=front_ties,rear_tiedowns=rear_ties,
        cover_joints=joint_checks,cover_nut_loading=loading,cover_tools=tools,continuous_bottom_withdrawal_and_reverse_mm=100.)


def export(data,output):
    require(not output.exists() and not output.is_symlink(),'Use a fresh arcade export namespace')
    output.mkdir(parents=True,exist_ok=False);records=[];validation=audit.Artifacts()
    for name,part in data['candidate']['parts'].items():
        translation=(0.,0.,-part.bounding_box().min.Z);stem=output/('arcade-box-'+name)
        record=cad.export_part(part.translate(translation),stem)
        record.update(name=name,role='print',source_to_print_translation_mm=list(translation))
        for kind in ('step','stl'):record[kind]=str(stem.with_suffix('.'+kind).resolve());record[kind+'_sha256']=audit.digest(Path(record[kind]))
        restored=validation.load(record);require(abs(restored.bounding_box().min.Z)<1e-6,'STEP is not grounded')
        mesh=validation.meshes[record['stl_sha256']];require(abs(mesh[1][0,2])<1e-5,'STL is not grounded')
        restored=restored.translate(tuple(-value for value in translation));equal(restored,part,'Export changed arcade '+name)
        data['candidate']['parts'][name]=restored;records.append(record)
    data['candidate']['ties']=dict(data['candidate']['ties'],bottom=data['candidate']['parts']['bottom'])
    checks=verify(data);zip_path=output/'arcade-button-box-STL.zip'
    with zipfile.ZipFile(zip_path,'x',compression=zipfile.ZIP_DEFLATED) as archive:
        for record in records:archive.write(record['stl'],arcname=Path(record['stl']).name)
    with zipfile.ZipFile(zip_path) as archive:
        require(set(archive.namelist())=={'arcade-box-shell.stl','arcade-box-bottom.stl'} and len(archive.infolist())==2,'Archive has extra files')
        for record in records:require(hashlib.sha256(archive.read(Path(record['stl']).name)).hexdigest()==record['stl_sha256'],'Archive changes actual STL')
    unchanged(data);validation.unchanged()
    report=dict(scope='TWO_PART_ARCADE_BUTTON_BOX_WITHOUT_BALLAST',units='mm',geometry_checks_pass=True,
        review_components=records,checks=checks,hardware_BOM=dict(button_ISO7380_M3x10=4,DIN934_M3_nuts=4),
        OEM_button_stock_mounting_nut_separate=True,ballast_and_capsule_hardware_removed=True,
        archive=dict(path=str(zip_path.resolve()),sha256=audit.digest(zip_path),files=[Path(r['stl']).name for r in records]),
        proposed_box_parameters=asdict(data['candidate']['box']),parent_receipt_sha256=PARENT_SHA,
        input_receipts={str(data['snapshot'].path):data['snapshot'].sha256,str(data['dual_snapshot'].path):PARENT_SHA},
        source_code_sha256={str(path):sha for path,sha in data['sources'].items()},
        validated_input_files=data['artifacts'].files,validated_output_files=validation.files,
        physical_fit_and_strength_verified=False,no_existing_sources_or_exports_modified=True,no_viewer_or_services_started=True)
    target=output/'receipt.json';target.write_text(json.dumps(report,indent=2)+'\n')
    unchanged(data);validation.unchanged();print(target);print(audit.digest(target));return report


def load_review(receipt_path,expected_sha=None):
    raw=Path(receipt_path).read_bytes()
    if expected_sha is not None:require(hashlib.sha256(raw).hexdigest()==expected_sha,'Wrong two-part arcade receipt')
    report=json.loads(raw);require(report['scope']=='TWO_PART_ARCADE_BUTTON_BOX_WITHOUT_BALLAST' and report['geometry_checks_pass'],'Unverified arcade review')
    require({r['name'] for r in report['review_components']}=={'shell','bottom'} and len(report['review_components'])==2,'Wrong arcade review inventory')
    files=audit.Artifacts();parts={}
    for record in report['review_components']:
        part=files.load(record);parts[record['name']]=part.translate(tuple(-v for v in record['source_to_print_translation_mm']))
    files.unchanged();require(Path(receipt_path).read_bytes()==raw,'Arcade review receipt changed');return parts


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--receipt',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();export(prepare(args.receipt),args.output)
