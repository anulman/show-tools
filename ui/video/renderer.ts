import { Application, Assets, Container, Sprite, Texture } from 'pixi.js';
import type { PreparedStreetScene } from '../../lib/video/street-score.js';
import type { StreetSampler } from '../../lib/video/street-sampler.js';
import { grayscaleRgba } from '../../lib/video/presentation.js';

async function textures(path: string) {
  const color = await Assets.load<Texture>(path);
  color.source.scaleMode = 'nearest';
  const image = new Image(); image.src = path; await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Sprite grayscale preparation requires Canvas2D');
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  grayscaleRgba(data.data); context.putImageData(data, 0, 0);
  const gray = Texture.from(canvas); gray.source.scaleMode = 'nearest';
  return { color, gray };
}

export async function createStreetStudio(host: HTMLElement, scene: PreparedStreetScene, sampler: StreetSampler) {
  const app = new Application();
  await app.init({ width: scene.width, height: scene.height, backgroundAlpha: 0, autoStart: false, sharedTicker: false, antialias: false, preference: 'webgl', resolution: 1, preserveDrawingBuffer: true });
  host.append(app.canvas);
  app.canvas.setAttribute('aria-label', 'Song cast dancing on the 2.5D street');
  const background = new Sprite(await Assets.load<Texture>(scene.background));
  background.width = scene.width; background.height = scene.height;
  app.stage.addChild(background);
  const actors = new Container(); actors.sortableChildren = true; app.stage.addChild(actors);
  const figures = await Promise.all(scene.actors.map(async actor => {
    const sprite = new Sprite();
    sprite.position.set(actor.placement.x, actor.placement.y);
    sprite.scale.set(actor.placement.scale); sprite.zIndex = actor.placement.depth;
    actors.addChild(sprite);
    const clips = await Promise.all(actor.clips.map(async clip => Promise.all(clip.drawings.map(async drawing => ({ ...drawing, ...await textures(drawing.path) })))));
    return { sprite, clips };
  }));
  let state = sampler.sample(0);
  function draw(count: number) {
    state = sampler.sample(count);
    for (const frame of state) {
      const figure = figures[frame.actor], drawing = figure.clips[frame.clip][frame.pose];
      figure.sprite.texture = frame.grayscale ? drawing.gray : drawing.color;
      figure.sprite.pivot.set(drawing.pivot.x, drawing.pivot.y);
    }
    app.render(); return state;
  }
  return { draw, canvas: app.canvas, snapshot: () => state,
    dispose() { sampler.dispose(); app.destroy(true, { children: true, texture: true }); },
  };
}
