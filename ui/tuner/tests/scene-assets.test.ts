import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';

test('the source ball preserves a transparent silhouette on its native canvas', async () => {
  const image = sharp(new URL('../../../assets/video/tuner/disco-ball.png', import.meta.url).pathname);
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject:true });
  assert.equal(info.width,70); assert.equal(info.height,70);
  for (const [x,y] of [[0,0],[69,0],[0,69],[69,69]]) assert.equal(data[(y * 70 + x) * 4 + 3],0);
  assert.equal(data[(35 * 70 + 35) * 4 + 3],255);
});
