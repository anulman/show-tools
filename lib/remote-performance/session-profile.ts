import { Schema } from 'effect';

const path = Schema.NonEmptyString.check(Schema.isPattern(/^\//), Schema.isMaxLength(4096));
const integer = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));
const identityText = Schema.NonEmptyString.check(Schema.isMaxLength(256), Schema.isPattern(/^[^\x00-\x1f\x7f]+$/));
const hexId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{4}$/));
export const AlsaIdentitySchema = Schema.Struct({
  byId: Schema.String.check(Schema.isPattern(/^\/dev\/snd\/by-id\/[A-Za-z0-9_.:-]+$/)),
  usbSerial: identityText, usbVendor: hexId, usbProduct: hexId,
  alsaCardId: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_]{1,32}$/)),
  pcmDevice: integer(0, 31), monitorOff: identityText.check(Schema.isMaxLength(43)),
});
const AlsaSchema = Schema.Struct({
  kind: Schema.Literal('alsa'), identity: AlsaIdentitySchema,
  requireInactiveUserService: Schema.optionalKey(Schema.Literal('scarlett-monitor.service')),
  captureChannels: integer(1, 32), inputChannel: integer(0, 31),
  periodFrames: integer(1, 16384), bufferFrames: integer(1, 1048576),
  format: Schema.Literals(['s32', 'float']),
}).check(Schema.makeFilter(value => (value.inputChannel < value.captureChannels && value.bufferFrames >= value.periodFrames) || 'Invalid ALSA channel or buffer relationship'));
export const SessionProfileSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  serviceName: Schema.String.check(Schema.isPattern(/^show-tools-[a-z0-9-]+\.service$/)),
  server: Schema.Struct({ nodeExecutable: path, entrypoint: path }),
  host: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
  port: integer(1, 65535),
  origin: Schema.NonEmptyString.check(Schema.isMaxLength(8192)),
  tokenFile: path, staticRoot: path, runtimeRoot: path,
  tls: Schema.optionalKey(Schema.Struct({ cert: path, key: path })),
  native: Schema.Struct({ executable: path, sampleRate: integer(8000, 192000), blockFrames: integer(1, 16384),
    maxVoices: integer(1, 128), maxSeconds: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(30)),
    driver: Schema.Union([AlsaSchema, Schema.Struct({ kind: Schema.Literal('fake'), inputLevel: Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: -1, maximum: 1 })) })]),
  }),
  package: Schema.Struct({ manifest: path, packet: path, effects: path }),
});
export type SessionProfile = typeof SessionProfileSchema.Type;
export const decodeSessionProfile = Schema.decodeUnknownSync(SessionProfileSchema);
