"""Ballast-free C mounting box; fixed wiring and removable blank service lid."""
from __future__ import annotations
import argparse
from copy import deepcopy
from pathlib import Path
import shutil
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import c_panel_service_mount as panel
from build123d import Compound,export_step,import_step
common,g,require=panel.common,panel.g,panel.require


def prepare(base_receipt,candidate_receipt,bundle):
    data=common.prepare(base_receipt,candidate_receipt,bundle)
    own=Path(__file__).resolve()
    for path in (own,Path(panel.__file__).resolve()):data['sources'][path.name]=(path,g.audit.digest(path))
    candidate=data['candidate'];floor=candidate['original']['floor_z'];p=candidate['box'];source=g.compact.build()
    original_shell=candidate['parts']['shell'];blank=source['covers']['bottom']
    front=p.tray_y-p.tray_length/2;back=p.level_length/2-p.wall
    mask=g.r.block(p.tray_width,back-front,p.tray_height+p.tray_roof+.1,(0,(front+back)/2,floor-.05))
    shell=original_shell-mask
    for sign,eye in zip((-1,1),candidate['ties']['eyes']):
        shell=shell+eye+g.r.block(8.,17.5,5.6,(sign*11.,-49.25,floor))
    require(shell.is_valid and len(shell.solids())==1,'Ballast cleanup disconnected C box')
    parts={name:part for name,part in candidate['parts'].items() if name not in ('ballast_body','ballast_lid')}
    parts.update(shell=shell,bottom=blank)
    candidate['parts']=parts;candidate['capsule']=dict(candidate['capsule'],pairs=[]);candidate['ballast_cubes']=[]
    candidate['kit']=dict(candidate['kit'],roof=shell);candidate['keepers']=dict(candidate['keepers'],roof=shell)
    data.update(retention_joints=[],fixed_ties=dict(candidate['ties'],bottom=shell),
                ballast_removal_mask=mask,original_shell_before_cleanup=original_shell,blank_lid_source=blank)
    g.unchanged(data);return data


def verify_structure(data):
    candidate=data['candidate'];floor=candidate['original']['floor_z'];parts=candidate['parts']
    require(set(parts)=={'shell','bottom','spacer','buffer','keeper_tab_0','keeper_tab_1'},'Unexpected ballast-free base inventory')
    require(g.intersection(parts['shell'],data['ballast_removal_mask'])<1e-6,'Internal ballast tray or ribs remain')
    expected=data['original_shell_before_cleanup']-data['ballast_removal_mask']
    for sign,eye in zip((-1,1),candidate['ties']['eyes']):expected=expected+eye+g.r.block(8.,17.5,5.6,(sign*11.,-49.25,floor))
    require(g.outside_volume(parts['shell'],expected)<1e-6 and g.outside_volume(expected,parts['shell'])<1e-6,
            'C box changed outside ballast removal and preserved fixed strain relief')
    require(g.outside_volume(parts['bottom'],data['blank_lid_source'])<1e-6 and
            g.outside_volume(data['blank_lid_source'],parts['bottom'])<1e-6,'Blank lid retains obsolete ballast features')
    ties=g.r.verify_tiedowns(dict(data['fixed_ties'],bottom=parts['shell']),floor)
    configurations={}
    for gap in (5.,7.):
        c=g.compact.configuration(candidate,gap);p=c['parts'];body=p['shell']+p['bottom'];items=list(p.items())
        for i,(name,part) in enumerate(items):
            require(part.is_valid and len(part.solids())==1,'Invalid actual C base part: '+name)
            for other,shape in items[i+1:]:require(g.intersection(part,shape)<1e-6,'C base parts overlap: '+name+'/'+other)
        hw=g.compact.base.candidate_hardware(c);require(len(hw)==20,'Obsolete ballast hardware remains')
        for part in hw:
            for name,shape in items:require(g.intersection(part,shape)<1e-6,'C base hardware blocked: '+name)
        require(g.intersection(c['original']['cable_envelope'],body)<1e-6,'Fixed wiring obstructs original cable route')
        keeper_body=p['shell']+p['keeper_tab_0']+p['keeper_tab_1']
        configurations[str(int(gap))]=dict(cover_joints=g.r.check_joints(c['covers']['pairs'],body),
            keeper_joints=g.r.check_joints(c['keepers']['pairs'],keeper_body),stock_hex=g.compact.verify_hex_capture(c),
            lower_web=g.compact.verify_lower_web(c),PTFE=g.compact.base.buffer_cad.verify(c['kit']),
            actual_C_bearing=common.verify_bearing(data,c),
            keeper_nut_loading=g.r.verify_nut_loading(c['keepers']['pairs'],p['shell']),
            support_nut_loading=g.r.verify_nut_loading(c['kit']['pairs'],p['shell']),hardware_solid_count=20)
    return dict(configurations=configurations,fixed_cable_tiedowns=ties,no_ballast_geometry_or_hardware=True,
                printed_parts_default=5,optional_shim_remains_separate=True)


