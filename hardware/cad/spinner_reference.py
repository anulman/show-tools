"""Display-only SpinTrak reference from published axial dimensions."""
import hashlib
import json
from pathlib import Path

from build123d import Align, Box, Cylinder, Edge, Sphere

HERE = Path(__file__).resolve().parent
FACTS = HERE / 'fabrication/interface-facts.json'


def scene(roof_height, x=0, y=0):
    facts=json.loads(FACTS.read_text())['spinner']
    axial=facts['nominal_axial_dimensions_below_fixed_flange_mm']
    body=axial['threaded_body'];encoder=axial['encoder_housing'];tail=axial['rear_shaft_extension']
    assert body+encoder+tail==axial['total']
    radius=facts['body_diameter_nominal']/2
    align=(Align.CENTER,Align.CENTER,Align.MIN)
    threaded=Cylinder(radius,body,align=align).translate((0,0,-body))
    housing=Cylinder(radius,encoder,align=align).translate((0,0,-body-encoder))
    rear_axis=Edge.make_line((0,0,-body-encoder),(0,0,-body-encoder-tail))
    knob_radius=facts['large_knob_diameter_nominal']/2
    full_width_height=22.225;dome_height=3.175;flange=2.38125
    dome_radius=(knob_radius**2+dome_height**2)/(2*dome_height)
    dome=Sphere(dome_radius).translate((0,0,full_width_height+dome_height-dome_radius))
    dome &= Box(2*dome_radius,2*dome_radius,dome_height,align=align).translate((0,0,full_width_height))
    knob=(Cylinder(knob_radius,full_width_height,align=align)+dome).translate((0,0,flange))
    objects=[knob,threaded,housing,rear_axis]
    for shape in objects:
        if not shape.is_valid:raise ValueError('Invalid spinner display reference')
    objects=[s.translate((x,y,roof_height)) for s in objects]
    names=['REFERENCE red knob - nominal 44mm; approximate operator height/profile',
        'REFERENCE fixed threaded body - drawing 28mm axial length, 28mm diameter',
        'REFERENCE encoder housing - drawing 15mm length; conservative 28mm diameter envelope',
        'REFERENCE rear shaft AXIS ONLY - drawing 16mm extension; diameter unspecified; total depth 2.32in']
    provenance=dict(display_only=True,manufacturer_step_available=False,
        facts=dict(path=str(FACTS),sha256=hashlib.sha256(FACTS.read_bytes()).hexdigest()),
        source= axial['source'],axial_total_mm=body+encoder+tail,
        encoder_diameter_is_conservative_envelope=True,rear_shaft_is_axis_without_assumed_diameter=True,
        knob_profile_is_approximate=True,physical_fit_verified=False)
    return objects,names,['#bd3344','#aab2ba','#30383f','#485967'],[.8,.85,.55,1.],provenance
