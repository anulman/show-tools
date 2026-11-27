import { Schema } from 'effect';
import type { CrtCameraId, CrtCameraProfile, OfflineCrtCameras, ReadyCrtCameras } from './crt-camera-schema.js';
import { ObsCrtConnection, ObsCrtError } from './obs-crt-connection.js';

const collection = Schema.decodeUnknownSync(Schema.Struct({ currentSceneCollectionName: Schema.String }));
const sceneItem = Schema.Struct({
  sourceName: Schema.NonEmptyString,
  sceneItemId: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  sceneItemIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  sceneItemEnabled: Schema.Boolean,
  inputKind: Schema.NullOr(Schema.NonEmptyString),
});
const group = Schema.decodeUnknownSync(Schema.Struct({ sceneItems: Schema.Array(sceneItem) }));
type ManagedInput = { id: CrtCameraId; item: typeof sceneItem.Type };

const MAX_PENDING_CUTS = 2;
const OPERATION_TIMEOUT_MS = 3500;
const RECONNECT_DELAY_MS = 1000;

type CameraCut =
  | { kind: 'applied'; snapshot: ReadyCrtCameras }
  | { kind: 'invalid' | 'busy'; error: string }
  | { kind: 'unavailable'; error: string; snapshot: OfflineCrtCameras };

export class CrtCameras {
  private readonly offline: OfflineCrtCameras;
  private connection: ObsCrtConnection | undefined;
  private retryAt = 0;
  private closed = false;
  private tail = Promise.resolve();
  private reading: Promise<ReadyCrtCameras | OfflineCrtCameras> | undefined;
  private pendingCuts = 0;

  constructor(private readonly profile: CrtCameraProfile, private readonly password: string | undefined) {
    this.offline = { kind: 'offline', cameras: profile.cameras.map(({ id, label }) => ({ id, label })) };
  }

  snapshot() {
    if (!this.reading) {
      this.reading = this.enqueue(undefined).then(result =>
        result.kind === 'applied' ? result.snapshot : this.offline).finally(() => { this.reading = undefined; });
    }
    return this.reading;
  }

  select(cameraId: CrtCameraId): Promise<CameraCut> {
    if (!this.profile.cameras.some(camera => camera.id === cameraId))
      return Promise.resolve({ kind: 'invalid', error: 'Unknown CRT camera' });
    if (this.pendingCuts >= MAX_PENDING_CUTS)
      return Promise.resolve({ kind: 'busy', error: 'Another CRT camera cut is pending' });
    this.pendingCuts++;
    return this.enqueue(cameraId).finally(() => { this.pendingCuts--; });
  }

  close() {
    this.closed = true;
    this.connection?.close();
  }

  private enqueue(selected: CrtCameraId | undefined): Promise<CameraCut> {
    const deadline = performance.now() + OPERATION_TIMEOUT_MS;
    const next = this.tail.then(() => this.run(deadline, selected));
    this.tail = next.then(() => {}, () => {});
    return next;
  }

  private async run(deadline: number, selected: CrtCameraId | undefined): Promise<CameraCut> {
    try {
      if (this.closed) throw new ObsCrtError('CRT camera controls have closed');
      if (!this.password) throw new ObsCrtError('The OBS camera password is unavailable on the Desk server');
      if (performance.now() >= deadline) throw new ObsCrtError('CRT camera request expired while waiting');
      const disconnected = this.connection?.disconnected;
      if (disconnected && (!disconnected.mayReconnect || performance.now() < this.retryAt)) throw disconnected;
      if (!this.connection || disconnected) this.connection = new ObsCrtConnection(this.profile.url, this.password);
      const sceneName = this.profile.group;
      const snapshot = await this.connection.run(deadline, async request => {
        const checkCollection = async () => {
          const value = collection(await request({ requestType: 'GetSceneCollectionList' }));
          if (value.currentSceneCollectionName !== this.profile.sceneCollection)
            throw new ObsCrtError('The configured OBS scene collection is inactive');
        };
        const readGroup = async () => {
          await checkCollection();
          const { sceneItems } = group(await request({ requestType: 'GetGroupSceneItemList', requestData: { sceneName } }));
          await checkCollection();
          return this.managedInputs(sceneItems);
        };
        const setEnabled = (item: typeof sceneItem.Type, sceneItemEnabled: boolean) => request({
          requestType: 'SetSceneItemEnabled', requestData: { sceneName, sceneItemId: item.sceneItemId, sceneItemEnabled },
        });
        let inputs = await readGroup();
        const fallbackId = this.profile.cameras[0].id;
        const shouldEnable = (id: CrtCameraId) => id === selected || id === fallbackId;
        const confirmed = () => inputs.every(({ id, item }) => item.sceneItemEnabled === shouldEnable(id));
        if (selected !== undefined && !confirmed()) {
          const target = inputs.find(input => input.id === selected);
          if (!target) throw new ObsCrtError('The CRT camera input is missing');
          const [fallback] = inputs;
          if (!target.item.sceneItemEnabled) await setEnabled(target.item, true);
          if (selected !== fallbackId && !fallback.item.sceneItemEnabled) await setEnabled(fallback.item, true);
          if (!target.item.sceneItemEnabled || !fallback.item.sceneItemEnabled) inputs = await readGroup();
          if (inputs.some(({ id, item }) => shouldEnable(id) && !item.sceneItemEnabled))
            throw new ObsCrtError('OBS did not confirm the target and fallback cameras were enabled');

          for (const { id, item } of inputs) {
            if (!shouldEnable(id) && item.sceneItemEnabled) await setEnabled(item, false);
          }
          inputs = await readGroup();
          if (!confirmed()) throw new ObsCrtError('OBS did not confirm the CRT camera cut');
        }
        return { kind: 'ready', cameras: this.offline.cameras, selectedId: this.selectedId(inputs) } satisfies ReadyCrtCameras;
      });
      return { kind: 'applied', snapshot };
    } catch (error) {
      if (this.connection?.closed && performance.now() >= this.retryAt) this.retryAt = performance.now() + RECONNECT_DELAY_MS;
      return { kind: 'unavailable', snapshot: this.offline, error: error instanceof ObsCrtError ? error.message : 'Cannot read the configured OBS camera group' };
    }
  }

  private managedInputs(items: readonly (typeof sceneItem.Type)[]): ManagedInput[] {
    if (new Set(items.map(item => item.sceneItemId)).size !== items.length ||
      new Set(items.map(item => item.sceneItemIndex)).size !== items.length)
      throw new ObsCrtError('The OBS camera group returned duplicate item IDs or positions');
    const inputs = this.profile.cameras.map(camera => {
      const matches = items.filter(item => item.sourceName === camera.sourceName);
      const [item] = matches;
      if (matches.length !== 1 || !item?.inputKind) throw new ObsCrtError('Each configured CRT camera must match one OBS group input');
      return { id: camera.id, item };
    });
    const [fallback, ...overlays] = inputs;
    if (overlays.some(input => input.item.sceneItemIndex < fallback.item.sceneItemIndex))
      throw new ObsCrtError('The first configured CRT camera must be the bottom managed OBS input');
    return inputs;
  }

  private selectedId(inputs: ManagedInput[]): CrtCameraId | null {
    return inputs.filter(input => input.item.sceneItemEnabled)
      .sort((a, b) => b.item.sceneItemIndex - a.item.sceneItemIndex)[0]?.id ?? null;
  }
}