def verify(data):
    root=panel.verify_tools(data)
    root.pop('all_30_hardware_envelopes_retained_conservatively')
    root['all_20_hardware_envelopes_retained_conservatively']=True
    service=panel.verify_panel_service(data)
    service.pop('stationary_cable_and_sealed_ballast_remain_in_place')
    service.update(stationary_cable_remains_in_place=True,no_ballast_present=True)
    return dict(structure=verify_structure(data),rotors_with_blank_panel_closed=common.verify_rotors(data),
                root_tools_panel_off=root,module_and_grip_service=common.verify_service(data),
                relaxed_C_recovery=common.verify_race_base(data),panel_removal_refit=service,
                panel_service_lifecycle=panel.verify_panel_lifecycle(data))


def export(data,output):
    g.require_fresh_namespace(output);output.mkdir(parents=True,exist_ok=False)
    parts=dict(data['candidate']['parts'],height_shim=data['shim']);records=[];files=g.audit.Artifacts()
    old={r['name']:r for r in data['report']['review_components']+data['report']['optional_components']}
    for name,part in parts.items():
        directory='optional-shim' if name=='height_shim' else 'materials-DO-NOT-PRINT' if name=='buffer' else 'print-candidates'
        stem=output/directory/name;stem.parent.mkdir(exist_ok=True)
        if name in ('shell','bottom'):
            record=g.cad.export_part(part,stem);record.update(name=name,role=directory)
            for kind in ('step','stl'):record[kind]=str(stem.with_suffix('.'+kind).resolve());record[kind+'_sha256']=g.audit.digest(Path(record[kind]))
        else:
            record=dict(old[name])
            for kind in ('step','stl'):
                target=stem.with_suffix('.'+kind);shutil.copyfile(record[kind],target);record[kind]=str(target.resolve())
                require(g.audit.digest(target)==record[kind+'_sha256'],'Preserved C base component bytes changed')
        actual=files.load(record)
        require(g.outside_volume(actual,part)<1e-6 and g.outside_volume(part,actual)<1e-6,'C base export changed: '+name)
        if name=='height_shim':data['shim']=actual
        else:data['candidate']['parts'][name]=actual
        records.append(record)
    c=data['candidate'];c['kit']=dict(c['kit'],roof=c['parts']['shell'],spacer=c['parts']['spacer'],buffer=c['parts']['buffer'])
    c['keepers']=dict(c['keepers'],roof=c['parts']['shell']);data['fixed_ties']=dict(data['fixed_ties'],bottom=c['parts']['shell'])
    data['artifacts'].files.update(files.files);checks=verify(data)
    assemblies={};C=common.load_parts(data,[data['C']['environment'],*data['C']['stages']['locked']['components']])
    for gap in (5.,7.):
        configured=g.compact.configuration(c,gap)
        shapes=[*configured['parts'].values(),*g.compact.base.candidate_hardware(configured),configured['keepers']['stock'],
                *[g.audit.pose(part,gap,panel.INDEX) for _,part in C]]
        target=output/f'complete-C-no-ballast-g{int(gap)}.step';assembly=Compound(children=[part.solids()[0] for part in shapes])
        require(export_step(assembly,target),'C ballast-free assembly export failed');restored=import_step(target)
        require(restored.is_valid and len(restored.solids())==len(shapes),'C ballast-free assembly inventory differs')
        sha=g.audit.digest(target);data['artifacts'].files[str(target)]=sha
        assemblies[str(int(gap))]=dict(step=str(target.resolve()),sha256=sha,solids=len(shapes),
            source_to_step_boolean_identity='NOT_CLAIMED; actual individual exports are authoritative')
    patterns=data['report']['material_patterns'];common.load_parts(data,patterns)
    report=dict(scope='C_MOUNT_WITHOUT_BALLAST',units='mm',geometry_checks_pass=True,C_receipt_sha256=common.C_SHA,
        tool_service_requires_bottom_removed=True,panel_refit_requires_all_C_tools_withdrawn=True,
        service_keeps_wiring_on_stationary_shell=True,no_ballast_or_retention_hardware=True,
        no_rotor_to_box_retaining_joint_or_stop=True,physical_fit_verified=False,manufacturing_approved=False,
        review_components=[r for r in records if r['name']!='height_shim'],
        optional_components=[r for r in records if r['name']=='height_shim'],material_patterns=patterns,
        printed_parts_default=5,printed_parts_reduction=2,assemblies=assemblies,checks=checks,
        hardware_BOM=dict(button_M3x10=4,button_M3x12=2,countersunk_M3x12_including_head=4,DIN934_M3_nuts=10),
        inherited_C_lifecycle=data['lifecycle'],source_code_sha256={name:sha for name,(_,sha) in data['sources'].items()},
        pending=['Actual resin/knob/fastener fit and strain-relief strength','Stable180mm service support and hand access',
                 'PTFE forming, drag, wear and actual grip loads'])
    target,sha=g.freeze_report(data,report,output/'verification');print(target);print(sha);return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('base-receipt','candidate-receipt','bundle','output'):parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args();export(prepare(args.base_receipt,args.candidate_receipt,args.bundle),args.output)
