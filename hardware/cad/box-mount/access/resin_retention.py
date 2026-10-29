"""Independent resin-candidate retention geometry; never changes prior models."""
from __future__ import annotations
from dataclasses import dataclass
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import integrate_receipt as audit
from build123d import Axis, Box, Compound, Plane, RectangleRounded, Shape, extrude
cad = audit.cad

SOURCES = {
    'button_screw': 'https://www.accu.co.uk/socket-button-screws/8103-SSB-M3-10-A2',
    'button_standard': 'https://eshop.boellhoff.de/out/media/pdf/ISO_7380-1_Edelstahl_A2_Innensechskant___de.pdf',
    'nut': 'https://www.accu.co.uk/hexagon-nuts/7888-HPN-M3-A2',
    'tie': 'https://www.hellermanntyton.com/products/cable-ties-inside-serrated/t18i/111-02370',
    'ballast': 'https://www.pinewoodpro.com/tungsten-cube-weights.html',
}


@dataclass(frozen=True)
class Hardware:
    thread_diameter: float = 3.
    pitch: float = .5
    head_diameter: float = 5.7
    head_height: float = 1.65
    socket_af: float = 2.
    nut_af: float = 5.5
    nut_height: float = 2.4
    clearance: float = 3.6
    nut_pocket_af: float = 5.8
    head_pocket_diameter: float = 6.3
    head_pocket_depth: float = 1.85


H = Hardware()


def block(x, y, height, at=(0, 0, 0)):
    return Box(x, y, height, align=cad.MIN_Z).translate(at)


def bolt(x, y, bearing_z, length, direction=-1):
    """Maximum cylindrical button-head envelope; threads are not modeled."""
    shaft = cad.cyl(H.thread_diameter/2, length, bearing_z-length)
    head = cad.cyl(H.head_diameter/2, H.head_height, bearing_z)
    part = shaft+head
    if direction == 1:
        part = part.rotate(Axis.X, 180).translate((0, 0, 2*bearing_z))
    return part.translate((x, y, 0))


def nut(x, y, bottom_z):
    return (cad.hex_prism(H.nut_af, H.nut_height, bottom_z)-cad.cyl(1.55, H.nut_height+.2, bottom_z-.1)).translate((x,y,0))


def pocket(x, y, low, high):
    return cad.hex_prism(H.nut_pocket_af, high-low, low).translate((x,y,0))


def bore(x, y, low, high):
    return cad.cyl(H.clearance/2, high-low, low).translate((x,y,0))



@dataclass(frozen=True)
class Joint:
    name: str
    expected_xy: tuple[float, float]
    length_datum_z: float
    direction: int
    length: float
    screw: Shape
    nut: Shape
    length_basis: str = 'under-head'
    standard: str = 'ISO7380-1'


def make_joint(name, xy, bearing_z, length, nut_bottom_z, direction=-1):
    return Joint(name, xy, bearing_z, direction, length,
                 bolt(*xy,bearing_z,length,direction),nut(*xy,nut_bottom_z))


def joint_hardware(joints):
    return [part for joint in joints for part in (joint.screw,joint.nut)]


def check_axes(joint):
    for role,part in (('screw',joint.screw),('nut',joint.nut)):
        bounds=part.bounding_box()
        actual=((bounds.min.X+bounds.max.X)/2,(bounds.min.Y+bounds.max.Y)/2)
        audit.require(all(math.isclose(a,b,abs_tol=1e-6) for a,b in zip(actual,joint.expected_xy)),
                      f'Joint {joint.name}: {role} axis {actual} does not match declared joint axis {joint.expected_xy}')


def check_joints(joints,body):
    axes=[tuple(round(value,6) for value in joint.expected_xy) for joint in joints]
    audit.require(len(set(axes))==len(axes),'Joint axes duplicated: each seat needs its own declared joint axis')
    return [check_joint(joint,body) for joint in joints]


