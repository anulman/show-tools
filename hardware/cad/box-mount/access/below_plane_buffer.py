"""ID88 cut-stock PTFE buffer with formed ears and below-root standard screws."""
from __future__ import annotations
import math
from build123d import Axis,Cone,Plane,Polygon,extrude
import resin_retention as r
cad=r.cad
audit=r.audit

BAR_RADIUS=47.230665
CLEARANCE=.5
THICKNESS=1.
RAMP_START=46.
RAMP_END=48.
DROP=1.2
EAR_END=57.
EAR_WIDTH=8.
FLAT_HEAD_DIAMETER=6.72
FLAT_HEAD_HEIGHT=1.86
FLAT_SCREW_SOURCE='https://www.accu.co.uk/countersunk-socket-head-screws/5430-SSK-M3-25-A2'


def ear_profile(gap):
    # Parallel lower ramp at exactly 1 mm normal distance. Its miter
    # intersections with the horizontal surfaces preserve sheet thickness.
    slope=DROP/(RAMP_END-RAMP_START)
    vertical_offset=THICKNESS*math.sqrt(1+slope*slope)
    shift=(THICKNESS-vertical_offset)/slope
    points=[(45.7,gap),(RAMP_START,gap),(RAMP_END,gap-DROP),(EAR_END,gap-DROP),
            (EAR_END,gap-DROP-THICKNESS),(RAMP_END+shift,gap-DROP-THICKNESS),
            (RAMP_START+shift,gap-THICKNESS),(45.7,gap-THICKNESS)]
    return extrude(Plane.XZ*Polygon(*points,align=None),amount=EAR_WIDTH/2,both=True)


def ramp_support(gap):
    slope=DROP/(RAMP_END-RAMP_START)
    shift=(THICKNESS-THICKNESS*math.sqrt(1+slope*slope))/slope
    # Top matches the lower sheet face, and the broad flat base joins the spacer.
    points=[(45.7,gap-THICKNESS),(RAMP_START+shift,gap-THICKNESS),
            (RAMP_END+shift,gap-DROP-THICKNESS),(45.7,gap-DROP-THICKNESS)]
    return extrude(Plane.XZ*Polygon(*points,align=None),amount=4.2,both=True)


def flat_screw(x,y,top,length,diameter=FLAT_HEAD_DIAMETER,angle=90):
    height=(diameter/2-1.5)/math.tan(math.radians(angle/2))
    head=Cone(1.5,diameter/2,height,align=cad.MIN_Z).translate((x,y,top-height))
    shaft=cad.cyl(1.5,length-height,top-length).translate((x,y,0))
    return head+shaft


def cone_seat(x,y,top):
    # 0.05 mm radial running allowance around the nominal maximum head.
    return Cone(1.55,FLAT_HEAD_DIAMETER/2+.05,FLAT_HEAD_HEIGHT,
                align=cad.MIN_Z).translate((x,y,top-FLAT_HEAD_HEIGHT))


def below_root_guard(named_parts,gap):
    inside=cad.cyl(BAR_RADIUS,1000,-500)
    prohibited=r.block(400,400,500,(0,0,gap-CLEARANCE))
    rows=[]
    for name,part in named_parts:
        outside=part-inside
        intrusion=audit.intersection(outside,prohibited) if outside else 0.
        audit.require(intrusion<1e-6,'Outside-bar part crosses required below-root plane: '+name)
        rows.append(dict(name=name,outside_bar_above_clearance_plane_mm3=intrusion))
    return dict(opening_root_plane_z_mm=gap,original_bar_radius_mm=BAR_RADIUS,
                outside_profile_clearance_below_root_mm=CLEARANCE,parts=rows,
                arbitrary_ball_sphere_assumed=False,physical_ball_shell_fit_verified=False)


def build(roof,gap=19.):
    audit.require(math.isfinite(gap) and 5<=gap<=40,'Proposed gap must be 5..40 mm')
    base_height=gap-DROP-THICKNESS
    spacer=cad.ring(44,57,base_height)
    raised_seat=cad.ring(44,46,DROP,base_height)
    ramps=[]
    buffer=cad.ring(44,46,THICKNESS,gap-THICKNESS)
    neutral_extra=math.hypot(RAMP_END-RAMP_START,DROP)-(RAMP_END-RAMP_START)
    # Build the flat pattern from the same annulus and all four developed ears.
    flat=cad.ring(44,46,THICKNESS)
    length=next(value for value in (12,16,20,25,30,35,40,45,50) if value>=gap+4.8)
    joints=[]
    for angle in (45,135,225,315):
        buffer+=ear_profile(gap).rotate(Axis.Z,angle)
        # Relief separates the mitered bend from the raised annular seat.
        notch=r.block(3,8.4,DROP+.2,(47.,0,base_height-.1)).rotate(Axis.Z,angle)
        raised_seat-=notch
        ramps.append(ramp_support(gap).translate((0,0,-.05)).rotate(Axis.Z,angle))
        pattern_ear=r.block(EAR_END-45.7+neutral_extra,EAR_WIDTH,THICKNESS,
                            ((EAR_END+45.7+neutral_extra)/2,0,0)).rotate(Axis.Z,angle)
        flat+=pattern_ear
        x,y=53*math.cos(math.radians(angle)),53*math.sin(math.radians(angle))
        top=gap-CLEARANCE
        screw=flat_screw(x,y,top,length)
        joint=r.Joint(f'buffer-flat-{angle}',(x,y),top,-1,length,screw,r.nut(x,y,-4.8),
                      length_basis='including-head',standard='ISO10642')
        joints.append(joint)
        hole=r.bore(x,y,-12,gap+3)
        seat=cone_seat(x,y,top)
        buffer=buffer-hole-seat
        spacer=spacer-hole-seat
        roof=roof-hole-r.pocket(x,y,-10.1,-2.2)
        # Flat ear hole moves outward by the developed ramp allowance.
        px,py=(53+neutral_extra)*math.cos(math.radians(angle)),(53+neutral_extra)*math.sin(math.radians(angle))
        flat-=r.bore(px,py,-1,3)+cone_seat(px,py,1+DROP-CLEARANCE)
    spacer+=raised_seat
    for ramp in ramps:spacer+=ramp
    # The added seats receive the same bolt bores.
    for joint in joints:
        x,y=joint.expected_xy
        spacer-=r.bore(x,y,-12,gap+3)+cone_seat(x,y,gap-CLEARANCE)
    return dict(roof=roof,spacer=spacer,buffer=buffer,flat_pattern=flat,pairs=joints,
                gap=gap,screw_length_including_head=length,neutral_ramp_extra=neutral_extra)



