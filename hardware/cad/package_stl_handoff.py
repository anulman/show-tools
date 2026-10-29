"""Package one of each requested CAD proposal, validating every delivered STL."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import zipfile

import numpy as np
import trimesh
from build123d import import_step

import box_mount
import disco_bar
import final_review


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower().replace('-1', 'minus-1').replace('+1', 'plus-1')).strip('-')


def run(args):
    output = args.output.resolve()
    require(not output.exists(), 'Use a new output directory; never overwrite an issued handoff')
    selected = final_review.load(args.registry)
    # These verify exact inventories, source hashes, STEP/STL pairs and source
    # geometry identity rather than trusting a receipt's own completeness claim.
    actual = {kind: {p.name: p.shape for p in selected.parts(kind)} for kind in ('disco', 'box')}
    arcade_path = args.arcade_receipt.resolve()
    arcade = json.loads(arcade_path.read_text())
    require(arcade['source_sha256'] == sha(Path(box_mount.__file__)), 'Arcade source changed')
    require(set(arcade['concepts']) == {'arcade-inclined'}, 'Supply the single inclined arcade export')
    parameters = box_mount.Proposal(**arcade['parameters'])
    expected_arcade = box_mount.build(parameters, 'arcade-inclined')
    box_mount.verify_assembly(parameters, 'arcade-inclined', expected_arcade)
    original_path, original = disco_bar.load_reference(args.step)
    disco_bar.verify_full_reference(original_path, original)
    require(sha(original_path) == selected.registry['reference']['sha256'], 'Different original selected')
    output.mkdir(parents=True)
    records = []

    def add(source, relative, shape, *, category, expected_hash=None, description=''):
        source = Path(source)
        if expected_hash is not None:
            require(sha(source) == expected_hash, 'Source STL changed: '+str(source))
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        require(not target.exists(), 'Duplicate handoff filename: '+relative)
        shutil.copyfile(source, target)
        mesh = trimesh.load_mesh(target)
        require(isinstance(mesh, trimesh.Trimesh) and np.isfinite(mesh.vertices).all(), 'Invalid mesh data')
        require(mesh.is_watertight and mesh.is_winding_consistent and mesh.volume > 0,
                'Non-watertight, inconsistent or nonpositive STL: '+relative)
        boundary_shells = mesh.split(only_watertight=False)
        require(len(boundary_shells) == len(shape.shells()) and all(s.is_watertight for s in boundary_shells),
                'STL boundary shells differ from CAD: '+relative)
        require(shape.is_valid and len(shape.solids()) == 1, 'Invalid source solid: '+relative)
        require(math.isclose(float(mesh.volume), shape.volume, rel_tol=.005), 'STL volume differs: '+relative)
        bounds = shape.bounding_box()
        require(np.allclose(mesh.bounds, [[bounds.min.X,bounds.min.Y,bounds.min.Z],
                                         [bounds.max.X,bounds.max.Y,bounds.max.Z]], atol=.055, rtol=0),
                'STL bounds differ: '+relative)
        require(sha(target) == sha(source), 'Copy changed STL bytes')
        records.append(dict(file=relative, quantity=1, category=category, description=description,
                            sha256=sha(target), source_stl=str(source), source_sha256=sha(source),
                            volume_mm3=float(mesh.volume), bounds_mm=mesh.bounds.tolist(),
                            watertight=True, winding_consistent=True, cad_solids=1,
                            stl_boundary_shells=len(boundary_shells), enclosed_boundary_shells=len(boundary_shells)-1))

    for name, shape in zip(('shell','bottom'), expected_arcade[:2]):
        record = arcade['concepts']['arcade-inclined']['parts'][name]
        source_dir = arcade_path.parent / 'arcade-inclined'
        stl_name = next(n for n in record['files'] if n.endswith('.stl'))
        step_name = next(n for n in record['files'] if n.endswith('.step'))
        step = source_dir / step_name
        require(sha(step) == record['files'][step_name], 'Arcade STEP changed')
        restored = import_step(step).solids()[0]
        require(box_mount.volume(restored-shape)<1e-5 and box_mount.volume(shape-restored)<1e-5,
                'Arcade export differs from source geometry')
        add(source_dir/stl_name, f'01-arcade-button-box/{name}.stl', shape,
            category='proposed-print-part', expected_hash=record['files'][stl_name])

    for kind, folder in (('box','02-knob-mounting-box'), ('disco','04-collar-bar-assembly')):
        for record in selected.reports[kind]['review_components']:
            name, role = record['name'], record['role']
            if role in ('body','bar','print','proposed print geometry'):
                target = f'{folder}/{slug(name)}.stl'
                category = 'proposed-print-part'
            elif role == 'custom fabricated control proposal':
                target = '05-custom-fabrication/'+slug(name)+'.stl'
                category = 'custom-fabrication-proposal'
            elif role in ('pad','unselected low-drag material envelope'):
                target = '06-material-reference-envelopes/'+slug(name)+'.stl'
                category = 'material-envelope-not-print-part'
            else:
                continue  # Purchased screw/nut envelopes are not print instructions.
            add(record['stl'], target, actual[kind][name], category=category,
                expected_hash=record['stl_sha256'], description=name+'; '+role)

    original_dir = output.parent / (output.name+'-original-source')
    require(not original_dir.exists(), 'Use a fresh original-source export directory')
    original_dir.mkdir()
    original_record = box_mount.export_part(original, original_dir/'darren-original-bar-mm')
    original_stl = original_dir/'darren-original-bar-mm.stl'
    add(original_stl, '03-darren-original-bar/original-bar.stl', original,
        category='original-design-export', expected_hash=original_record['files'][original_stl.name],
        description='Unmodified pinned STEP geometry; exported in millimetres, not the differently-scaled supplied STL')

    for name in ('driver locked','fork pushed','spanner locked'):
        record = next(r for r in selected.reports['disco']['tools'] if r['name']==name)
        shape = selected.artifacts.load(record)
        add(record['stl'], '05-custom-fabrication/'+name.split()[0]+'-tool.stl', shape,
            category='custom-tool-fabrication-proposal', expected_hash=record['stl_sha256'])

    selected.assert_current()
    require(sha(arcade_path)==args.arcade_sha, 'Arcade receipt changed during packaging')
    require(sha(original_path)==disco_bar.REFERENCE_SHA256, 'Original changed during packaging')
    counts = {category:sum(r['category']==category for r in records) for category in sorted({r['category'] for r in records})}
    require(len(records)==22 and counts['proposed-print-part']==14 and counts['original-design-export']==1,
            'Unexpected handoff inventory')
    readme = '''# STL handoff for geometry review and prototype planning

All STL coordinates are millimetres. Each file represents quantity 1. Preserve scale on import. Files retain their checked assembly coordinates; use the slicer's move-to-bed and arrange controls. This package does not select print orientation, supports, material, tolerances, or printer settings.

- 01-arcade-button-box: one 5-degree inclined housing and removable bottom. Confirmed axial wiring reserve is 63.5 mm (2.5 inches).
- 02-knob-mounting-box: one housing, bottom, spacer, and two stock-hex keeper tabs. The separate buffer is a material reference in folder 06.
- 03-darren-original-bar: one unchanged original bar, re-exported from the pinned STEP in millimetres.
- 04-collar-bar-assembly: one complete proposed replacement bar assembly, comprising seven print-part proposals. The two shoes are separate files. This assembly is an alternative to the original bar, not an addition to it.
- 05-custom-fabrication: one captive pin and one each of the driver, fork and spanner. These are custom fabrication proposals, not approved plastic print instructions.
- 06-material-reference-envelopes: two cut-stock grip pads and one low-drag buffer. These are material/cutting references, not print instructions.

Screws, nuts, the spinner, knob, arcade button, ballast and disco-ball shell are not printable files in this package. Fastener specifications remain unselected. Use the device's existing stock hex; no extra device retaining nut is assumed. Grip pads and the box buffer serve different purposes and need separate material choices.

Darren's unchanged original contains a sealed internal cavity, represented by an outer shell and an inward-facing inner shell. Both boundaries are watertight, and the net volume matches the one-solid CAD original. This is intentional source geometry, not a loose second part. Its internal roof requires slicer/support review; no fill or geometry repair was applied.

The collar grips the knob-mounted preset cup's flange. Assembly and grip screws stay fitted; routine bar attachment uses the independent collar and captive pin. Underside service currently proposes three tools and 140 mm of box lift.

Every delivered STL passed fresh watertightness, consistent winding, positive volume, single-CAD-solid, matching boundary-shell topology, source-volume and source-bounds checks. Existing source-owned component inventories, source hashes, STEP/STL checks and geometry identity were checked before packaging. See manifest.json for all hashes and dimensions. These checks do not establish actual component fit, printer preparation, strength, adhesion, load capacity, or operator ergonomics. Status: GEOMETRY_VALIDATED; MANUFACTURING_NOT_APPROVED.
'''
    procurement = [
        dict(item='Arcade box cover fasteners', quantity=4, unit='screw/nut pairs', method='buy', specification='Size, head, length and nut standard require selection and fit verification'),
        dict(item='Knob box cover fasteners', quantity=4, unit='screw/nut pairs', method='buy', specification='Size, head, length and nut standard require selection and fit verification'),
        dict(item='Stock-hex keeper fasteners', quantity=2, unit='screw/nut pairs', method='buy', specification='Keeper hardware, not additional spinner retaining nuts; specifications unselected'),
        dict(item='Collar carrier-to-bar fasteners', quantity=3, unit='screw/nut pairs', method='buy', specification='Specifications unselected; do not print hardware envelopes'),
        dict(item='Captive pin-retaining bridge fasteners', quantity=2, unit='screw/nut pairs', method='buy', specification='Specifications unselected; these stay fitted during routine release'),
        dict(item='Padded knob grip fasteners', quantity=2, unit='set-screw/nut pairs', method='buy', specification='Specifications unselected; retain separate rigid printed shoes'),
        dict(item='Grip pads', quantity=2, unit='cut-stock pieces', method='buy stock and cut', specification='Proposed 16 x 8 x 2 mm each; rubber/foam type unselected, adhesive toward shoe and grippy face toward knob'),
        dict(item='Low-drag buffer', quantity=1, unit='cut-stock ring', method='buy stock and cut', specification='Proposed ID 86 / OD 91 x 1 mm; match folder 06 envelope; material unselected and distinct from high-grip pads'),
        dict(item='Ballast', quantity=2, unit='contained loads, optional', method='buy or reuse', specification='One compartment per box; material, containment and mass unselected'),
        dict(item='Cable protection and strain relief', quantity=None, unit='as required at two box exits', method='buy or reuse', specification='Actual cable size, protection and strain-relief hardware remain unselected'),
        dict(item='Bar-to-ball adhesive', quantity=None, unit='as needed', method='buy', specification='Adhesive and bond preparation/load capacity require selection and testing'),
        dict(item='Arcade button and matching mounting nut', quantity=1, unit='existing set', method='reuse existing', specification='100 mm button, installed switch/LED and wiring; no printed hardware substitutes'),
        dict(item='Spinner, knob and existing stock hex', quantity=1, unit='existing set', method='reuse existing', specification='Stock hex sits in the roof well; no additional spinner retaining nut assumed'),
    ]
    readme += '\n## Print list\n\nEach row is quantity 1. The original bar and the seven-part collar bar assembly are alternatives.\n\n| STL file | Quantity | Method |\n| --- | --- | --- |\n'
    for r in records:
        if r['category'] in ('proposed-print-part','original-design-export'):
            readme += f"| {r['file']} | 1 | 3D-print proposal; slicer/material review required |\n"
    readme += '\n## Custom fabrication list\n\nThese four items are needed to operate the proposed collar. No off-the-shelf equivalent or printing process is selected. Commission fabrication or assess these geometries with the fabricator; they are not included in the ordinary print list.\n\n| STL file | Quantity | Method |\n| --- | --- | --- |\n'
    for r in records:
        if r['category'].startswith('custom-'):
            readme += f"| {r['file']} | 1 | Custom fabrication; material/process unverified |\n"
    readme += '\n## Buy, cut or reuse list\n\nDo not order fasteners by inferred nominal size. The current CAD contains proposed clearance envelopes, not selected purchasing specifications.\n\n| Item | Quantity | Method | Specification/status |\n| --- | --- | --- | --- |\n'
    for r in procurement:
        quantity = f"{r['quantity']} {r['unit']}" if r['quantity'] is not None else r['unit']
        readme += f"| {r['item']} | {quantity} | {r['method']} | {r['specification']} |\n"
    (output/'README.md').write_text(readme)
    manifest = dict(status='GEOMETRY_VALIDATED_MANUFACTURING_NOT_APPROVED', units='mm',
                    model_checkout_revision=args.revision, packager_sha256=sha(__file__),
                    selection=selected.provenance(), arcade_receipt_sha256=sha(arcade_path),
                    original_step_sha256=sha(original_path), original_export_check=original_record,
                    quantities=counts, files=records,
                    procurement_bom=procurement,
                    print_bom=[dict(file=r['file'],quantity=1,method='3D-print proposal') for r in records if r['category'] in ('proposed-print-part','original-design-export')],
                    custom_fabrication_bom=[dict(file=r['file'],quantity=1,method='custom fabrication; process unselected') for r in records if r['category'].startswith('custom-')],
                    readme_sha256=sha(output/'README.md'),
                    collar_hardware_reference_inventory=[dict(name=r['name'],role=r['role']) for r in selected.reports['disco']['review_components'] if 'hardware' in r['role'] or 'fastener' in r['role']],
                    physical_fit_verified=False, manufacturing_approved=False)
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    archive = output.with_suffix('.zip')
    require(not archive.exists(), 'Archive already exists')
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
        for path in sorted(output.rglob('*')):
            if path.is_file(): z.write(path, output.name+'/'+str(path.relative_to(output)))
    with zipfile.ZipFile(archive) as z:
        require(z.testzip() is None, 'Archive CRC validation failed')
        for record in records:
            require(hashlib.sha256(z.read(output.name+'/'+record['file'])).hexdigest()==record['sha256'], 'Archived STL changed')
    print(json.dumps(dict(directory=str(output),archive=str(archive),archive_sha256=sha(archive),stl_count=len(records),quantities=counts),indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--arcade-receipt',type=Path,required=True)
    p.add_argument('--arcade-sha',required=True)
    p.add_argument('--registry',type=Path,default=final_review.CURRENT)
    p.add_argument('--step',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--revision',required=True)
    run(p.parse_args())
