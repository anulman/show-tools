import { createHash } from 'node:crypto';
import { Schema } from 'effect';

const hello = Schema.Struct({
  rpcVersion: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  authentication: Schema.optionalKey(Schema.Struct({
    salt: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
    challenge: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
  })),
});
const decodeMessage = Schema.decodeUnknownSync(Schema.Union([
  Schema.Struct({ op: Schema.Literal(0), d: hello }),
  Schema.Struct({ op: Schema.Literal(2), d: Schema.Struct({ negotiatedRpcVersion: Schema.Literal(1) }) }),
  Schema.Struct({ op: Schema.Literal(5), d: Schema.Struct({ eventType: Schema.String }) }),
  Schema.Struct({ op: Schema.Literal(7), d: Schema.Struct({
    requestId: Schema.String, requestType: Schema.String,
    requestStatus: Schema.Struct({ result: Schema.Boolean, code: Schema.Int }),
    responseData: Schema.optionalKey(Schema.Unknown),
  }) }),
]));

const OBS_SUCCESS = 100;
const OBS_NOT_READY = 207;
const OBS_AUTHENTICATION_FAILED = 4009;
const OBS_SESSION_INVALIDATED = 4011;
const GENERAL_EVENTS = 1 << 0;
const CONFIG_EVENTS = 1 << 1;
const SCENE_EVENTS = 1 << 2;
const INPUT_EVENTS = 1 << 3;
const SCENE_ITEM_EVENTS = 1 << 7;
const CONFIGURATION_EVENTS = new Set([
  'SceneCreated', 'SceneRemoved', 'SceneNameChanged',
  'InputCreated', 'InputRemoved', 'InputNameChanged',
  'SceneItemCreated', 'SceneItemRemoved', 'SceneItemListReindexed',
]);
const MAX_MESSAGE_BYTES = 128 * 1024;
const IO_TIMEOUT_MS = 1500;

type Request =
  | { requestType: 'GetSceneCollectionList' }
  | { requestType: 'GetGroupSceneItemList'; requestData: { sceneName: string } }
  | { requestType: 'SetSceneItemEnabled'; requestData: { sceneName: string; sceneItemId: number; sceneItemEnabled: boolean } };
type Pending = {
  id: string;
  type: Request['requestType'];
  complete(error: ObsCrtError | null, data?: unknown): void;
};
type Operation = (request: Request) => Promise<unknown>;

export class ObsCrtError extends Error {
  constructor(message: string, readonly mayReconnect = true) { super(message); }
}

const digest = (input: string) => createHash('sha256').update(input).digest('base64');

export class ObsCrtConnection {
  private readonly socket: WebSocket;
  private readonly identified: Promise<void>;
  private closeReason: ObsCrtError | undefined;
  private handshake: { expect: 0 | 2; complete(error?: ObsCrtError): void } | undefined;
  private collectionChanging = false;
  private configuration = 0;
  private nextId = 0;
  private pending: Pending | undefined;

  constructor(url: string, password: string) {
    this.socket = new WebSocket(url);
    this.identified = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.close(new ObsCrtError('OBS connection timed out')), IO_TIMEOUT_MS);
      this.handshake = {
        expect: 0,
        complete: (error) => {
          clearTimeout(timer);
          this.handshake = undefined;
          if (error) reject(error);
          else resolve();
        },
      };
      this.socket.addEventListener('error', () => this.close(new ObsCrtError('Cannot reach OBS')));
      this.socket.addEventListener('close', event => this.close(new ObsCrtError(
        event.code === OBS_AUTHENTICATION_FAILED ? 'OBS rejected the camera password' : 'OBS disconnected',
        event.code !== OBS_SESSION_INVALIDATED,
      )));
      this.socket.addEventListener('message', event => {
        if (this.closed) return;
        try {
          const data: unknown = event.data;
          if (typeof data !== 'string' || Buffer.byteLength(data) > MAX_MESSAGE_BYTES)
            throw new Error('Invalid frame');
          const message = decodeMessage(JSON.parse(data));
          const handshake = this.handshake;
          if (message.op === 0 && handshake?.expect === 0) {
            const auth = message.d.authentication;
            if (!auth) return this.close(new ObsCrtError('OBS password authentication is disabled'));
            handshake.expect = 2;
            this.send(1, {
              rpcVersion: 1, authentication: digest(digest(password + auth.salt) + auth.challenge),
              eventSubscriptions: GENERAL_EVENTS | CONFIG_EVENTS | SCENE_EVENTS | INPUT_EVENTS | SCENE_ITEM_EVENTS,
            });
          } else if (message.op === 2 && handshake?.expect === 2) {
            handshake.complete();
          } else if (message.op === 5 && !handshake) {
            this.event(message.d.eventType);
          } else if (message.op === 7 && !handshake) {
            const pending = this.pending;
            const reply = message.d;
            if (!pending || reply.requestId !== pending.id || reply.requestType !== pending.type)
              throw new Error('Unexpected response');
            if (reply.requestStatus.result && reply.requestStatus.code === OBS_SUCCESS) {
              pending.complete(null, reply.responseData);
            } else {
              const error = reply.requestStatus.code === OBS_NOT_READY ? 'OBS is not ready'
                : 'OBS rejected ' + reply.requestType;
              pending.complete(new ObsCrtError(error));
            }
          } else {
            throw new Error('Unexpected message');
          }
        } catch {
          this.close(new ObsCrtError('Invalid OBS protocol response'));
        }
      });
    });
  }

  get closed() { return this.closeReason !== undefined; }
  get disconnected() { return this.closeReason; }

  close(error = new ObsCrtError('OBS connection closed')) {
    if (this.closed) return;
    this.closeReason = error;
    this.handshake?.complete(error);
    this.pending?.complete(error);
    this.socket.close();
  }

  async run<T>(deadline: number, operation: (request: Operation) => Promise<T>): Promise<T> {
    await this.identified;
    const configuration = this.configuration;
    const check = () => {
      if (this.closeReason) throw this.closeReason;
      if (this.collectionChanging || configuration !== this.configuration)
        throw new ObsCrtError('OBS camera configuration changed');
      if (performance.now() >= deadline) throw new ObsCrtError('OBS camera operation timed out');
    };
    check();
    const result = await operation(async request => {
      check();
      const data = await this.request(request, Math.min(IO_TIMEOUT_MS, deadline - performance.now()));
      check();
      return data;
    });
    check();
    return result;
  }

  private event(type: string) {
    if (type === 'ExitStarted') {
      this.close(new ObsCrtError('OBS is shutting down'));
    } else if (type === 'CurrentSceneCollectionChanging' || type === 'CurrentSceneCollectionChanged') {
      this.collectionChanging = type === 'CurrentSceneCollectionChanging';
      this.configuration++;
    } else if (CONFIGURATION_EVENTS.has(type)) {
      this.configuration++;
    }
  }

  private send(op: number, d: object) {
    this.socket.send(JSON.stringify({ op, d }));
  }

  private request(request: Request, timeout: number): Promise<unknown> {
    if (this.pending) throw new ObsCrtError('OBS camera connection is busy');
    return new Promise((resolve, reject) => {
      const id = String(++this.nextId);
      const timer = setTimeout(() => this.close(new ObsCrtError('OBS request timed out')), timeout);
      this.pending = {
        id, type: request.requestType,
        complete: (error, data) => {
          clearTimeout(timer);
          this.pending = undefined;
          if (error) reject(error);
          else resolve(data);
        },
      };
      try { this.send(6, { ...request, requestId: id }); }
      catch { this.close(new ObsCrtError('Cannot send to OBS')); }
    });
  }
}
