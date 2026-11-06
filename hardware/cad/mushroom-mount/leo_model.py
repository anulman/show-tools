"""Opt-in wall-connected 45-degree support for roof-down mushroom printing."""
from copy import deepcopy
from pathlib import Path
import importlib.util
from build123d import Axis, Plane, Polygon, extrude
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('mushroom_leo_baseline',HERE/'model.py')
baseline=importlib.util.module_from_spec(spec);spec.loader.exec_module(baseline)
AXES=[(x,y) for x in (-30.,30.) for y in (-33.,33.)]


def build():
    data=baseline.build();original=deepcopy(data['parts']['shell']);wedges=[];rows=[]
    # Each ramp grows 1 mm inward for every 1 mm printed down from a wall.
    # Clip to the original boss footprint, avoiding new protrusions into chamber.
    ramp=extrude(Plane.XZ*Polygon((-8,0),(8,0),(8,16),align=None),amount=10,both=True)
    for x,y in AXES:
        toward_x=ramp.rotate(Axis.Z,0 if x>0 else 180)
        toward_y=ramp.rotate(Axis.Z,90 if y>0 else -90)
        region=baseline.cylinder(8,16,15,(x,y))
        wedge=((toward_x+toward_y).translate((x,y,15)) & region)
        wedge-=baseline.cylinder(1.8,18,14,(x,y))
        wedges.append(wedge)
        rows.append(dict(axis_xy_mm=[x,y],boss_radius_mm=8,unchanged_boss_top_z_mm=15,
                         support_region_z_mm=[15,31],ramp_angle_degrees=45,
                         nearby_inner_walls_xy_mm=[37 if x>0 else -37,40 if y>0 else -40]))
    shell=deepcopy(original)
    for wedge in wedges:shell+=wedge
    data['parts']=dict(shell=shell,bottom=data['parts']['bottom'])
    data.update(original_shell=original,wedges=wedges,features=rows)
    return data
