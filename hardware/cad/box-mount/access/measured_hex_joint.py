"""Small full-hex/one-keeper coupon using explicitly approximate operator estimates."""
from __future__ import annotations
import argparse
from dataclasses import asdict,dataclass
import json
import math
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import buffer_ear_trial as ear
from build123d import Axis,Compound,export_step,import_step
r=ear.r
cad=ear.cad
audit=ear.audit


@dataclass(frozen=True)
class Parameters:
    estimated_hex_af:float=34.925
    estimated_barrel_diameter:float=28.575
    estimated_nut_thickness:float=6.35
    estimated_knob_diameter:float=47.625
    estimated_knob_height:float=25.4
    reported_underside_gap_min:float=4.7625
    reported_underside_gap_max:float=22.225
    well_af:float=36.
    passage_diameter:float=30.
    well_depth:float=6.6
    seat_web:float=5.

    @property
    def hex_top_z(self):return self.estimated_nut_thickness-self.well_depth

    def validate(self):
        audit.require(all(math.isfinite(v) and v>0 for v in asdict(self).values()),'Fit parameters must be finite and positive')
        audit.require(self.well_af-self.estimated_hex_af>=.5,'Hex allowance below declared 0.5 mm total AF minimum')
        audit.require(self.passage_diameter-self.estimated_barrel_diameter>=1.,'Barrel allowance below declared 1 mm diametral minimum')
        audit.require(self.well_depth>=self.estimated_nut_thickness,'Nut is thicker than pocket')
        audit.require(self.hex_top_z>=-.5,'Nominal keeper nose exceeds 0.5 mm trial limit')
        audit.require((self.estimated_hex_af-self.passage_diameter)/2>=2.,'Nominal hex bearing ledge below 2 mm')
        audit.require(self.reported_underside_gap_min<self.reported_underside_gap_max,'Reversed adjustment interval')


def interface(roof,p,nut_loading_bottom):
    """Shared well/keeper recipe for this coupon and a future complete mount."""
    p.validate()
    roof-=cad.hex_prism(p.well_af,p.well_depth+.1,-p.well_depth)
    roof-=cad.cyl(p.passage_diameter/2,200,-100)
    keepers=r.stock_hex_keepers(roof)
    tabs=[]
    for sign,tab in zip((-1,1),keepers['tabs']):
        if p.hex_top_z<0:
            tab+=r.block(8,2,-p.hex_top_z,(0,sign*16.5,p.hex_top_z))
        tabs.append(tab)
        keepers['roof']-=r.pocket(0,sign*28,nut_loading_bottom,-7)
    stock=cad.hex_prism(p.estimated_hex_af,p.estimated_nut_thickness,-p.well_depth)
    stock-=cad.cyl(p.estimated_barrel_diameter/2,p.estimated_nut_thickness+.2,-p.well_depth-.1)
    return dict(roof=keepers['roof'],tabs=tabs,pairs=keepers['pairs'],stock=stock,parameters=p)


def build(p=Parameters()):
    sources={path.name:(path,audit.digest(path)) for path in
             (*ear.SOURCE_PATHS.values(),Path(ear.__file__).resolve(),Path(__file__).resolve())}
    depth=p.well_depth+p.seat_web
    roof=cad.hex_prism(42,depth,-depth)+r.block(12,17,depth,(0,25,-depth))
    roof+=cad.cyl(6,depth,-depth).translate((0,28,0))
    result=interface(roof,p,-depth-.1)
    result.update(parts=dict(well=result['roof'],keeper=result['tabs'][1]),joint=result['pairs'][1],sources=sources)
    return result


def sources_unchanged(coupon):
    for name,(path,sha) in coupon['sources'].items():
        audit.require(audit.digest(path)==sha,'Measured coupon source changed: '+name)


