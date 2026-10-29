"""Render a staged instruction video from a verified final-C mesh receipt.

No model imports, CAD regeneration, or publication. Every pose uses its actual
exported STL. The carrier and roof are cut away for visibility; the outer bar
shell is omitted. The video is an instruction sequence, not a physical simulation.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
COLORS = dict(cup=(53, 155, 184), collar=(239, 162, 47), pin=(218, 67, 88),
              carrier=(145, 160, 179), roof=(169, 181, 196), hardware=(90, 105, 124))
POSES = [
    ('locked', 2., 'No new screws during normal locking', 'A collar and a captive pin make the routine connection.', 'LOCKED'),
    ('detached', 2., '1  Start with the collar released', 'The grey carrier stays attached to the bar. The blue cup stays on the knob.', 'PIN RETRACTED'),
    ('released', 2., '2  Seat the bar onto the preset plate', 'Align the straight pilot keys. Do not turn the whole ball to make this joint.', 'PIN RETRACTED'),
    ('collar-midway', 1.5, '3  Turn the separate collar 90 degrees', 'Use the pin spanner while holding the bar as the reaction.', 'COLLAR TURNING'),
    ('pin-retracted', 2., 'Collar engaged; pin still retracted', 'The orange collar captures the blue flange. The grey carrier does not turn.', 'PIN RETRACTED'),
    ('pin-turned', 2., '4  Push the pin inward 2.8 mm', 'Push toward the ball, into the turning chamber.', 'PIN PUSHED IN'),
    ('pin-pushed', 2., '5  Turn the pin back 90 degrees', 'Keep it pushed inward. The slot driver supplies the turn.', 'PIN TURNED BACK'),
    ('locked', 2.5, '6  Pull the pin outward 0.8 mm to its stop', 'The under-head fork seats the pin in its locked pocket. Remove the tool.', 'PIN LOCKED'),
    ('pin-pushed', 1.5, 'To release: push the pin inward 0.8 mm', 'Then turn it 90 degrees while held inward.', 'RELEASE: PUSH'),
    ('pin-turned', 1.5, 'Turn, then pull the pin outward 2.8 mm', 'The pin stays captive. It is not removed or replaced by a screw.', 'RELEASE: TURN'),
    ('pin-retracted', 1.5, 'The retracted pin clears the collar', 'Use the spanner to turn the collar back 90 degrees.', 'RELEASE: PULL'),
    ('released', 1.5, 'Collar released: lift the complete bar off', 'The preset grip and its screws remain on the knob.', 'COLLAR RELEASED'),
    ('detached', 1.5, 'Bar off; preset clamp untouched', 'The assembly screws stay fitted to their own parts.', 'PIN STILL CAPTIVE'),
    ('locked', 2.5, 'Locked: bar and plate rotate with the knob', 'The box roof stays stationary. The roof is not screwed to this collar.', 'LOCKED'),
]


def font(size, bold=False):
    names = ['Arial Bold.ttf' if bold else 'Arial.ttf', 'Helvetica.ttc']
    for root in ('/System/Library/Fonts/Supplemental', '/System/Library/Fonts'):
        for name in names:
            path = Path(root)/name
            if path.exists():
                return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size=size)


def cut(mesh, origin, normal):
    triangles = np.asarray(mesh.triangles)
    if not len(triangles):
        return trimesh.Trimesh()
    distances = (triangles-np.asarray(origin))@np.asarray(normal)
    inside = distances >= -1e-8
    kept = list(triangles[inside.all(axis=1)])
    for triangle, distance, mask in zip(triangles[inside.any(axis=1)&~inside.all(axis=1)],
                                        distances[inside.any(axis=1)&~inside.all(axis=1)],
                                        inside[inside.any(axis=1)&~inside.all(axis=1)]):
        polygon = []
        for i in range(3):
            j = (i+1)%3
            if mask[i]: polygon.append(triangle[i])
            if mask[i] != mask[j]:
                polygon.append(triangle[i]+distance[i]/(distance[i]-distance[j])*(triangle[j]-triangle[i]))
        for i in range(1, len(polygon)-1):
            kept.append([polygon[0], polygon[i], polygon[i+1]])
    triangles = np.asarray(kept)
    if not len(triangles): return trimesh.Trimesh()
    return trimesh.Trimesh(vertices=triangles.reshape((-1,3)), faces=np.arange(len(triangles)*3).reshape((-1,3)), process=False)


def crop(mesh, low, high):
    for axis in range(3):
        normal = np.zeros(3); normal[axis] = 1
        origin = np.zeros(3); origin[axis] = low[axis]
        mesh = cut(mesh, origin, normal)
        origin[axis] = high[axis]
        mesh = cut(mesh, origin, -normal)
    return mesh


def shade(mesh, color, eye):
    tri = np.asarray(mesh.triangles)
    if not len(tri):
        return []
    normals = np.asarray(mesh.face_normals)
    facing = normals@eye > -.015
    tri, normals = tri[facing], normals[facing]
    light = np.array([-.3, -.15, .94]); light /= np.linalg.norm(light)
    amount = .5 + .5*np.maximum(normals@light, 0)
    rgb = np.clip(np.array(color)[None, :]*amount[:, None], 0, 255).astype(np.uint8)
    return list(zip(tri, rgb))


def render_scene(objects, size, centre, direction, scale):
    eye = np.asarray(direction, float); eye /= np.linalg.norm(eye)
    right = np.cross(np.array([0., 0., -1.]), eye); right /= np.linalg.norm(right)
    up = np.cross(eye, right)
    basis = np.array([right, up, eye]).T
    scene = []
    for mesh, color in objects:
        scene.extend(shade(mesh, color, eye))
    image = Image.new('RGB', size, '#f2f5f8')
    draw = ImageDraw.Draw(image)
    if scene:
        triangles = np.array([x[0] for x in scene])
        pixels = (triangles-np.array(centre))@basis
        colors = np.array([x[1] for x in scene])
        order = np.argsort(pixels[:, :, 2].mean(axis=1))
        for i in order:
            xy = pixels[i, :, :2]*np.array([scale, -scale]) + np.array(size)/2
            if (xy[:, 0].max()<0 or xy[:, 0].min()>size[0] or xy[:, 1].max()<0 or xy[:, 1].min()>size[1]):
                continue
            draw.polygon([tuple(p) for p in xy], fill=tuple(colors[i]))
    return image


def load_receipt(path):
    report = json.loads(path.read_text())
    if not report.get('geometry_review_pass'):
        raise ValueError('Receipt has not passed geometry review')
    meshes = {}
    inputs = {}
    for state, records in report['states_components'].items():
        meshes[state] = {}
        for item in records:
            file = Path(item['stl'])
            actual = hashlib.sha256(file.read_bytes()).hexdigest()
            if actual != item['stl_sha256']:
                raise ValueError('Mesh hash mismatch: '+str(file))
            inputs[str(file)] = actual
            mesh = trimesh.load_mesh(file, process=False)
            if not mesh.is_watertight:
                # process=False preserves the STL's triangle soup; merge only
                # for validation, never change the displayed vertices.
                verified = mesh.copy(); verified.merge_vertices()
                if not verified.is_watertight:
                    raise ValueError('Invalid verified mesh: '+str(file))
            meshes[state][item['name']] = mesh
    # Prove the fixed preset and already-fitted screws do not acquire a new
    # operation in the animation. Only the detached bar group translates.
    baseline = meshes['locked']
    for state, items in meshes.items():
        lift = items['fixed-to-bar latch carrier'].bounds[1, 2]-baseline['fixed-to-bar latch carrier'].bounds[1, 2]
        for name, mesh in items.items():
            if name.startswith('preset / '):
                if not np.allclose(mesh.bounds, baseline[name].bounds, atol=2e-5):
                    raise ValueError('Preset moved in source poses: '+state+' '+name)
            elif 'bolt' in name or 'nut' in name or 'screw' in name:
                shift = np.array([0, 0, lift])
                if not np.allclose(mesh.bounds-shift, baseline[name].bounds, atol=2e-5):
                    raise ValueError('Assembly screw changed relative to carrier: '+state+' '+name)
    return report, meshes, inputs


def scene(meshes, state, point):
    items = meshes[state]
    direction = np.array([-.6, .6, .65]); direction /= np.linalg.norm(direction)
    normal = -direction.copy(); normal[2] = 0
    objects = []
    for name, mesh in items.items():
        if name == 'full-height bar':
            continue
        color = COLORS['hardware']
        if name.startswith('preset / '):
            color = COLORS['hardware'] if 'screw' in name or 'nut' in name else COLORS['cup']
        elif name == 'quarter-turn retainer': color = COLORS['collar']
        elif name == 'captive push-turn pin': color = COLORS['pin']
        elif name == 'fixed-to-bar latch carrier':
            color = COLORS['carrier']; mesh = cut(mesh, [0, 0, 0], normal)
        elif name == 'fastened captive roof':
            color = COLORS['roof']; mesh = cut(mesh, [*point, 0], normal)
        objects.append((mesh, color))
    return render_scene(objects, (766, 452), [0, 0, -13], direction, 5.25)


def closeup(meshes, state, point):
    items = meshes[state]
    shift = items['fixed-to-bar latch carrier'].bounds[1, 2]-meshes['locked']['fixed-to-bar latch carrier'].bounds[1, 2]
    centre = np.array([*point, 4.8+shift])
    direction = np.array([-.1, .95, .5]); direction /= np.linalg.norm(direction)
    normal = -direction.copy(); normal[2] = 0
    low = np.array([point[0]-5, point[1]-5, shift-.2])
    high = np.array([point[0]+5, point[1]+5, shift+11.2])
    objects = []
    for name, color in [('preset / knob baseplate cup', 'cup'), ('quarter-turn retainer', 'collar'),
                        ('fixed-to-bar latch carrier', 'carrier'), ('fastened captive roof', 'roof'),
                        ('captive push-turn pin', 'pin')]:
        mesh = crop(items[name], low, high)
        if name in ('fixed-to-bar latch carrier', 'fastened captive roof'):
            mesh = cut(mesh, centre, normal)
        objects.append((mesh, COLORS[color]))
    return render_scene(objects, (430, 452), centre, direction, 29.)


def arrow(draw, start, end, color):
    a, b = np.array(start), np.array(end)
    draw.line([tuple(a), tuple(b)], fill=color, width=4)
    v = (b-a)/np.linalg.norm(b-a); side = np.array([-v[1], v[0]])
    draw.polygon([tuple(b), tuple(b-14*v+7*side), tuple(b-14*v-7*side)], fill=color)


def run(receipt, output):
    report, meshes, inputs = load_receipt(receipt)
    point = report['controls'][0]['source_xy_mm']
    output.mkdir(parents=True, exist_ok=True)
    frames = []
    rendered = {}
    for i, (state, duration, title, subtitle, status) in enumerate(POSES):
        if state not in rendered:
            rendered[state] = (scene(meshes, state, point), closeup(meshes, state, point))
        image = Image.new('RGB', (W, H), '#ffffff')
        draw = ImageDraw.Draw(image)
        draw.text((28, 17), 'FINAL C  /  LOCKING & RELEASE', font=font(18, True), fill='#526478')
        draw.text((28, 48), title, font=font(29, True), fill='#172b43')
        draw.text((28, 89), subtitle, font=font(20), fill='#4c6076')
        image.paste(rendered[state][0], (22, 137))
        image.paste(rendered[state][1], (824, 137))
        draw.text((38, 149), 'COLLAR + PRESET CUP', font=font(15, True), fill='#526478')
        draw.text((840, 149), 'CAPTIVE PIN  /  CUTAWAY', font=font(15, True), fill='#526478')
        draw.rounded_rectangle((843, 541, 1234, 577), radius=8, fill='#172b43')
        draw.text((856, 548), status, font=font(18, True), fill='white')
        if state=='released' and i<8:
            arrow(draw, (735, 205), (735, 300), '#d94358')
            draw.text((644, 310), 'SEAT BAR', font=font(15, True), fill='#b62e47')
        if state=='released' and i>8:
            arrow(draw, (735, 300), (735, 205), '#d94358')
            draw.text((644, 310), 'LIFT BAR', font=font(15, True), fill='#b62e47')
        x = 29
        for color, text in [('cup', 'Preset cup on knob'), ('carrier', 'Carrier fixed to bar'), ('collar', 'Separate rotating collar'), ('pin', 'Captive pin')]:
            draw.rounded_rectangle((x, 611, x+13, 624), radius=3, fill=COLORS[color])
            draw.text((x+21, 607), text, font=font(17), fill='#243c55')
            x += 317 if color=='collar' else 285 if color=='carrier' else 263
        draw.text((29, 646), 'Assembly and grip screws stay fitted. No screw is added between the box roof and the bar plate.', font=font(18, True), fill='#253e58')
        draw.text((29, 679), 'Verified CAD poses. Bar shell and box omitted; carrier and pin-retaining bridge cut away. Physical fit remains unverified.', font=font(15), fill='#66788a')
        path = output/f'frame-{i:02d}.png'; image.save(path)
        frames.append((path, duration))
    listing = output/'frames.ffconcat'
    listing.write_text('ffconcat version 1.0\n'+''.join(f"file '{path.name}'\nduration {duration}\n" for path, duration in frames)+f"file '{frames[-1][0].name}'\n")
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-safe', '0', '-i', str(listing),
                    '-vf', 'fps=24,format=yuv420p', '-c:v', 'libx264', '-crf', '22', '-movflags', '+faststart', str(output/'final-c-lock.mp4')], check=True)
    pictures = [Image.open(path).resize((896, 504)) for path, _ in frames]
    pictures[0].save(output/'final-c-lock.gif', save_all=True, append_images=pictures[1:],
                     duration=[int(d*1000) for _, d in frames], loop=0, optimize=False)
    selected = [1, 2, 3, 5, 6, 7]
    sheet = Image.new('RGB', (1280, 1080), 'white')
    for n, idx in enumerate(selected):
        sheet.paste(Image.open(frames[idx][0]).resize((640, 360)), ((n%2)*640, (n//2)*360))
    sheet.save(output/'contact-sheet.png')
    Image.open(frames[7][0]).save(output/'poster.png')
    manifest = dict(kind='STAGED_VERIFIED_MESH_INSTRUCTION_VIDEO',
                    receipt=str(receipt.resolve()), receipt_sha256=hashlib.sha256(receipt.read_bytes()).hexdigest(),
                    script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                    mesh_inputs_sha256=inputs, frames=[dict(state=s, duration_seconds=d, title=t) for s,d,t,_,_ in POSES],
                    visual_omissions=['outer full-height bar shell', 'stationary box and knob body', 'front half of carrier and pin roof'],
                    simulations_claimed=False,
                    artifacts={name:hashlib.sha256((output/name).read_bytes()).hexdigest() for name in
                               ('final-c-lock.mp4', 'final-c-lock.gif', 'poster.png', 'contact-sheet.png')})
    (output/'animation.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps(dict(output=str(output), seconds=sum(d for _,d in frames), artifacts=list(manifest['artifacts'])), indent=2))


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    run(args.receipt, args.output)
