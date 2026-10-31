"""Four-print C box without a bearing, PTFE kit, or height adapter."""
from __future__ import annotations
import argparse
from copy import deepcopy
from pathlib import Path
import shutil
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'verification'))
import clean_c_base_admission as inherited
from build123d import import_step

g=inherited.g
require=inherited.require
SCOPE='C_MOUNT_AIR_GAP_WITHOUT_BEARING_SUPPORT'
PARTS={'shell','bottom','keeper_tab_0','keeper_tab_1'}
HEIGHTS=(5.,7.)


def pre_buffer_roof(candidate):
    """Reconstruct the measured well before the retired buffer drills its roof."""
    compact=g.compact
    roof=deepcopy(candidate['covers']['shell'])
    roof+=g.cad.cyl(32.5,-compact.WEB_BOTTOM,compact.WEB_BOTTOM)
    roof+=g.cad.cyl(46,compact.WELL_FLOOR-compact.WEB_BOTTOM,compact.WEB_BOTTOM)
    roof+=g.cad.ring(44,46,-compact.WEB_BOTTOM,compact.WEB_BOTTOM)
    roof-=g.cad.ring(32.5,44,-compact.WELL_FLOOR+.1,compact.WELL_FLOOR)
    measured=compact.measured.interface(roof,candidate['keepers']['parameters'],compact.WEB_BOTTOM-.1)
    return measured['roof']


@inherited.detached_booleans()
def prepare(reference_base):
    data,reference=inherited.prepare_base(inherited.pin(reference_base))
    source=g.compact.build();roof=pre_buffer_roof(source)
    # The frozen compact exporter also cut its original complete-tool ports.
    # Preserve those occupied-material differences independently of the retired
    # support bores; reconstructing build() alone would silently fill them.
    original_ports=deepcopy(source['parts']['shell'])-deepcopy(data['original_shell_before_cleanup'])
    roof-=original_ports
    floor=data['candidate']['original']['floor_z']
    roof-=deepcopy(data['ballast_removal_mask'])
    for sign,eye in zip((-1,1),data['fixed_ties']['eyes']):
        roof+=deepcopy(eye)+g.r.block(8.,17.5,5.6,(sign*11.,-49.25,floor))
    retired_cuts=None
    for joint in source['kit']['pairs']:
        x,y=joint.expected_xy
        cut=g.r.bore(x,y,-12,8)+g.r.pocket(x,y,-10.1,-2.2)
        retired_cuts=cut if retired_cuts is None else retired_cuts+cut
    previous=data['shell_before_support_fusion']
    require(g.outside_volume(previous,roof)<1e-6,'Air-gap recipe removed original fixed box material')
    drilled=deepcopy(roof)-deepcopy(retired_cuts)
    require(g.outside_volume(drilled,previous)<1e-6 and g.outside_volume(previous,drilled)<1e-6,
            'Air-gap roof differs outside retired support bores and nut pockets')
    candidate=dict(data['candidate'])
    candidate['parts']={name:deepcopy(shape) for name,shape in candidate['parts'].items() if name in PARTS}
    candidate['parts']['shell']=roof
    candidate['keepers']=dict(candidate['keepers'],roof=roof)
    candidate.pop('kit')
    data.update(candidate=candidate,reference_four_print_base=reference,pre_buffer_roof=deepcopy(roof),
                retired_support_cuts=retired_cuts,old_roof_without_integral_support=previous)
    data['fixed_ties']=dict(data['fixed_ties'],bottom=roof)
    own=Path(__file__).resolve();data['sources'][own.name]=(own,g.audit.digest(own))
    g.unchanged(data)
    return data


def configuration(data,height):
    require(height in HEIGHTS,'Air-gap placement is checked at5 or7mm')
    return dict(data['candidate'],gap=height)


def hardware(candidate):
    return g.r.joint_hardware(candidate['covers']['pairs'])+g.r.joint_hardware(candidate['keepers']['pairs'])


def unchanged_subjects(data):
    for record in data.get('air_gap_records',[]):
        actual=data['artifacts'].shapes[record['step_sha256']]
        fresh=import_step(record['step']).solids()[0]
        require(actual.is_valid and inherited.fingerprint(actual)==inherited.fingerprint(fresh),
                'Air-gap actual subject mutated: '+record['name'])
    g.unchanged(data)


def fixed(data,height,panel_present=True,cover_screws_present=True):
    candidate=configuration(data,height);parts=dict(candidate['parts'])
    if not panel_present:parts.pop('bottom',None)
    for i,shape in enumerate(hardware(candidate)):
        if not cover_screws_present and i<8 and i%2==0:continue
        parts['hardware-'+str(i)]=shape
    parts.update(stock_hex=candidate['keepers']['stock'],cable=candidate['original']['cable_envelope'])
    return candidate,parts