def check_joint(joint, body):
    check_axes(joint)
    name,screw,captive_nut=joint.name,joint.screw,joint.nut
    bearing_z,direction,length=joint.length_datum_z,joint.direction,joint.length
    audit.require(screw.is_valid and len(screw.solids())==1, 'Invalid standard screw '+name)
    audit.require(captive_nut.is_valid and len(captive_nut.solids())==1, 'Invalid standard nut '+name)
    audit.require(audit.intersection(screw, body)<1e-6, 'Screw blocked '+name)
    audit.require(audit.intersection(captive_nut, body)<1e-6, 'Nut blocked '+name)
    moved = captive_nut.translate((0,0,.3))
    audit.require(audit.intersection(moved,body)>1e-4, 'Nut has no roof reaction '+name)
    bb=captive_nut.bounding_box(); x=(bb.min.X+bb.max.X)/2; y=(bb.min.Y+bb.max.Y)/2
    # Test the smaller AF/minimum corner envelope, not only a generous sharp hex.
    minimum = cad.hex_prism(5.32,H.nut_height,bb.min.Z) & cad.cyl(6.01/2,H.nut_height,bb.min.Z)
    minimum=minimum.rotate(Axis.Z,30).translate((x,y,0))
    audit.require(audit.intersection(minimum,body)>1e-4, 'Nut can rotate freely '+name)
    pushed=screw.translate((0,0,.1*direction))
    audit.require(audit.intersection(pushed,body)>1e-4, 'Head has no bearing reaction '+name)
    # The nominal shank must span the entire nut plus one extra pitch.
    tip=bearing_z+direction*length
    actual_tip=screw.bounding_box().min.Z if direction==-1 else screw.bounding_box().max.Z
    audit.require(math.isclose(tip,actual_tip,abs_tol=1e-6),'Screw length/envelope mismatch '+name)
    if direction==-1:
        full=tip <= bb.min.Z-H.pitch and bearing_z >= bb.max.Z
    else:
        full=tip >= bb.max.Z+H.pitch and bearing_z <= bb.min.Z
    audit.require(full,'Insufficient nominal thread reach '+name)
    return dict(name=name,nominal_length_mm=length,length_basis=joint.length_basis,
                fastener_standard=joint.standard,declared_joint_axis_xy_mm=list(joint.expected_xy),
                screw_and_nut_on_declared_axis=True,nut_up_reaction=True,min_envelope_nut_30deg_rotation_blocked=True,
                head_bearing_reaction=True,full_nominal_nut_span_plus_one_pitch=True,
                actual_thread_fit_and_strength_verified=False)


def buffer_kit(roof, gap=9.):
    """Axial rim capture outside R49, fixed to the box with ordinary M3 screws."""
    audit.require(math.isfinite(gap) and 5<=gap<=41, 'Proposed mouth gap must be 5..41 mm for the selected screw-length series')
    seat=gap-1
    spacer=cad.ring(43,57,seat)
    spacer+=cad.ring(50.3,57,1.2,seat)
    buffer=cad.ring(43,50,1,seat)
    cap=cad.ring(49,57,3,gap+.2)
    length=next(value for value in (16,20,25,30,35,40,45,50) if value>=gap+9)
    pairs=[]
    for angle in (45,135,225,315):
        x,y=53*math.cos(math.radians(angle)),53*math.sin(math.radians(angle))
        hole=bore(x,y,-10,gap+10)
        roof=roof-hole-pocket(x,y,-10.1,-2.2)
        spacer-=hole;cap-=hole
        pairs.append(make_joint(f'buffer-{angle}',(x,y),gap+3.2,length,-4.8))
    return dict(roof=roof,spacer=spacer,buffer=buffer,cap=cap,pairs=pairs,
                gap=gap,bolt_length=length)


