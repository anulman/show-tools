"""Check standard M3 grip hardware envelopes against the current integral bar."""
from copy import deepcopy
import importlib
import json
import math
from pathlib import Path
import sys

from build123d import Axis
import five_part_print as packet
sys.path.insert(0,str(Path(__file__).parent/'box-mount/access'))
import panel_mount_box_concept as panel
cad=importlib.import_module('disco-bar.full_height')


def check(output):
    shapes,_,provenance=packet.admit()
    bar=shapes['bar'];fingerprint=panel.previous.inherited.fingerprint(bar)
    rows=[]
    with panel.previous.inherited.detached_booleans():
        for sign in (-1,1):
            for length in (5.76,6.,6.24):
                screw=cad.cyl(1.5,length,(sign*(26.8+length/2),0,9),'x')
                overlap=panel.g.intersection(screw,bar)
                assert overlap<1e-6
                rows.append(dict(sign=sign,part='ISO4026 M3 flat-point set screw',length_mm=length,
                    source_tip_abs_x_mm=26.8,bar_overlap_mm3=overlap,
                    minimum_outboard_extent_past_nut_face_mm=26.8+length-30.3))
            for af,height in ((5.5,2.4),(5.32,2.15)):
                centre=(sign*(30.3-height/2),0,9)
                nut=cad.hexagon(af/math.sqrt(3),height,centre,'x')
                nut-=cad.cyl(1.55,height+.2,centre,'x')
                overlap=panel.g.intersection(nut,bar)
                assert overlap<1e-6
                if af==5.32:
                    nut &= cad.cyl(6.01/2,height+.2,centre,'x')
                turned=deepcopy(nut).rotate(Axis(centre,(1,0,0)),30)
                blocked=panel.g.intersection(turned,bar)
                assert blocked>1e-6
                rows.append(dict(sign=sign,part='plain DIN934 M3 nut',af_mm=af,height_mm=height,
                    bar_overlap_mm3=overlap,rotation30_interference_mm3=blocked))
    assert bar.is_valid and panel.previous.inherited.fingerprint(bar)==fingerprint
    result=dict(scope='STANDARD_M3_GRIP_HARDWARE_NOMINAL_GEOMETRY',provenance=provenance,
        checks=rows,actual_subject_unchanged=True,standard_dimensions_match=True,
        purchase_specs=dict(grip=dict(screws=2,thread='M3 x 0.5',length_mm=6,
            standard='ISO4026 / DIN913 flat point',key_af_mm=1.5),
            cover=dict(screws=4,thread='M3 x 0.5',under_head_length_mm=10,
                standard='ISO7380-1 button head',key_af_mm=2),
            nuts=dict(quantity=6,thread='M3 x 0.5',standard='DIN934 plain full nut',af_max_mm=5.5,height_max_mm=2.4)),
        sources=['https://eshop.boellhoff.de/out/media/pdf/ISO_4026_Edelstahl_A2___en.pdf',
            'https://www.accu.co.uk/flat-point-set-screws/4514-SSF-M3-6-A2',
            'https://www.accu.co.uk/api/product-datasheet?id=8103',
            'https://www.accu.co.uk/api/product-datasheet?id=7888'],
        physical_fit_verified=False,strength_or_torque_verified=False)
    assert not output.exists();output.write_text(json.dumps(result,indent=2)+'\n')
    print(output)


if __name__=='__main__':check(Path(sys.argv[1]))