@inherited.detached_booleans()
def verify(data):
    unchanged_subjects(data)
    c=deepcopy(data['candidate']);parts=c['parts'];shell=parts['shell'];bottom=parts['bottom']
    require(set(parts)==PARTS and 'kit' not in c,'Retired support remains in air-gap inventory')
    require(len(hardware(c))==12,'Unexpected air-gap base hardware inventory')
    require(shell.is_valid and len(shell.solids())==1,'Air-gap shell is not one valid solid')
    require(shell.bounding_box().max.Z<=1e-7,'Retired integral bearing projects above roof')
    require(g.outside_volume(shell,data['pre_buffer_roof'])<1e-6 and
            g.outside_volume(data['pre_buffer_roof'],shell)<1e-6,'Actual air-gap shell differs from pre-buffer roof')
    require(g.intersection(shell,data['ballast_removal_mask'])<1e-6,'Ballast remains in air-gap box')
    # The old support's four hole/captive-nut regions are now completely restored.
    added=shell-deepcopy(data['old_roof_without_integral_support'])
    require(g.outside_volume(added,data['retired_support_cuts'])<1e-6,'Air-gap material addition escapes retired holes')
    for i,(name,shape) in enumerate(parts.items()):
        require(shape.is_valid and len(shape.solids())==1,'Invalid air-gap part: '+name)
        for other,second in list(parts.items())[i+1:]:
            require(g.intersection(shape,second)<1e-6,'Air-gap base parts overlap: '+name+'/'+other)
    for shape in hardware(c):
        for name,part in parts.items():require(g.intersection(shape,part)<1e-6,'Air-gap hardware obstructed: '+name)
    require(g.intersection(c['original']['cable_envelope'],shell+bottom)<1e-6,'Air-gap box obstructs fixed wiring')
    keeper_body=shell+parts['keeper_tab_0']+parts['keeper_tab_1']
    joints=dict(cover=g.r.check_joints(c['covers']['pairs'],shell+bottom),
                keeper=g.r.check_joints(c['keepers']['pairs'],keeper_body))
    result=dict(actual_four_parts_valid_disjoint=True,actual_shell_matches_pre_buffer_roof=True,
                no_material_above_roof_z0=True,retired_support_holes_and_nut_pockets_filled=True,
                no_bearing_PTFE_adapter_or_support_fasteners=True,no_ballast=True,
                hardware_solid_count=12,joints=joints,stock_hex=g.compact.verify_hex_capture(c),
                lower_web=g.compact.verify_lower_web(c),
                keeper_nut_loading=g.r.verify_nut_loading(c['keepers']['pairs'],shell),
                cover_nut_loading=g.r.verify_nut_loading(c['covers']['pairs'],shell),
                fixed_cable_tiedowns=g.r.verify_tiedowns(dict(data['fixed_ties'],bottom=shell),c['original']['floor_z']))
    unchanged_subjects(data)
    return result


def export(data,output):
    g.require_fresh_namespace(output);output.mkdir(parents=True,exist_ok=False)
    inherited.unchanged_subjects(data)
    records=[];reference={r['name']:r for r in data['reference_four_print_base']['review_components']}
    for name in ('shell','bottom','keeper_tab_0','keeper_tab_1'):
        stem=output/'print-candidates'/name;stem.parent.mkdir(exist_ok=True)
        if name=='shell':
            record=g.cad.export_part(data['candidate']['parts'][name],stem)
            record.update(name=name,role='print-candidates')
            for kind in ('step','stl'):
                record[kind]=str(stem.with_suffix('.'+kind).resolve());record[kind+'_sha256']=g.audit.digest(Path(record[kind]))
        else:
            record=dict(reference[name])
            for kind in ('step','stl'):
                target=stem.with_suffix('.'+kind);shutil.copyfile(record[kind],target);record[kind]=str(target.resolve())
                require(g.audit.digest(target)==record[kind+'_sha256'],'Preserved air-gap base component changed')
        actual=g.load_candidate_record(data['artifacts'],record)
        data['candidate']['parts'][name]=actual;records.append(record)
    c=data['candidate'];c['keepers']=dict(c['keepers'],roof=c['parts']['shell'])
    data['fixed_ties']=dict(data['fixed_ties'],bottom=c['parts']['shell'])
    data['air_gap_records']=records
    checks=verify(data)
    report=dict(scope=SCOPE,units='mm',geometry_checks_pass=True,printed_parts_default=4,
                no_ballast_or_retention_hardware=True,no_passive_bearing_support=True,
                no_rotor_to_box_retaining_joint_or_stop=True,physical_fit_verified=False,manufacturing_approved=False,
                review_components=records,optional_components=[],material_patterns=[],checks=checks,
                hardware_BOM=dict(button_M3x10=4,button_M3x12=2,DIN934_M3_nuts=6),
                placement=dict(default_bar_root_above_roof_mm=5.,checked_bar_root_heights_mm=[5.,7.],
                               nominal_hex_top_z_mm=-.25,hex_to_knob_underside_mm=[5.25,7.25],
                               reported_adjustment_interval_mm=[4.7625,22.225]),
                source_code_sha256={name:sha for name,(_,sha) in data['sources'].items()},
                pending=['New serial-key protocol and combined all-angle/service admission',
                         'Actual knob/spinner load capacity, pad grip, fit and handling'])
    target,sha=g.freeze_report(data,report,output/'verification')
    print(target);print(sha)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference-base',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();export(prepare(args.reference_base),args.output)
