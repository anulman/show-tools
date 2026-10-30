"""Draw an underside section of the actual delivered C bottom STL for review."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image,ImageDraw
import trimesh

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--receipt',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
raw=args.receipt.read_bytes();report=json.loads(raw)
record=next(r for r in report['review_components'] if r['name']=='bottom')
mesh_path=Path(record['stl']);mesh_raw=mesh_path.read_bytes()
if hashlib.sha256(mesh_raw).hexdigest()!=record['stl_sha256']:raise ValueError('Changed bottom STL')
mesh=trimesh.load_mesh(mesh_path)
if not mesh.is_watertight or not mesh.is_winding_consistent:raise ValueError('Invalid bottom STL')
section=mesh.section(plane_origin=[0,0,mesh.bounds[0,2]+.2],plane_normal=[0,0,1])
if section is None:raise ValueError('Missing underside section')
canvas=Image.new('RGB',(900,940),'white');draw=ImageDraw.Draw(canvas)
for entity in section.entities:
    points=section.vertices[entity.points]
    draw.line([(450+x*7,490+y*7) for x,y,_ in points],fill='#12263a',width=2)
draw.text((30,20),'C mounting box: actual underside STL section, 0.2 mm above ground',fill='black')
draw.text((30,40),'C / 3 mm lock / 4 mm drive. View from below: +X right, -Y up.',fill='black')
draw.text((30,60),'Receipt SHA256 '+hashlib.sha256(raw).hexdigest()[:16],fill='black')
if args.output.exists():raise ValueError('Use a fresh preview path')
canvas.save(args.output)
if args.receipt.read_bytes()!=raw or mesh_path.read_bytes()!=mesh_raw:raise ValueError('Preview input changed')
print(args.output)
