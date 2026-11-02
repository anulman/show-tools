"""Export the current assembled disco mechanism as one view-only inch STL."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import sys

import numpy as np
import trimesh
from build123d import Align,Cylinder,export_stl
import concept_preview
import spinner_reference
from five_part_print import mesh

HEADER=b'VIEW ONLY - ASSEMBLED MECHANISM - DO NOT PRINT - INCH COORDINATES'


def export(output):
    if output.exists():raise ValueError('Preserve existing preview; use a fresh output directory')
    data,selection,parts=concept_preview.load()
    current=[(p,s) for p,s in parts if p.name.startswith('STUDY ')]
    bar=next(p for p,s in current if 'integral' in p.name)
    roof=data['study_parameters']['roof_height_above_ground_mm']
    extra,names,_,_,reference=spinner_reference.scene(roof,*bar.translation_mm[:2])
    extra[0]=Cylinder(22,25.4,align=(Align.CENTER,Align.CENTER,Align.MIN)).translate((bar.translation_mm[0],bar.translation_mm[1],roof+2.38125))
    names[0]='REFERENCE knob envelope - nominal diameter and approximate overall height'
    marker=Cylinder(.5,16,align=(Align.CENTER,Align.CENTER,Align.MIN)).translate((bar.translation_mm[0],bar.translation_mm[1],roof-59))
    subjects=[(p.name,s) for p,s in current]+[(n,s) for n,s in zip(names,extra) if s.solids()]
    subjects.append(('REFERENCE rear shaft axis marker - display thickness only',marker))
    output.mkdir(parents=True);meshes=[];rows=[]
    with tempfile.TemporaryDirectory(prefix='assembled-disco-preview-') as temporary:
        for index,(name,shape) in enumerate(subjects):
            posed=deepcopy(shape).translate((-bar.translation_mm[0],-bar.translation_mm[1],0))
            path=Path(temporary)/(str(index)+'.stl')
            if not export_stl(posed,path,tolerance=.03,angular_tolerance=.1):raise ValueError('Preview tessellation failed')
            actual=mesh(path.read_bytes());actual.apply_scale(1/25.4)
            meshes.append(actual);rows.append(dict(name=name,triangles=len(actual.faces)))
    combined=trimesh.util.concatenate(meshes)
    target=output/'DISCO-MECHANISM-ASSEMBLED-VIEW-ONLY-INCH.stl'
    raw=combined.export(file_type='stl');target.write_bytes(HEADER.ljust(80,b'\0')+raw[80:])
    restored=trimesh.load_mesh(target,process=False)
    if (restored.triangles.shape!=combined.triangles.shape
            or not np.allclose(restored.triangles,combined.triangles,atol=1e-6,rtol=0)):
        raise ValueError('Assembly export changed placements or scale')
    if abs(restored.bounds[0,2])>1e-6:raise ValueError('Assembled bottom must stay on desk Z=0')
    for part,_ in current:
        if concept_preview.digest(part.path)!=part.sha256:raise ValueError('Changed assembly input')
    report=dict(purpose='ASSEMBLED_VISUAL_REFERENCE_NOT_FOR_FABRICATION',coordinate_unit='inch',
        selection=selection,components=rows,component_count=len(rows),printed_piece_count=5,
        spinner_reference=reference,rear_shaft_axis_marker_diameter_mm=1,axis_marker_is_not_measured_shaft_diameter=True,knob_simplified_to_envelope=True,
        parts_kept_in_assembled_positions=True,components_not_boolean_fused=True,
        dimensions_inches=restored.extents.tolist(),manufacturing_approved=False,
        file=dict(path=str(target.resolve()),sha256=hashlib.sha256(target.read_bytes()).hexdigest()))
    (output/'preview-validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':export(Path(sys.argv[1]))
