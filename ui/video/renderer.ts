import { Container, Sprite, Texture, WebGLRenderer } from 'pixi.js';
import type { PreparedStreetScene, StreetPoofEffect } from '../../lib/video/street-score.js';
import type { StreetSampler } from '../../lib/video/street-sampler.js';
import { grayscaleRgba } from '../../lib/video/presentation.js';
import { fetchStreetAsset, type StreetAsset } from '../../lib/video/street-assets.js';
import { StreetResources } from './resources.js';

export type TexturePair = { readonly color: Texture; readonly gray: Texture };
type PreparedDrawing = PreparedStreetScene['actors'][number]['clips'][number]['drawings'][number] & TexturePair;
export interface StreetPlatform {
  readonly renderer: () => WebGLRenderer;
  readonly fetch: typeof fetch;
  readonly decode: (bytes: Uint8Array<ArrayBuffer>, resources: StreetResources) => Promise<TexturePair>;
}

async function decodeTextures(bytes: Uint8Array<ArrayBuffer>, resources: StreetResources): Promise<TexturePair> {
  const url = URL.createObjectURL(new Blob([bytes]));
  const image = new Image();
  try {
    image.src = url; await image.decode();
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = image.naturalWidth; colorCanvas.height = image.naturalHeight;
    const colorContext = colorCanvas.getContext('2d');
    if (!colorContext) throw new Error('Sprite preparation requires Canvas2D');
    colorContext.drawImage(image, 0, 0);
    const color = Texture.from(colorCanvas, true);
    resources.defer(() => color.destroy(true));
    color.source.scaleMode = 'nearest';
    const grayCanvas = document.createElement('canvas');
    grayCanvas.width = image.naturalWidth; grayCanvas.height = image.naturalHeight;
    const context = grayCanvas.getContext('2d');
    if (!context) throw new Error('Sprite grayscale preparation requires Canvas2D');
    const data = colorContext.getImageData(0, 0, grayCanvas.width, grayCanvas.height);
    grayscaleRgba(data.data); context.putImageData(data, 0, 0);
    const gray = Texture.from(grayCanvas, true);
    resources.defer(() => gray.destroy(true));
    gray.source.scaleMode = 'nearest';
    return { color, gray };
  } finally { image.src = ''; URL.revokeObjectURL(url); }
}

const browserPlatform: StreetPlatform = { renderer: () => new WebGLRenderer(), fetch: (...args) => fetch(...args), decode: decodeTextures };

export async function createStreetStudio(host: Pick<HTMLElement, 'append'>, scene: PreparedStreetScene, sampler: StreetSampler, platform: StreetPlatform = browserPlatform) {
  const resources = new StreetResources();
  resources.defer(() => sampler.dispose());
  try {
    const renderer = platform.renderer();
    resources.defer(() => renderer.destroy({ removeView: true }));
    const stage = new Container();
    resources.defer(() => stage.destroy({ children: true }));
    const loaded = new Map<string, TexturePair>();
    async function textures(asset: StreetAsset) {
      const key = `${asset.path}:${asset.sha256}`;
      const existing = loaded.get(key);
      if (existing) return existing;
      const bytes = await fetchStreetAsset(asset, platform.fetch);
      const pair = await platform.decode(bytes, resources);
      loaded.set(key, pair);
      return pair;
    }
    const backgroundTexture = await textures(scene.background);
    const background = new Sprite(backgroundTexture.color);
    background.width = scene.width; background.height = scene.height;
    stage.addChild(background);
    const actors = new Container(); actors.sortableChildren = true; stage.addChild(actors);
    const effects: Array<{ pivot: StreetPoofEffect['pivot']; drawings: TexturePair[] }> = [];
    if (scene.staging.kind === 'poof') for (const effect of scene.staging.effects) {
      const drawings = [];
      for (const drawing of effect.drawings) drawings.push(await textures(drawing));
      effects.push({ pivot: effect.pivot, drawings });
    }
    const figures: Array<{ sprite: Sprite; poof: Sprite; clips: PreparedDrawing[][] }> = [];
    for (const actor of scene.actors) {
      const clips = [];
      for (const clip of actor.clips) {
        const drawings = [];
        for (const drawing of clip.drawings) drawings.push({ ...drawing, ...await textures(drawing) });
        clips.push(drawings);
      }
      const figure = new Container();
      figure.position.set(actor.placement.x, actor.placement.y);
      figure.scale.set(actor.placement.scale); figure.zIndex = actor.placement.depth;
      const sprite = new Sprite(), poof = new Sprite();
      figure.addChild(sprite, poof); actors.addChild(figure);
      figures.push({ sprite, poof, clips });
    }
    await renderer.init({ width: scene.width, height: scene.height, backgroundAlpha: 0, antialias: false, resolution: 1, preserveDrawingBuffer: true });
    const canvas = renderer.canvas;
    resources.defer(() => canvas.remove());
    host.append(canvas);
    canvas.setAttribute('aria-label', 'Song cast dancing on the 2.5D street');
    let state = sampler.sample(0);
    function draw(count: number) {
      state = sampler.sample(count);
      for (const frame of state) {
        const figure = figures[frame.actor], drawing = figure.clips[frame.clip][frame.pose];
        figure.sprite.texture = frame.grayscale ? drawing.gray : drawing.color;
        figure.sprite.pivot.set(drawing.pivot.x, drawing.pivot.y);
        figure.sprite.visible = frame.visible;
        figure.poof.visible = frame.poof !== null;
        if (frame.poof) {
          const effect = effects[frame.poof.effect];
          figure.poof.texture = effect.drawings[frame.poof.pose].color;
          figure.poof.pivot.set(effect.pivot.x, effect.pivot.y);
        }
      }
      renderer.render({ container: stage }); return state;
    }
    return { draw, canvas, snapshot: () => state, dispose: () => resources.dispose() };
  } catch (error) { return resources.fail(error); }
}
