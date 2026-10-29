"""Private rotor-box stack study. Never publishes or modifies existing previews."""
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass, replace
import hashlib
import json
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import box_mount as box_cad
from build123d import Align, Axis, Box, Compound, Cylinder, RegularPolygon, export_step, extrude, import_step
import trimesh

MIN_Z = (Align.CENTER, Align.CENTER, Align.MIN)
EPS = 1e-6


@dataclass(frozen=True)
class StackProposal:
    hex_across_flats: float = 34.0
    hex_depth: float = 5.0
    seat_roof: float = 5.0
    body_passage_diameter: float = 29.0
    spacer_height: float = 5.0
    buffer_thickness: float = 1.0
    contact_inner_radius: float = 43.0
    contact_outer_radius: float = 45.5
    # Stock hex is an unthreaded keepout, not an additional retaining nut.
    hex_radial_allowance: float = .3

    @property
    def bar_mouth_z(self):
        return self.spacer_height+self.buffer_thickness

    def validate(self):
        if any(isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value <= 0 for value in asdict(self).values()):
            raise ValueError('Stack proposal dimensions must be finite and positive')
        if self.body_passage_diameter >= self.hex_across_flats:
            raise ValueError('Stock hex needs a bearing shelf outside the body passage')
        if self.contact_inner_radius >= self.contact_outer_radius:
            raise ValueError('Contact ring must have positive width')


def cyl(radius, height, z=0):
    return Cylinder(radius,height,align=MIN_Z).translate((0,0,z))


def ring(inner, outer, height, z=0):
    return cyl(outer,height,z)-cyl(inner,height+.2,z-.1)


def hex_prism(across_flats, height, z):
    return extrude(RegularPolygon(across_flats/math.sqrt(3),6),amount=height).translate((0,0,z))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def empty_intersection(first, second, message):
    require(box_cad.volume(first & second)<EPS,message)


def stack(proposal: StackProposal,box_parameters=None):
    proposal.validate()
    original=box_parameters if box_parameters is not None else box_cad.Proposal()
    original.validate()
    old_shell,old_bottom,axes,cable,ballast=box_cad.build(original,'rotor-level')
    shift=(0,0,-original.level_top_z)
    shell,bottom,cable,ballast=[part.translate(shift) for part in (old_shell,old_bottom,cable,ballast)]
    # This independent local well follows the latest operator clarification:
    # existing stock hex sits flush in the roof; no additional nut is supplied.
    thickness=proposal.seat_roof+proposal.hex_depth
    patch_width=max(50.,proposal.hex_across_flats+12)
    patch=Box(patch_width,patch_width,thickness,align=MIN_Z).translate((0,0,-thickness))
    shell+=patch
    shell-=cyl(proposal.body_passage_diameter/2,original.depth+original.level_top_z+2,z=-original.depth-original.level_top_z-1)
    shell-=hex_prism(proposal.hex_across_flats,proposal.hex_depth+.1,-proposal.hex_depth)
    stock_hex=hex_prism(proposal.hex_across_flats-proposal.hex_radial_allowance,
                        proposal.hex_depth,-proposal.hex_depth)
    spacer=ring(proposal.contact_inner_radius,proposal.contact_outer_radius,proposal.spacer_height)
    buffer=ring(proposal.contact_inner_radius,proposal.contact_outer_radius,proposal.buffer_thickness,proposal.spacer_height)
    return dict(shell=shell,bottom=bottom,spacer=spacer,buffer=buffer,stock_hex_keepout=stock_hex,
                cable_envelope=cable,ballast_envelope=ballast,fastener_axes=axes,
                floor_z=original.floor_z-original.level_top_z,
                underside_z=original.underside_z-original.level_top_z)


def verify_stack(p,parts):
    actual={key:parts[key] for key in ('shell','bottom','spacer','buffer')}
    for name,part in actual.items():
        require(part.is_valid and len(part.solids())==1 and part.volume>0,f'Invalid study part: {name}')
    names=list(actual)
    for i,name in enumerate(names):
        for other in names[i+1:]:
            empty_intersection(actual[name],actual[other],f'Stack parts interfere: {name}/{other}')
    shell,bottom=parts['shell'],parts['bottom']
    for name in ('cable_envelope','ballast_envelope','stock_hex_keepout'):
        empty_intersection(shell,parts[name],f'Shell blocks {name}')
        empty_intersection(bottom,parts[name],f'Bottom blocks {name}')
    # Stock device hex enters the well from above. It is NOT a separate nut,
    # threaded fastener model, or positive axial retainer.
    insertion=hex_prism(p.hex_across_flats-p.hex_radial_allowance,35,-p.hex_depth)
    empty_intersection(shell,insertion,'Stock hex top-down insertion is blocked')
    seat=ring(p.body_passage_diameter/2+.1,p.hex_across_flats/2-.1,
              p.seat_roof-.2,-p.hex_depth-p.seat_roof+.1)
    require(math.isclose(box_cad.volume(shell & seat),seat.volume,rel_tol=1e-7),'Stock hex bearing seat absent')
    require(math.isclose(parts['stock_hex_keepout'].bounding_box().max.Z,0,abs_tol=EPS),'Stock hex is not flush with the roof')
    require(math.isclose(parts['stock_hex_keepout'].bounding_box().min.Z,-p.hex_depth,abs_tol=EPS),'Stock hex does not reach its well seat')
    # Removing the plate must release the bottom, independently of the bar.
    removal=bottom+bottom.translate((0,0,-100))
    for face in bottom.faces().filter_by(Axis.Z):
        if face.normal_at().Z>.9:
            removal+=extrude(face,amount=-100)
    empty_intersection(shell,removal,'Bottom withdrawal blocked')
    require(math.isclose(bottom.bounding_box().min.Z,parts['underside_z'],abs_tol=EPS),'Ground datum changed')
    require(math.isclose(parts['buffer'].bounding_box().max.Z,p.bar_mouth_z,abs_tol=EPS),'Buffer stack height changed')
    # This finite proposed tool path is a negative installed-access check. The
    # above-roof spacing cannot create clearance under a table-contacting box.
    tool=Cylinder(4, -parts['underside_z']+31,align=MIN_Z).translate((38,0,parts['underside_z']-25))
    table=Box(200,200,15,align=MIN_Z).translate((0,0,parts['underside_z']-15))
    table_blocked=box_cad.volume(tool & table)
    roof_blocked=box_cad.volume(tool & shell)
    require(table_blocked>EPS,'Negative tabletop check failed to detect the obstruction')
    require(roof_blocked>EPS,'Nominal unported roof unexpectedly permits proposed service path')
    return dict(roof_z_mm=0,interior_floor_z_mm=parts['floor_z'],external_underside_z_mm=parts['underside_z'],
                proposed_bar_mouth_z_mm=p.bar_mouth_z,additional_retaining_nut=False,
                stock_hex_top_down_insertion_clear=True,stock_hex_flush_top=True,
                stock_hex_bearing_seat_present=True,positive_axial_retention_verified=False,
                bottom_withdrawal_clear=True,cable_and_ballast_envelopes_clear=True,
                distinct_parts_overlap_mm3=0,
                installed_latch_access_verified=False,actual_knob_stack_fit_verified=False,
                bearing_load_or_wear_verified=False,
                illustrative_tool_path=dict(radius_mm=4,xy_mm=[38,0],table_intersection_mm3=table_blocked,
                                            nominal_roof_intersection_mm3=roof_blocked),
                table_contact_service_access='BLOCKED: access/support workflow not established')