def verify_buffer(kit):
    fixed=kit['roof']+kit['spacer']+kit['cap']
    for name in ('roof','spacer','buffer','cap'):
        audit.require(kit[name].is_valid and len(kit[name].solids())==1, 'Invalid buffer '+name)
    for name in ('spacer','cap'):
        audit.require(audit.intersection(kit['buffer'],kit[name])<1e-6,'Buffer interferes with '+name)
    audit.require(audit.intersection(kit['buffer'].translate((0,0,.3)),kit['cap'])>1,'Buffer can escape axially')
    for x,y in ((.5,0),(-.5,0),(0,.5),(0,-.5)):
        audit.require(audit.intersection(kit['buffer'].translate((x,y,0)),kit['spacer'])>1,'Buffer can escape radially')
    # Everything projecting above the contact plane is beyond the original bar's
    # entire R47.230665 envelope; this remains independent of its rotation angle.
    core=cad.cyl(47.230665,100,kit['gap'])
    for part in [kit['cap'],*joint_hardware(kit['pairs'])]:
        audit.require(audit.intersection(part,core)<1e-6,'Retainer enters full-height bar radial bound')
    pairs=check_joints(kit['pairs'],fixed)
    audit.require(audit.intersection(kit['buffer'].translate((0,0,.3)),kit['roof']+kit['spacer'])<1e-6,
                  'Missing-cap negative control is not free')
    return dict(positive_axial_capture=True,positive_radial_capture=True,kit_bolted_to_roof=True,
                mouth_gap_mm_proposed=kit['gap'],buffer_id_od_thickness_mm=[86,100,1],
                cap_opening_diameter_mm=98,bar_radial_bound_mm=47.230665,
                cap_and_hardware_clear_internal_bar_bound_all_angles=True,
                actual_outer_ball_shell_clearance_verified=False,
                cap_above_mouth_requires_outer_shell_check_before_final_review=True,pairs=pairs,
                removal_requires_four_ordinary_2mm_hex_screws=True,
                material_drag_and_preload_verified=False,collar_hand_access_verified=False)


def ballast_cassette(depth=15.):
    """Separately closed capsule; bottom removal cannot release loose cubes."""
    audit.require(depth>=15, 'Cassette depth too small for nominal cube row')
    body=block(71,depth,9.5)
    chamber=block(52,depth-3,7.6,(0,0,2.))
    body-=chamber
    lid=block(71,depth,2,(0,0,9.5))
    pairs=[]
    for x in (-30.75,30.75):
        hole=bore(x,0,-1,16)
        body=body-hole-pocket(x,0,-.1,5.6)
        lid-=hole
        pairs.append(make_joint(f'ballast-{x}',(x,0),11.5,10,3.))
    cubes=[block(6.35,6.35,6.35,((index-3.5)*6.35,0,2.3)) for index in range(8)]
    return dict(body=body,lid=lid,cubes=cubes,pairs=pairs,depth=depth)


def verify_cassette(cassette):
    body,lid=cassette['body'],cassette['lid'];closed=body+lid
    audit.require(body.is_valid and len(body.solids())==1 and lid.is_valid and len(lid.solids())==1,'Invalid cassette')
    audit.require(audit.intersection(body,lid)<1e-6,'Cassette lid interferes')
    for cube in cassette['cubes']:
        audit.require(audit.intersection(cube,closed)<1e-6,'Nominal cube does not fit')
        for delta in ((0,0,2),(0,0,-2),(0,20,0),(0,-20,0),(80,0,0),(-80,0,0)):
            # Side escape uses a filled straight swept prism, not just a far endpoint.
            bb=cube.bounding_box();dx,dy,dz=delta
            swept=block(bb.size.X+abs(dx),bb.size.Y+abs(dy),bb.size.Z+abs(dz),
                        ((bb.min.X+bb.max.X)/2+dx/2,(bb.min.Y+bb.max.Y)/2+dy/2,bb.min.Z+min(0,dz)))
            audit.require(audit.intersection(swept,closed)>1e-4,'Cube has an open escape direction')
    pairs=check_joints(cassette['pairs'],closed)
    return dict(separately_screwed_lid=True,nominal_cube_size_mm=6.35,modeled_cube_count=8,
                nominal_supplier_mass_g=38.4,mass_is_packaging_proposal_not_stability_requirement=True,
                cube_escape_sweeps_blocked=True,pairs=pairs,
                sealed_against_fine_powder_or_liquid=False,physical_rattle_load_and_stability_verified=False)


