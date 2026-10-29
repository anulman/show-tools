"""Check added assembly geometry against the operator-confirmed ball opening."""
from __future__ import annotations
from dataclasses import dataclass
from math import isfinite

from build123d import Box, Cylinder, Align

BAR_RADIUS_MM = 47.2306651
NUMERIC_EPS_MM = .0001
VOLUME_EPS_MM3 = 1e-5


def volume(shape):
    return sum(s.volume for s in shape.solids()) if shape is not None else 0.


@dataclass(frozen=True)
class Opening:
    root_z: float
    ball_inside_direction: str
    external_setback_mm: float = .5
    radius_mm: float = BAR_RADIUS_MM

    def __post_init__(self):
        if (self.ball_inside_direction not in ('+z','-z')
                or not all(isfinite(x) for x in (self.root_z,self.external_setback_mm,self.radius_mm))
                or self.external_setback_mm < 0 or self.radius_mm <= 0):
            raise ValueError('Specify a finite opening plane, direction and radial bound')

    def verify(self, named_shapes):
        """Parts use assembly XY centred on the bar axis, never scene offsets.

        The radial epsilon handles CAD numerical noise only. It is not a
        fabrication fit allowance. Added geometry outside that radial bound
        must stay on the external side of the opening, with the chosen setback.
        """
        for name,shape in named_shapes:
            if not shape.is_valid:
                raise ValueError('Invalid opening-guard component: '+name)
            bb=shape.bounding_box()
            low,high=bb.min.Z-1,bb.max.Z+1
            radial_tool=Cylinder(self.radius_mm+NUMERIC_EPS_MM,high-low,
                                 align=(Align.CENTER,Align.CENTER,Align.MIN)).translate((0,0,low))
            outside=shape-radial_tool
            if volume(outside)<VOLUME_EPS_MM3:
                continue
            if self.ball_inside_direction=='+z':
                start=max(low,self.root_z-self.external_setback_mm)
                stop=high
            else:
                start=low
                stop=min(high,self.root_z+self.external_setback_mm)
            if stop<=start:
                continue
            x=max(abs(bb.min.X),abs(bb.max.X))+1
            y=max(abs(bb.min.Y),abs(bb.max.Y))+1
            forbidden=Box(2*x,2*y,stop-start,
                          align=(Align.CENTER,Align.CENTER,Align.MIN)).translate((0,0,start))
            if volume(outside & forbidden)>VOLUME_EPS_MM3:
                raise ValueError('Outside bar profile intrudes into ball-opening clearance: '+name)
        return dict(opening_root_z_mm=self.root_z,ball_inside_direction=self.ball_inside_direction,
                    source_bar_radius_mm=self.radius_mm,external_setback_mm=self.external_setback_mm,
                    ball_surface_reconstruction_claimed=False)
