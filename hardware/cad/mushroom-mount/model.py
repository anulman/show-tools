"""Two-piece nominal NHD NPB22-M611R enclosure. All coordinates are mm."""
from copy import deepcopy
from pathlib import Path
import sys
from build123d import Align, Axis, Box, Cylinder, GeomType, RectangleRounded, extrude
CAD = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CAD / 'box-mount/access'))
import resin_retention as retention

P = dict(width=80., length=86., corner_radius=10., wall=3., roof_z=62.,
         roof_thickness=4., bottom_thickness=3., mounting_hole=23.,
         key_hole=3.2, key_offset=11.3, outside_chamfer=1.,
         cable_exit_width=12., cable_exit_height=8.)
NHD = dict(model='NPB22-M611R', head_diameter=60., front_projection=30.7,
           rear_depth=47.5, rear_side_height=45.5, maximum_panel_thickness=5.,
           mounting_hole=23., antirotation_hole=3.2, antirotation_offset=11.3)


def block(x, y, h, z, xy=(0, 0)):
    return Box(x, y, h, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate((*xy,z))


def cylinder(r, h, z, xy=(0, 0)):
    return Cylinder(r, h, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate((*xy,z))


def rounded(w, l, r, h, z):
    return extrude(RectangleRounded(w,l,r), amount=h).translate((0,0,z))


def build():
    floor=P['bottom_thickness']; roof=P['roof_z']; wall=P['wall']
    shell=rounded(80,86,10,roof-floor,floor)-rounded(74,80,7,roof-4-floor,floor)
    # Select only the exterior lower perimeter before any internal joint is added.
    edges=[e for e in shell.edges() if abs(e.bounding_box().min.Z-floor)<1e-6
           and abs(e.bounding_box().max.Z-floor)<1e-6
           and (abs(e.center().X)>37.1 or abs(e.center().Y)>40.1)]
    before=deepcopy(shell)
    shell=shell.chamfer(1,None,edges)
    chamfer_removed=before-shell
    # NHD's optional key hole overlaps the main hole; centre is 11.3 from axis.
    mounting=cylinder(11.5,6,roof-5)+cylinder(1.6,6,roof-5,(0,11.3))
    shell-=mounting
    axes=[(x,y) for x in (-30.,30.) for y in (-33.,33.)]
    for xy in axes:shell+=cylinder(8,12,floor,xy)
    bottom=rounded(80,86,10,3,0)
    covers=retention.standard_covers(shell,bottom,axes,floor,0)
    shell,bottom=covers['shell'],covers['bottom']
    exits=[]
    for sign in (-1,1):
        route=block(12,12,8,floor,(0,sign*42))
        shell-=route;exits.append(route)
    # Display reference is deliberately simplified, not an upstream CAD model.
    # Rear square is a conservative study envelope: only side height is published.
    rear=block(45.5,45.5,47.5-4,roof-47.5)
    stem=cylinder(11,26.7,roof-4)
    bezel=cylinder(14.5,2,roof)
    head=cylinder(30,8,roof+30.7-8)
    top=[e for e in head.edges() if e.geom_type==GeomType.CIRCLE and e.center().Z>roof+30.6]
    head=head.fillet(2,top)
    return dict(parts=dict(shell=shell,bottom=bottom),covers=covers,exits=exits,
                mounting=mounting,reference=[rear,stem+bezel,head],
                chamfer_removed=chamfer_removed)
