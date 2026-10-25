#ifndef SHOW_TOOLS_SAMPLE_ENGINE_H
#define SHOW_TOOLS_SAMPLE_ENGINE_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef struct st_engine st_engine;
enum { ST_CHANNELS = 32, ST_VARIANTS = 16, ST_HITS = 16 };
enum st_sample_rate_limits { ST_MIN_SAMPLE_RATE = 1, ST_MAX_SAMPLE_RATE = 384000 };
enum st_trigger_flags { ST_LOOP = 1, ST_TRIM_START = 2 };
enum st_reason { ST_ACTIVE = 0, ST_PREPARED = 1, ST_LIMIT = 2 };
/* Queries write fixed-size arrays of doubles. PCM pointers are borrowed; only
   command preparation/loading or engine destruction may invalidate them.
   A single caller owns an engine. Functions are not thread safe. */
enum st_sample_field { ST_SAMPLE_PRESENT, ST_SAMPLE_CHANNELS, ST_SAMPLE_LENGTH,
  ST_SAMPLE_RATE, ST_SAMPLE_ONSET, ST_SAMPLE_CAPACITY, ST_SAMPLE_LEFT,
  ST_SAMPLE_RIGHT, ST_SAMPLE_SLICES, ST_SAMPLE_VARIANT, ST_SAMPLE_FIELDS };
enum st_slot_field { ST_SLOT_PRESENT, ST_SLOT_RECORDING, ST_SLOT_PREPARED,
  ST_SLOT_FRAMES, ST_SLOT_START, ST_SLOT_SECONDS, ST_SLOT_PEAK, ST_SLOT_REASON,
  ST_SLOT_BUFFER, ST_SLOT_CAPACITY, ST_SLOT_VARIANT, ST_SLOT_WINDOWS,
  ST_SLOT_ONSET_FOUND, ST_SLOT_ENVELOPE, ST_SLOT_ONSET, ST_SLOT_FIELDS };
enum st_window_field { ST_WINDOW_BEGIN, ST_WINDOW_END, ST_WINDOW_SCORE,
  ST_WINDOW_START, ST_WINDOW_STOP, ST_WINDOW_QUIET, ST_WINDOW_LEVEL,
  ST_WINDOW_NOISE, ST_WINDOW_TARGET, ST_WINDOW_SLICE_PRESENT,
  ST_WINDOW_SLICE_START, ST_WINDOW_SLICE_END, ST_WINDOW_FIELDS };
enum st_voice_field { ST_VOICE_CHANNEL, ST_VOICE_LOOP, ST_VOICE_FRAME,
  ST_VOICE_GAIN, ST_VOICE_SERIAL, ST_VOICE_SOURCE_OFFSET, ST_VOICE_SOURCE_END,
  ST_VOICE_SLICE, ST_VOICE_FIELDS };
enum st_channel_field { ST_CHANNEL_CONFIGURED, ST_CHANNEL_GAIN,
  ST_CHANNEL_MUTED, ST_CHANNEL_FIELDS };
enum st_slice_field { ST_SLICE_PRESENT, ST_SLICE_START, ST_SLICE_END,
  ST_SLICE_TARGET, ST_SLICE_FIELDS };
enum st_stats_field { ST_STATS_RENDER_FRAME, ST_STATS_CAPTURE_FRAME,
  ST_STATS_TRIGGERED, ST_STATS_STOLEN, ST_STATS_LATE, ST_STATS_MAX_LATE,
  ST_STATS_MEMORY_BYTES, ST_STATS_VOLUME, ST_STATS_RATE, ST_STATS_VOICES,
  ST_STATS_SLOTS, ST_STATS_MAX_SECONDS, ST_STATS_FIELDS };

/* Engine and source rates are 1 through 384000 Hz. Timeline frames must be
   finite with absolute value at most 9007199254740991. A processing block
   must also satisfy abs(frame_start) + frames <= 9007199254740991. */
st_engine* st_create(double sample_rate, int max_voices, int max_slots, double max_seconds);
void st_destroy(st_engine* engine);
const char* st_error(const st_engine* engine);
/* Mutations return zero on success or -1 on error, unless documented otherwise.
   Loading and preparation copy/allocate PCM and collect unused old buffers.
   Processing, triggering, starting, and committing never allocate or free. */
int st_load(st_engine* engine, int channel, const float* left, const float* right, uint32_t frames, double source_rate);
int st_reserve_variant(st_engine* engine, int channel, int variant);
int st_prepare(st_engine* engine, int channel, int next, double max_seconds, int variant, const double* expected_frames, int hits, double radius_frames);
int st_start(st_engine* engine, int channel, double frame, int next);
/* Stop returns 1 for a nonempty committed take, 0 for no take, -1 for error. */
int st_stop(st_engine* engine, int channel, double frame, int reason);
int st_commit(st_engine* engine, int channel, int reason);
void st_cancel_next(st_engine* engine, int channel);
void st_stop_all_recordings(st_engine* engine, int reason);
/* Capture returns a channel bitmask of takes committed at their duration limit.
   A null input captures silence. Render adds PCM to caller-owned output arrays.
   Invalid block timelines set st_error and leave audio and engine state intact. */
uint32_t st_capture(st_engine* engine, const float* input, uint32_t frames, double frame_start);
void st_render(st_engine* engine, float* left, float* right, uint32_t frames, double frame_start);
int st_trigger(st_engine* engine, int channel, double frame, double gain, int flags, int slice, int variant);
void st_stop_voices(st_engine* engine, int channel);
void st_stop_all_voices(st_engine* engine);
int st_set_channel(st_engine* engine, int channel, double gain, int muted);
int st_set_volume(st_engine* engine, double volume);
int st_has(const st_engine* engine, int channel, int variant);
int st_is_looping(const st_engine* engine, int channel);
int st_slice_count(const st_engine* engine, int channel, int variant);
int st_has_slice(const st_engine* engine, int channel, int slice, int variant);
void st_sample_info(const st_engine* engine, int channel, int variant, double* out);
void st_sample_slice(const st_engine* engine, int channel, int variant, int slice, double* out);
void st_slot_info(const st_engine* engine, int channel, int next, double* out);
void st_window_info(const st_engine* engine, int channel, int next, int hit, double* out);
void st_voice_info(const st_engine* engine, int voice, double* out);
void st_channel_info(const st_engine* engine, int channel, double* out);
void st_stats(const st_engine* engine, double* out);
#ifdef __cplusplus
}
#endif
#endif