def cable_tiedowns(bottom, floor, angle=0):
    """Closed eyes anchor a purchased cable tie above the unchanged ground face."""
    eyes=[];paths=[]
    for x in (-11,11):
        outer=block(8,8,5.6,(x,-38,floor))
        tunnel=block(8.2,3.2,1.8,(x,-38,floor+1.2))
        eye=(outer-tunnel).rotate(Axis.Z,angle)
        path=block(8.1,2.5,1.3,(x,-38,floor+1.35)).rotate(Axis.Z,angle)
        bottom+=eye;eyes.append(eye);paths.append(path)
    return dict(bottom=bottom,eyes=eyes,tie_tail_paths=paths,
                proposed_sleeved_bundle_diameter_range_mm=[3,8],angle=angle,floor=floor)


def verify_tiedowns(tiedowns, underside):
    bottom=tiedowns['bottom']
    audit.require(bottom.is_valid and len(bottom.solids())==1,'Cable eyes disconnected from cover')
    for eye in tiedowns['eyes']:
        audit.require(audit.volume(eye-bottom)<1e-6,'Missing printed cable anchor')
    for path in tiedowns['tie_tail_paths']:
        audit.require(audit.intersection(path,bottom)<1e-6,'2.5x1.3 tie tail cannot pass anchor')
        audit.require(audit.intersection(path.translate((0,0,2)),bottom)>1e-4,'Tie tail is not retained under a closed anchor')
    audit.require(math.isclose(bottom.bounding_box().min.Z,underside,abs_tol=1e-6),'Tiedown changed exterior ground')
    witnesses=[]
    floor=tiedowns['floor'];angle=tiedowns['angle']
    for diameter in (3.,8.):
        low=1.35;high=diameter+4.45;height=high-low
        outer=Plane.XZ*RectangleRounded(33.2,height,1.5)
        inner=Plane.XZ*RectangleRounded(30.6,height-2.6,.2)
        loop=extrude(outer-inner,amount=1.25,both=True).translate((0,-38,floor+(low+high)/2))
        head=block(4.8,4.7,3.7,(-18.5,-38,floor+1.25))
        loop=(loop+head).rotate(Axis.Z,angle)
        # Conservative cylindrical bundle gauge; the real jacket is heatshrink.
        bundle=cad.cyl(diameter/2,12,-6).rotate(Axis.X,90).translate((0,-38,floor+3.+diameter/2)).rotate(Axis.Z,angle)
        audit.require(audit.intersection(loop,bottom)<1e-6,'Complete tie loop or head hits printed anchor')
        audit.require(audit.intersection(bundle,bottom)<1e-6,'Bundle gauge hits anchor')
        audit.require(audit.intersection(loop,bundle)<1e-6,'Complete tie loop pinches nominal bundle gauge')
        outer_perimeter=2*(33.2+height)-8*1.5+2*math.pi*1.5
        audit.require(outer_perimeter+4.8+20<145,'145 mm tie leaves no proposed handling tail')
        witnesses.append(dict(bundle_diameter_mm=diameter,complete_loop_and_head_clear=True,
                              conservative_length_with_head_and_20mm_tail_mm=outer_perimeter+4.8+20))
    return dict(two_closed_eyes_fused_to_cover=True,tie_tail_envelope_mm=[2.5,1.3],
                tunnel_mm=[3.2,1.8],tunnel_floor_skin_mm=1.2,tunnel_roof_mm=2.6,
                manufacturer_tie_length_width_thickness_mm=[145,2.5,1.2],
                manufacturer_tie_head_length_width_height_mm=[4.8,4.5,3.5],
                proposed_sleeved_bundle_diameter_range_mm=[3,8],
                ordinary_tail_threading_verified=True,finite_whole_loop_routing_witnesses=witnesses,
                actual_tie_bending_threading_and_grip_force_verified=False,
                heatshrink_is_not_the_box_anchor=True)


