import { Application, Assets, Container, Graphics, MeshPlane, Text, Texture } from 'pixi.js';
import manifest from '../../assets/video/manifest.json';
import { quarterPosition, type SceneTime } from './time.js';
import type { PoseSampler } from './motion.js';

export const models = manifest.models;
export const treatments = [...new Set(models.map(model => model.treatment))];
export const treatmentName = (value: string) => ({ original: 'Original', '8bit': '8-bit', '16bit': '16-bit', 'tex-avery': 'Tex Avery' })[value] ?? value;
export type View = { readonly kind: 'gallery' } | { readonly kind: 'stage'; readonly treatment: string };

function label(text: string, x: number, y: number, size = 12, color = 0xd9c9b7) {
  const node = new Text({ text, style: { fontFamily: 'Arial, sans-serif', fontSize: size, fill: color, letterSpacing: 1 } });
  node.position.set(x, y);
  return node;
}

function backdrop(width: number, height: number) {
  const stage = new Graphics().rect(0, 0, width, height).fill(0x191a24);
  stage.ellipse(width / 2, height * .49, width * .3, height * .4).fill({ color: 0xf2d6a0, alpha: .045 });
  stage.rect(0, height * .83, width, height * .17).fill(0x342b32);
  stage.rect(0, height * .83, width, 1).fill(0x756050);
  for (let x = 0; x < width; x += width / 12) stage.moveTo(x, height).lineTo(width / 2 + (x - width / 2) * .5, height * .83).stroke({ color: 0x57404a, width: 1 });
  stage.rect(0, 0, width, height * .07).fill(0x633040);
  stage.poly([0, 0, width * .11, 0, width * .07, height * .5, 0, height * .67]).fill(0x4a2639);
  stage.poly([width, 0, width * .89, 0, width * .93, height * .5, width, height * .67]).fill(0x4a2639);
  return stage;
}

export async function createStudio(host: HTMLElement, sample: PoseSampler) {
  const app = new Application();
  await app.init({ width: 1280, height: 480, backgroundAlpha: 0, autoStart: false, sharedTicker: false, antialias: false, preference: 'webgl', resolution: Math.min(devicePixelRatio, 2), autoDensity: true, preserveDrawingBuffer: true });
  host.append(app.canvas);
  app.canvas.setAttribute('aria-label', 'Animated comparison of Gator Crooner and Tapir Tenor in four treatments');
  const stageBackdrop = backdrop(960, 720);
  app.stage.addChild(stageBackdrop);
  const stageTitle = label('', 40, 38, 18);
  app.stage.addChild(stageTitle);
  const prepared = await Promise.all(models.map(async (model, index) => {
    const root = new Container();
    const board = backdrop(316, 237);
    const heading = label(`${model.character === 'gator' ? 'GATOR' : 'TAPIR'}  /  ${treatmentName(model.treatment).toUpperCase()}`, 16, 15, 10);
    board.addChild(heading);
    const figure = new Container();
    const meshes = await Promise.all(model.poses.map(async path => {
      const texture = await Assets.load<Texture>(path);
      texture.source.scaleMode = model.treatment === 'tex-avery' ? 'linear' : 'nearest';
      const mesh = new MeshPlane({ texture, verticesX: 5, verticesY: 17 });
      const base = mesh.geometry.positions.slice();
      figure.addChild(mesh);
      return { mesh, base };
    }));
    root.addChild(board, figure);
    app.stage.addChild(root);
    return { root, board, figure, meshes, model, index };
  }));
  let previousLayout = '';
  let state = prepared.map(item => ({ id: item.model.id, pose: 0, sway: 0, breath: 0 }));

  function draw({ time, view }: { time: SceneTime; view: View }) {
    const columns = host.clientWidth < 720 ? 2 : 4;
    const layout = `${view.kind}:${view.kind === 'stage' ? view.treatment : columns}`;
    if (layout !== previousLayout) {
      const gallery = view.kind === 'gallery';
      app.renderer.resize(gallery ? columns * 320 : 960, gallery ? Math.ceil(models.length / columns) * 240 : 720);
      stageBackdrop.visible = !gallery; stageTitle.visible = !gallery;
      stageTitle.text = view.kind === 'stage' ? `GATOR + TAPIR   /   ${treatmentName(view.treatment).toUpperCase()}` : '';
      prepared.forEach((item, i) => {
        item.board.visible = gallery;
        item.root.visible = gallery || (view.kind === 'stage' && item.model.treatment === view.treatment);
        if (gallery) {
          item.root.position.set((i % columns) * 320, Math.floor(i / columns) * 240);
          item.figure.position.set(158 - 640 * .225 / 2, 209 - 776 * .225);
          item.figure.scale.set(.225);
        } else {
          item.root.position.set(0, 0);
          const center = item.model.character === 'gator' ? 310 : 650;
          item.figure.position.set(center - 640 * .58 / 2, 600 - 776 * .58);
          item.figure.scale.set(.58);
        }
      });
      previousLayout = layout;
    }
    const quarter = quarterPosition(time);
    state = prepared.map(item => {
      const pose = sample(quarter, item.index);
      item.meshes.forEach(({ mesh, base }, index) => {
        mesh.visible = index === pose.pose;
        if (!mesh.visible) return;
        const points = mesh.geometry.positions;
        for (let vertex = 0; vertex < points.length; vertex += 2) {
          const x = base[vertex], y = base[vertex + 1];
          const upper = Math.max(0, (680 - y) / 680);
          points[vertex] = x + pose.sway * 800 * upper * upper;
          points[vertex + 1] = y - pose.breath * 800 * upper;
        }
        mesh.geometry.getBuffer('aPosition').update();
      });
      return { id: item.model.id, ...pose };
    });
    app.render();
    return state;
  }

  return { draw, canvas: app.canvas, snapshot: () => state, dispose: () => app.destroy(true, { children: true, texture: true }) };
}