def export_part(part,path):
    # Export a fresh single-solid handle, independent of assembly tree parents.
    record=box_cad.export_part(part.solids()[0],path)
    restored=import_step(path.with_suffix('.step'))
    require(box_cad.volume(part-restored)<EPS,'STEP part removed material')
    require(box_cad.volume(restored-part)<EPS,'STEP part added material')
    record['step_two_way_material_equality']=True
    return record


def export_study(output: Path,p: StackProposal):
    output.mkdir(parents=True,exist_ok=True)
    receipt_path=output/'receipt.json'
    receipt_path.unlink(missing_ok=True)
    (output/'interface.json').unlink(missing_ok=True)
    parts=stack(p)
    checks=verify_stack(p,parts)
    records={name:export_part(parts[name],output/f'{name}-PRIVATE-PROPOSAL')
             for name in ('shell','bottom','spacer','buffer')}
    assembly=Compound(children=[parts[name] for name in records])
    assembly_path=output/'stack-PRIVATE-PROPOSAL.step'
    require(export_step(assembly,assembly_path),'Assembly export failed')
    restored=import_step(assembly_path)
    require(restored.is_valid and len(restored.solids())==4 and math.isclose(restored.volume,assembly.volume,rel_tol=1e-8),'Assembly round trip failed')
    require(box_cad.volume(assembly-restored)<EPS,'STEP assembly removed material')
    require(box_cad.volume(restored-assembly)<EPS,'STEP assembly added material')
    interface=dict(units='mm',roof_plane_z_mm=0,bar_source_mouth_plane_z_mm=0,
        source_to_box_matrix=[[1,0,0,0],[0,-1,0,0],[0,0,-1,p.bar_mouth_z],[0,0,0,1]],
        proposed_contact_annulus=dict(inner_radius_mm=p.contact_inner_radius,outer_radius_mm=p.contact_outer_radius,
                                     top_z_mm=p.bar_mouth_z),
        stock_hex_well=dict(across_flats_proposed_mm=p.hex_across_flats,depth_proposed_mm=p.hex_depth,
                            top_z_mm=0,bearing_seat_z_mm=-p.hex_depth,thread_pitch=None,additional_retaining_nut=False),
        box_parts=records,release_access='not selected; actual controls and table/support arrangement required',
        rotation_contract='locked rotating geometry must clear the fixed stack for360degrees, or report explicit limitations; service windows require indexed alignment')
    interface_path=output/'interface.json'
    interface_path.write_text(json.dumps(interface,indent=2)+'\n')
    receipt=dict(interface_sha256=hashlib.sha256(interface_path.read_bytes()).hexdigest(),scope='PRIVATE_ROTOR_ACCESS_STUDY',print_readiness='NOT_READY',units='mm',
        parameters_proposed=asdict(p),coordinate_contract='roof Z=0; interior negative Z; bar extends positive Z',
        sources_sha256={path.name:hashlib.sha256(path.read_bytes()).hexdigest()
                        for path in (Path(__file__),Path(box_cad.__file__))},
        checks=checks,parts=records,
        pending=['C1/C2/C3 actual meshes and control sweeps','installed knob height/body and stock hex dimensions',
                 'shaft thread specification','buffer/spacer material and captured retention',
                 'actual harness and release tool/hand envelope','loads, wear, support and print process'])
    receipt_path.write_text(json.dumps(receipt,indent=2)+'\n')
    return receipt


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--parameters',type=Path,help='JSON StackProposal overrides; dimensions remain proposals')
    args=parser.parse_args()
    overrides=json.loads(args.parameters.read_text()) if args.parameters else {}
    proposal=replace(StackProposal(),**overrides)
    export_study(args.output,proposal)
    print(args.output/'receipt.json')


if __name__=='__main__':
    main()
