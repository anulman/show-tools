"""One reduced C variant: original split, cover fused to B, assembly driver slot."""
from __future__ import annotations
from dataclasses import dataclass
from copy import deepcopy
import hashlib,json
from pathlib import Path
from build123d import Axis,import_step
from . import post_glue_couplings as m
c=m.c
BASELINE_SHA='8d483074030cab6ffaeeaa4464259b1fa221faa140dff14c1b4ad958632b26e4'
LOCK_HALF='removable lock and driver half A'
FUSED_HALF='integrated half B and capture cover'
REMOVED={'external axial screw capture cover','removable collar half A','removable collar half B',
         'external cover M3x8 screw 15.0','external cover M3 nut 15.0',
         'external cover M3x8 screw 310.0','external cover M3 nut 310.0'}


@dataclass
class Reduced:
    baseline:dict
    bar:object
    parts:list
    stages:dict
    rotating:set
    inputs:dict


def build(baseline_path):
    raw=baseline_path.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=BASELINE_SHA:raise ValueError('Wrong immutable C456 baseline')
    baseline=json.loads(raw);inputs={str(baseline_path.resolve()):BASELINE_SHA}
    def load(record):
        for kind in ('step','stl'):
            file=Path(record[kind]);sha=hashlib.sha256(file.read_bytes()).hexdigest()
            if sha!=record[kind+'_sha256']:raise ValueError('Changed baseline '+kind)
            inputs[str(file.resolve())]=sha
        shape=import_step(record['step'])
        if not shape.is_valid or len(shape.solids())!=1:raise ValueError('Invalid actual baseline part')
        return shape.solids()[0]
    bar=load(baseline['environment']);parts={q['name']:c.Piece(q['name'],load(q),q['role']) for q in baseline['stages']['inserted']['components']}
    for name,part in parts.items():
        if name!='removable padded knob cup' and not name.startswith(('-1','+1')):part.shape=part.shape.translate((0,0,.5))
    cover=parts['external axial screw capture cover'].shape
    x,y=m.old.xy(38.5,260.)
    slot=c.cyl(5.5,4.,(x,y,8.5))+c.cyl(5.5,4.,(x-35.,y,8.5))+c.box(35.,11.,4.,(x-17.5,y,8.5))
    opened=cover-slot
    if not opened.is_valid or len(opened.solids())!=1:raise ValueError('Assembly slot disconnects cover')
    fused=parts['removable collar half B'].shape+opened
    for angle in (15.,310.):fused+=c.cyl(4.,8.,(*m.old.xy(38.,angle),5.5))
    if not fused.is_valid or len(fused.solids())!=1:raise ValueError('Integrated B/cover is not one valid solid')
    final=[q for n,q in parts.items() if n not in REMOVED]
    final.extend([c.Piece(LOCK_HALF,parts['removable collar half A'].shape,'print'),c.Piece(FUSED_HALF,fused,'print')])
    if len(final)!=17:raise ValueError('Reduced actor count differs')
    stages={stage:deepcopy(record['source_pose']) for stage,record in baseline['stages'].items()}
    rotating={q.name for q in final if q.name!='removable padded knob cup' and not q.name.startswith(('-1','+1'))}
    return Reduced(baseline,bar,final,stages,rotating,inputs)


def posed(candidate,stage):
    values=candidate.stages[stage];result=[]
    for q in candidate.parts:
        shape=q.shape
        if q.name.startswith('threaded M4 full nut'):shape=shape.translate((0,0,values['nut_drop']))
        if q.name.startswith('axial M4x12 socket screw'):
            point=m.old.xy(38.,110.)
            shape=shape.rotate(Axis((*point,0),(0,0,1)),-(values['nut_drop']-values['head_drop'])/.7*360).translate((0,0,values['head_drop']))
        if q.name in candidate.rotating:shape=shape.rotate(Axis.Z,values['angle']).translate((0,0,values['collar_shift']))
        result.append(c.Piece(q.name,shape.translate((0,0,values['shift'])),q.role))
    return result
