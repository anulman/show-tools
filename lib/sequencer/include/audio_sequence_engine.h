#ifndef SHOW_TOOLS_AUDIO_SEQUENCE_ENGINE_H
#define SHOW_TOOLS_AUDIO_SEQUENCE_ENGINE_H
#include "sample_engine.h"
#ifdef __cplusplus
extern "C" {
#endif

typedef struct sq_engine sq_engine;
enum sq_limits { SQ_PATTERNS = 64, SQ_EVENTS = 4096 };
enum sq_quantize { SQ_BEAT = 0, SQ_BAR = 1 };
enum sq_action { SQ_PLAY = 0, SQ_START = 1, SQ_STOP = 2 };
enum sq_status { SQ_READY = 0, SQ_PLAYING = 1, SQ_QUEUED = 2 };
enum sq_snapshot_field {
  SQ_STATUS, SQ_ACTIVE_ID, SQ_ACTIVE_LENGTH, SQ_POSITION,
  SQ_PENDING_ID, SQ_PENDING_LENGTH, SQ_PENDING_QUANTIZE, SQ_PENDING_TARGET,
  SQ_BAR_NUMBER, SQ_BEAT_NUMBER, SQ_BEATS_PER_BAR,
  SQ_EPOCH, SQ_BEAT_ID, SQ_FRAME, SQ_BAR_ORIGIN, SQ_MARK_NEXT_ONE,
  SQ_LAUNCHES, SQ_PLAYED, SQ_SKIPPED, SQ_ACTIVE_VERSION, SQ_PENDING_VERSION, SQ_FIELDS
};
enum sq_pattern_field { SQ_PATTERN_PRESENT, SQ_PATTERN_ID, SQ_PATTERN_LENGTH, SQ_PATTERN_EVENTS, SQ_PATTERN_VERSION, SQ_PATTERN_FIELDS };
enum sq_record_field { SQ_RECORD_PRESENT, SQ_RECORD_ACTION, SQ_RECORD_QUANTIZE, SQ_RECORD_TARGET, SQ_RECORD_LOOP, SQ_RECORD_ORDER, SQ_RECORD_FIELDS };
enum sq_cue_field { SQ_CUE_PRESENT, SQ_CUE_ACTION, SQ_CUE_QUANTIZE, SQ_CUE_TARGET, SQ_CUE_GAIN, SQ_CUE_ORDER, SQ_CUE_FIELDS };

/* The sampler is borrowed. One caller owns a sequencer. Definition allocates and
   collects retired immutable patterns; on-beat dispatch never allocates or frees.
   Missing IDs, epochs, frame and bar origins are reported as -1 in query arrays. */
sq_engine* sq_create(st_engine* sampler, int beats_per_bar);
void sq_destroy(sq_engine* engine);
const char* sq_error(const sq_engine* engine);
/* Pattern events are copied triples [whole-beat offset, channel ID, gain]. */
int sq_define(sq_engine* engine, int id, double length_beats, const double* events, int event_count);
int sq_queue(sq_engine* engine, int id, int quantize);
void sq_cancel_queue(sq_engine* engine);
int sq_arm_recording(sq_engine* engine, int channel, int action, int quantize, double max_seconds, int loop);
void sq_cancel_recording(sq_engine* engine, int channel);
int sq_cue(sq_engine* engine, int channel, int action, int quantize, double gain);
void sq_cancel_cue(sq_engine* engine, int channel);
void sq_silence(sq_engine* engine, int channel);
void sq_mark_one(sq_engine* engine);
void sq_stop(sq_engine* engine);
int sq_reset(sq_engine* engine, double beat_id);
int sq_on_beat(sq_engine* engine, double beat_id, double frame, double epoch);
double sq_next_bar(const sq_engine* engine);
void sq_snapshot(const sq_engine* engine, double* out);
void sq_pattern_info(const sq_engine* engine, int id, double* out);
void sq_record_info(const sq_engine* engine, int channel, double* out);
void sq_cue_info(const sq_engine* engine, int channel, double* out);
#ifdef __cplusplus
}
#endif
#endif
