import { Schema } from 'effect';

export const MAX_DEMO_BYTES = 192 * 1024 * 1024 + 44;
export const RECORDING_ARCHIVE_BATCH = 16;
const RecordingId = Schema.String.check(Schema.isPattern(/^take-[a-zA-Z0-9]{6}$/));
const ArchivedRecording = Schema.Struct({
  id: RecordingId,
  bytes: Schema.Int.check(Schema.isBetween({ minimum: 45, maximum: MAX_DEMO_BYTES })),
});

export type ArchivedRecording = typeof ArchivedRecording.Type;
export const decodeRecordingId = Schema.decodeUnknownSync(RecordingId);
export const decodeRecordingArchive = Schema.decodeUnknownSync(
  Schema.Struct({ pending: Schema.Array(ArchivedRecording).check(Schema.isMaxLength(RECORDING_ARCHIVE_BATCH)) }),
  { onExcessProperty: 'error' },
);