def verify(coupon):
    sources_unchanged(coupon)
    p=coupon['parameters'];p.validate();roof=coupon['parts']['well'];tab=coupon['parts']['keeper'];stock=coupon['stock']
    for name,part in coupon['parts'].items():
        audit.require(part.is_valid and len(part.solids())==1,'Invalid measured fit piece '+name)
    audit.require(audit.intersection(roof,tab)<1e-6,'Keeper overlaps roof')
    audit.require(audit.intersection(stock,roof+tab)<1e-6,'Nominal stock hex cannot seat')
    audit.require(audit.volume(coupon['tabs'][1]-tab)<1e-6,'Missing measured keeper nose or body')
    lift=audit.intersection(stock.translate((0,0,.1)),tab)
    audit.require(lift>1e-4,'Measured keeper leaves hidden axial clearance')
    down=audit.intersection(stock.translate((0,0,-.1)),roof)
    audit.require(down>1e-4,'Nominal hex has no lower bearing seat')
    rotation=audit.intersection(stock.rotate(Axis.Z,5),roof)
    audit.require(rotation>1e-4,'Measured well does not block 5 degree hex rotation')
    hardware=r.check_joint(coupon['joint'],roof+tab)
    loading=r.verify_nut_loading([coupon['joint']],roof)
    barrel=cad.cyl(p.estimated_barrel_diameter/2,50,-30)
    audit.require(audit.intersection(barrel,roof+tab)<1e-6,'Estimated barrel cannot pass')
    # Wera 950 L 05021605001: ordinary 2 mm key, long leg 100 and short leg 16.
    # The filled standard screw envelope does not model the proprietary socket surface.
    top=coupon['joint'].screw.bounding_box().max.Z
    key=cad.cyl(1.2,100,top).translate((0,28,0))
    key+=cad.cyl(1.2,16).rotate(Axis.X,-90).translate((0,28,top+100))
    low=p.hex_top_z+p.reported_underside_gap_min
    high=p.hex_top_z+p.reported_underside_gap_max+p.estimated_knob_height
    knob=cad.cyl(p.estimated_knob_diameter/2,high-low,low)
    audit.require(audit.intersection(knob,roof+tab)<1e-6,'Nominal bare knob hits keeper')
    audit.require(audit.intersection(key,roof+tab+knob)<1e-6,'Ordinary keeper key access blocked')
    sources_unchanged(coupon)
    return dict(geometry_against_approximate_estimates_pass=True,
                nominal_hex_top_z_mm=p.hex_top_z,nominal_keeper_nose_drop_mm=-p.hex_top_z,
                nominal_hex_AF_clearance_mm=p.well_af-p.estimated_hex_af,
                nominal_barrel_diametral_clearance_mm=p.passage_diameter-p.estimated_barrel_diameter,
                nominal_stock_bearing_ledge_mm=(p.estimated_hex_af-p.passage_diameter)/2,
                seat_web_mm=p.seat_web,stock_up_0p1_overlap_mm3=lift,stock_down_0p1_overlap_mm3=down,
                stock_5_degree_rotation_overlap_mm3=rotation,standard_keeper_joint=hardware,nut_loading=loading,
                B_sequence_key_access_with_cup_and_ball_off=True,
                key=dict(part='Wera 950 L 05021605001',AF_mm=2,long_mm=100,short_mm=16,
                         source='https://cdn.hoffmann-group.com/derivatives/3483504/originalpdf/05021610001_en.pdf'),
                nominal_knob_bottom_above_keeper_mm=low-3,
                actual_stock_fit_preload_backlash_thread_and_strength_verified=False,
                cup_socket_fit_verified=False,compact_height_selected=False)


def export(coupon,output):
    output.mkdir(parents=True,exist_ok=True);target=output/'receipt.json';target.unlink(missing_ok=True)
    sources=coupon['sources']
    checks=verify(coupon);validation=audit.Artifacts();records=[]
    for name,part in coupon['parts'].items():
        bounds=part.bounding_box();centre=bounds.center()
        translation=(-centre.X,-centre.Y,-bounds.min.Z)
        posed=part.translate(translation)
        stem=output/'print'/('measured-hex-'+name)
        record=cad.export_part(posed,stem)
        record.update(name=name,role='isolated one-keeper hex fit coupon; not a complete mount',source_to_print_translation_mm=list(translation))
        for kind in ('step','stl'):
            path=stem.with_suffix('.'+kind).resolve();record[kind]=str(path);record[kind+'_sha256']=audit.digest(path)
        ear.equal(validation.load(record).translate(tuple(-value for value in translation)),part,'Coupon export changed '+name);records.append(record)
    assembly=Compound(children=[part.solids()[0] for part in
        (coupon['parts']['well'],coupon['parts']['keeper'],coupon['stock'],coupon['joint'].screw,coupon['joint'].nut)])
    path=output/'nominal-one-keeper-assembly.step'
    audit.require(export_step(assembly,path),'Measured coupon assembly export failed')
    sha=audit.digest(path);validation.files[str(path)]=sha
    restored=import_step(path)
    audit.require(restored.is_valid and len(restored.solids())==5,'Measured coupon assembly solids changed')
    ear.equal(assembly,restored,'Measured coupon assembly material changed')
    def unchanged():
        validation.unchanged()
        sources_unchanged(coupon)
    unchanged()
    report=dict(scope='ISOLATED_FULL_HEX_ONE_KEEPER_FIT_COUPON_NOT_FULL_MOUNT',units='mm',
                geometry_checks_pass=True,geometry_review_pass=False,print_readiness='HARDWARE_FIT_TRIAL',
                input_quality='Operator approximate ruler estimates; decimal values are exact inch conversions, not measurement accuracy',
                parameters=asdict(coupon['parameters']),checks=checks,review_components=records,
                keeper_screw_source='https://www.accu.co.uk/socket-button-screws/8104-SSB-M3-12-A2',
                source_code_sha256={name:sha for name,(_,sha) in sources.items()},
                assembly_step=str(path.resolve()),assembly_step_sha256=sha,
                physical_fit_preload_and_strength_verified=False,
                instructions=['Print both pieces at scale using the intended resin/process; source transforms recorded.',
                              'Load the real standard M3 nut from below before fitting the keeper.',
                              'Fit the real stock hex/barrel without forcing; check nominal 0.25 mm nose contact and axial play.',
                              'Use M3x12 ISO7380-1 screw with ordinary 2 mm key; source hardware contains no printed threads.',
                              'This single keeper tests one joint; it does not prove tilt restraint or a complete mount.',
                              'Cup/ball must be off for keeper tightening. Current knob socket diameter is unresolved.'])
    target.write_text(json.dumps(report,indent=2)+'\n')
    try:unchanged()
    except Exception:
        target.unlink(missing_ok=True)
        raise
    print(target)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();export(build(),args.output)