def standard_covers(shell, bottom, axes, floor, underside):
    """Raise only corner seats inward, preserving the ground and axial reserve."""
    pairs=[]
    for index,(x,y) in enumerate(axes):
        # Restore the prior illustrative nut seat before cutting the real joint.
        shell+=cad.cyl(6,3,floor).translate((x,y,0))
        shell-=cad.cyl(6,1.5,floor).translate((x,y,0))
        bottom+=cad.cyl(5.8,1.5,floor).translate((x,y,0))
        hole=bore(x,y,underside-1,floor+14)
        shell=shell-hole-pocket(x,y,floor+1.5,floor+4.8)
        bottom-=hole
        bottom-=cad.cyl(H.head_pocket_diameter/2,H.head_pocket_depth+.1,underside-.1).translate((x,y,0))
        bearing=underside+H.head_pocket_depth
        pairs.append(make_joint(f'cover-{index}',(x,y),bearing,10,floor+2.2,1))
    return dict(shell=shell,bottom=bottom,pairs=pairs,
                head_seat_web_mm=floor+1.5-(underside+H.head_pocket_depth))


def stock_hex_keepers(roof):
    tabs=[];pairs=[]
    for sign in (-1,1):
        y=sign*24
        tab=block(8,17,3,(0,y,0))
        axis_y=sign*28
        hole=bore(0,axis_y,-14,4)
        head=cad.cyl(H.head_pocket_diameter/2,H.head_pocket_depth+.1,3-H.head_pocket_depth).translate((0,axis_y,0))
        roof=roof-hole-pocket(0,axis_y,-10,-7.)
        tab=tab-hole-head
        bearing=3-H.head_pocket_depth
        tabs.append(tab)
        pairs.append(make_joint(f'keeper-{sign}',(0,axis_y),bearing,12,-9.6))
    return dict(roof=roof,tabs=tabs,pairs=pairs)


def joint_coupon(af=5.8):
    """Actual cover corner stack, split for nut loading; no printed threads."""
    lower=cad.cyl(8,3)+cad.cyl(5.8,1.5,3)
    lower-=bore(0,0,-1,20)
    lower-=cad.cyl(H.head_pocket_diameter/2,H.head_pocket_depth+.1,-.1)
    upper=cad.cyl(8,12,3)-cad.cyl(6,1.5,3)
    upper-=cad.hex_prism(af,3.3,4.5)
    upper-=bore(0,0,-1,20)
    joint=make_joint('cover-coupon',(0,0),H.head_pocket_depth,10,5.2,1)
    return dict(lower=lower,upper=upper,joint=joint,af=af)


def verify_joint_coupon(coupon):
    lower,upper=coupon['lower'],coupon['upper']
    for part in (lower,upper):
        audit.require(part.is_valid and len(part.solids())==1,'Invalid hardware coupon')
    audit.require(audit.intersection(lower,upper)<1e-6,'Coupon halves overlap')
    checks=check_joint(coupon['joint'],lower+upper)
    # With the lower part off, the real nut can enter from below and reach its seat.
    insertion=cad.hex_prism(H.nut_af,24.8,-17.2)
    audit.require(audit.intersection(insertion,upper)<1e-6,'Coupon traps nut during printing')
    checks.update(nut_pocket_af_mm=coupon['af'],body_bore_mm=H.clearance,
                  head_pocket_diameter_depth_mm=[H.head_pocket_diameter,H.head_pocket_depth],
                  raised_pad_mm=1.5,actual_head_seat_web_mm=2.65,
                  nut_loads_after_printing=True,printed_threads=False)
    return checks


def verify_nut_loading(pairs, body):
    for joint in pairs:
        check_axes(joint)
        bounds=joint.nut.bounding_box()
        x=(bounds.min.X+bounds.max.X)/2;y=(bounds.min.Y+bounds.max.Y)/2
        path=cad.hex_prism(H.nut_af,H.nut_height+30,bounds.min.Z-30).translate((x,y,0))
        audit.require(audit.intersection(path,body)<1e-6,'Nut loading path blocked '+joint.name)
    return dict(nuts_insert_from_below_before_mating_part_fitted=True,entry_sweep_mm=30,
                physical_hand_or_nut_driver_access_verified=False)
