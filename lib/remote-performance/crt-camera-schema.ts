import { Schema } from 'effect';

const cameraId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,47}$/)).pipe(Schema.brand('CrtCameraId'));
const displayText = Schema.NonEmptyString.check(
  Schema.isMaxLength(256), Schema.isPattern(/^[^\x00-\x1f\x7f]+$/),
).check(Schema.makeFilter(value => value.trim().length > 0));
const obsUrl = Schema.NonEmptyString.check(Schema.isMaxLength(2048), Schema.makeFilter(value => {
  try {
    const url = new URL(value);
    return (url.protocol === 'ws:' || url.protocol === 'wss:') && Boolean(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash && !value.includes('#') && !value.includes('?');
  } catch { return false; }
}));
const camera = Schema.Struct({ id: cameraId, label: displayText, sourceName: displayText });

export const CrtCameraProfileSchema = Schema.Struct({
  url: obsUrl,
  passwordFile: Schema.NonEmptyString.check(Schema.isPattern(/^\//), Schema.isMaxLength(4096)),
  sceneCollection: displayText,
  group: displayText,
  cameras: Schema.Array(camera).check(Schema.isMinLength(2), Schema.isMaxLength(16)).check(
    Schema.makeFilter(cameras => new Set(cameras.map(entry => entry.id)).size === cameras.length || 'Camera IDs must be unique'),
    Schema.makeFilter(cameras => new Set(cameras.map(entry => entry.sourceName)).size === cameras.length || 'OBS input names must be unique'),
  ),
});

export const decodeCrtCameraSelection = Schema.decodeUnknownSync(Schema.Struct({ cameraId }), { onExcessProperty: 'error' });
export type CrtCameraProfile = typeof CrtCameraProfileSchema.Type;
export type CrtCameraId = typeof cameraId.Type;
const visibleCamera = Schema.Struct({ id: cameraId, label: displayText });
const visibleCameras = Schema.Array(visibleCamera).check(
  Schema.isMinLength(2), Schema.isMaxLength(16),
  Schema.makeFilter(cameras => new Set(cameras.map(entry => entry.id)).size === cameras.length),
);
const ready = Schema.Struct({ kind: Schema.Literal('ready'), cameras: visibleCameras, selectedId: Schema.NullOr(cameraId) })
  .check(Schema.makeFilter(snapshot => snapshot.selectedId === null || snapshot.cameras.some(entry => entry.id === snapshot.selectedId)));
const offline = Schema.Struct({ kind: Schema.Literal('offline'), cameras: visibleCameras });
const snapshot = Schema.Union([Schema.Struct({ kind: Schema.Literal('disabled') }), ready, offline]);

export const decodeCrtCameraSnapshot = Schema.decodeUnknownSync(snapshot, { onExcessProperty: 'error' });
export type CrtCamera = typeof visibleCamera.Type;
export type ReadyCrtCameras = typeof ready.Type;
export type OfflineCrtCameras = typeof offline.Type;
export type CrtCameraSnapshot = typeof snapshot.Type;