def verify_seated_head_tolerances(kit):
    body=kit['roof']+kit['spacer']+kit['buffer']
    rows=[]
    ear_top=kit['gap']-DROP
    seat_radius=FLAT_HEAD_DIAMETER/2-(DROP-CLEARANCE)+.05
    for joint in kit['pairs']:
        x,y=joint.expected_xy
        for diameter in (5.54,6.72):
            for angle in (90,92):
                # A smaller head seats farther down the same cone. Add 0.01 mm
                # free assembly clearance, then test a real inward load attempt.
                top=ear_top+(diameter/2-seat_radius)/math.tan(math.radians(angle/2))+.01
                screw=flat_screw(x,y,top,joint.length,diameter,angle)
                seated=r.Joint(joint.name,joint.expected_xy,top,-1,joint.length,screw,joint.nut,
                               length_basis='including-head',standard='ISO10642')
                r.check_joint(seated,body)
                lift=audit.intersection(kit['buffer'].translate((0,0,.3)),screw)
                audit.require(lift>1e-4,'Minimum flat head does not retain PTFE after seating')
                below_root_guard([('seated flat screw',screw)],kit['gap'])
                rows.append(dict(joint=joint.name,head_diameter_mm=diameter,angle_degrees=angle,
                                 seated_head_top_z_mm=top,axial_lift_attempt_overlap_mm3=lift))
    return rows


def verify(kit):
    for name in ('roof','spacer','buffer','flat_pattern'):
        part=kit[name]
        audit.require(part.is_valid and len(part.solids())==1,'Invalid below-root buffer '+name)
    audit.require(audit.intersection(kit['buffer'],kit['spacer'])<1e-6,'Formed PTFE overlaps support ramp')
    audit.require(math.isclose(kit['buffer'].volume,kit['flat_pattern'].volume,rel_tol=1e-7),
                  'Formed sheet and developed flat pattern change stock volume')
    fixed=kit['roof']+kit['spacer']+kit['buffer']
    joints=r.check_joints(kit['pairs'],fixed)
    hardware=r.joint_hardware(kit['pairs'])
    screw_shapes=[joint.screw for joint in kit['pairs']]
    up=kit['buffer'].translate((0,0,.3))
    axial=sum(audit.intersection(up,part) for part in screw_shapes)
    audit.require(axial>1e-4,'Flat screw cones do not retain PTFE axially')
    for dx,dy in ((.5,0),(-.5,0),(0,.5),(0,-.5)):
        shifted=kit['buffer'].translate((dx,dy,0))
        audit.require(sum(audit.intersection(shifted,part) for part in screw_shapes)>1e-4,
                      'Flat screw holes do not retain PTFE radially')
    audit.require(audit.intersection(up,kit['spacer']+kit['roof'])<1e-6,
                  'Missing-screw negative control cannot lift free')
    guard=below_root_guard([('spacer',kit['spacer']),('PTFE',kit['buffer']),
                           *[(f'hardware-{index}',part) for index,part in enumerate(hardware)]],kit['gap'])
    head_tolerances=verify_seated_head_tolerances(kit)
    return dict(positive_axial_capture_by_four_standard_cones=True,axial_attempt_overlap_mm3=axial,
                positive_radial_capture_by_standard_screws=True,joints=joints,root_plane_guard=guard,
                seated_head_tolerance_checks=head_tolerances,
                material_id_mm=88,active_flat_od_mm=92,material_nominal_thickness_mm=1,
                ear_width_mm=EAR_WIDTH,outer_ear_drop_mm=DROP,ramp_projected_run_mm=2,
                developed_ramp_length_mm=math.hypot(2,DROP),flat_pattern_extra_radial_length_mm=kit['neutral_ramp_extra'],
                flat_and_formed_sheet_volume_match=True,
                flat_head_source=FLAT_SCREW_SOURCE,flat_head_max_diameter_height_mm=[6.72,1.86],
                head_top_below_root_mm=CLEARANCE,total_screw_length_including_head_mm=kit['screw_length_including_head'],
                same_ordinary_2mm_hex_driver=True,above_root_retainer_print_parts=0,
                maximum_head_to_ear_side_and_end_margin_mm=(EAR_WIDTH-FLAT_HEAD_DIAMETER)/2,
                physical_PTFE_forming_counterseating_creep_and_drag_verified=False,
                physical_outer_ball_shell_fit_verified=False,actual_collar_integration_verified=False)
