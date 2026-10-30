"""Nominal OEM-interface and monotone box withdrawal proof on delivered artifacts.

Knob geometry is a conservative envelope within the operator-accepted original
socket. Actual OEM dimensions, pad force/friction and resin fit are not certified.
"""
from __future__ import annotations
import argparse,hashlib,importlib,json,math,os,sys
from pathlib import Path
HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(HERE));sys.path.insert(0,str(HERE/'box-mount/access'))
from geometry_artifacts import Artifacts
import geometry_artifacts
import post_glue_base_gate as gate
from build123d import Axis
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
c=importlib.import_module('disco-bar.full_height')
a=importlib.import_module('disco-bar.debond_checks')


def run(receipt,expected,base_receipt,output):
    if os.path.lexists(output):raise ValueError('Use a fresh proof namespace')
    raw=receipt.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=expected:raise ValueError('Unexpected frozen candidate')
    report=json.loads(raw);files=Artifacts()
    parts=[(q['name'],q['role'],files.load(q)) for q in report['stages']['inserted']['components']]
    sources={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in
             (Path(__file__).resolve(),Path(geometry_artifacts.__file__).resolve(),Path(gate.__file__).resolve())}
    knob=c.cyl(22.177375,125.4,(0,0,37.3))  # -25.4 through +100, full monotone entry/exit
    pad_inner=c.cyl(21.977365,125.4,(0,0,37.3))
    rows=[]
    for name,role,part in parts:
        hit=a.channel_boolean(BRepAlgoAPI_Common,part.wrapped,(pad_inner if role=='pad' else knob).wrapped)
        amount=a.channel_material_volume(hit)
        if amount>1e-5:raise ValueError('Nominal knob path blocked: '+name)
        rows.append(dict(name=name,rigid_intersection_mm3=amount,
                         permitted_soft_pad_radial_compression_mm=.20001 if role=='pad' else 0))
    data=gate.load_base(base_receipt)
    module_rows={}
    for gap in (5.,7.):
        # This envelope is upward closed through the complete 100mm service stroke.
        # Its inner radial bound only decreases with height; no part below3.5
        # may use the legacy R33 lower band.
        window=gate.cad.ring(33.5,43.5,16.,-12.5)
        window+=gate.cad.ring(30.,43.5,gap-3.5,3.5)
        window+=gate.cad.cyl(100.,200.-gap,gap)
        _,fixed=gate.fixed_geometry(data,gap)
        for name,shape in fixed.items():
            if gate.intersection(window,shape)>1e-6:raise ValueError('Module service envelope hits base: '+name)
        checked=[]
        for name,role,part in parts:
            world=gate.audit.pose(part,gap,-90)
            residual=gate.outside_volume(world,window)
            if residual>1e-6:raise ValueError('Module escapes monotone withdrawal envelope: '+name)
            checked.append(dict(name=name,outside_monotone_envelope_mm3=residual))
        gap_to_hex=gap+.25  # measured hex upper face at -.25; accepted nominal knob height equals socket depth
        if not 4.7625<=gap_to_hex<=22.225:raise ValueError('Nominal knob/hex gap outside operator range')
        module_rows[str(int(gap))]=dict(continuous_upward_stroke_mm=100,arbitrary_rotational_index_clear=True,
            hex_top_to_knob_underside_mm=gap_to_hex,components=checked)
    files.unchanged();gate.unchanged(data)
    if receipt.read_bytes()!=raw:raise ValueError('Candidate changed during proof')
    for p,sha in sources.items():
        if hashlib.sha256(Path(p).read_bytes()).hexdigest()!=sha:raise ValueError('Checker source changed')
    output.mkdir(parents=True,exist_ok=False)
    result=dict(schema=1,scope='NOMINAL OEM INTERFACE AND MONOTONE MODULE SERVICE CLEARANCE',
        candidate_receipt_sha256=expected,actual_delivered_files=True,checks=rows,base=module_rows,
        nominal_knob_envelope=dict(maximum_diameter_mm=44.35475,height_mm=25.4,
            basis='Original accepted socket envelope; NOT a measured actual knob diameter'),
        assumptions=['Stock knob fits the original socket as accepted by operator; actual physical fit remains unverified.',
                     'Soft2mm pads can compress up to0.20001mm without excessive force; force/friction/recovery unverified.',
                     'Ball/bar is removed and placed aside before lifting the module from the knob; grip screws released.'],
        physical_fit_verified=False,grip_strength_verified=False,source_sha256=sources,
        input_artifact_sha256=files.files,base_input_artifacts=data['artifacts'].files)
    with (output/'receipt.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
    print(output/'receipt.json',flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('receipt','base-receipt','output'):p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--expected-sha256',required=True);x=p.parse_args()
    run(x.receipt,x.expected_sha256,x.base_receipt,x.output)
