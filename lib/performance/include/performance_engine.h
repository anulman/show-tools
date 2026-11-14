#ifndef SHOW_TOOLS_PERFORMANCE_ENGINE_H
#define SHOW_TOOLS_PERFORMANCE_ENGINE_H
#include "beat_tracker.h"
#include "sample_engine.h"
#include "audio_sequence_engine.h"
#include "performance_light_output.h"
#ifdef __cplusplus
extern "C" {
#endif

typedef struct pf_engine pf_engine;
enum pf_mode { PF_TRACKER = 0, PF_PERFORMANCE = 1, PF_PRACTICE = 2 };
enum pf_phase { PF_IDLE = 0, PF_COUNT_IN = 1, PF_PLAYING = 2, PF_ENDED = 3 };
enum pf_cue_kind { PF_NONE = 0, PF_UNSUPPORTED = 1, PF_TAP = 2, PF_ARM = 3, PF_COMMIT = 4, PF_COMMIT_ARM = 5, PF_STOP = 6, PF_PLAY = 7 };
enum pf_launch_policy { PF_AUTOPLAY = 0, PF_STORE_ONLY = 1 };
enum pf_playback_mode { PF_LOOP_MODE = 0, PF_ONESHOT_MODE = 1, PF_HELD_MODE = 2, PF_GATED_MODE = 3 };
enum pf_timing { PF_NOW = 0, PF_BAR = 1 };
enum pf_capture_kind { PF_CONTINUOUS = 0, PF_SPARSE = 1, PF_WHOLE_BAR = 2 };
enum pf_light { PF_OFF = 0, PF_CUE = 1, PF_STEADY = 2, PF_RELEASING = 3 };
enum pf_channel_status { PF_EMPTY = 0, PF_READY = 1, PF_ARMED = 2, PF_RECORDING = 3, PF_STOPPING = 4, PF_LOOPING = 5 };
enum pf_event_type { PF_STATE = 1, PF_BEAT = 2, PF_CONTROL = 3, PF_FAULT = 4, PF_TEMPO_HIT = 5 };
enum pf_error_code { PF_OK = 0, PF_CLOCK_RESTARTED = 1, PF_MISSED_BEAT = 2, PF_ACTION_FAILED = 3,
  PF_MICROPHONE_REQUIRED = 4, PF_NO_RECORDING = 5, PF_NO_SAMPLE = 6, PF_PATTERN_REQUIRED = 7,
  PF_MISSING_HIT = 8, PF_UNSUPPORTED_CUE = 9, PF_INVALID_COMMAND_ID = 10, PF_COMMAND_CONFLICT = 11,
  PF_INVALID_KNOB = 12, PF_INVALID_CHANNEL = 13, PF_INVALID_START = 14, PF_ALLOCATION_FAILED = 15, PF_INVALID_PROGRAM = 16,
  PF_INVALID_EFFECTS = 17, PF_CAPTURE_EFFECTS_UNAVAILABLE = 18, PF_CAPTURE_BUSY = 19, PF_TAKE_UNAVAILABLE = 20, PF_CUE_LATE = 21, PF_CUE_AMBIGUOUS = 22, PF_LOOP_MISMATCH = 23, PF_TEMPO_REJECTED = 24 };
enum pf_limits { PF_CHANNELS = 4, PF_MAX_BARS = 4096, PF_MAX_EVENTS = 4096, PF_EVENT_CAPACITY = 512, PF_ABI_VERSION = 11, PF_MAX_LIVE_EFFECTS = 64, PF_VOICE_PROFILES = 6, PF_DEFAULT_PROFILE = 4, PF_BACKUP_PROFILE = 5 };
enum pf_tuner_command { PF_TUNER_CONFIGURE = 0, PF_TUNER_CUE = 1, PF_TUNER_CONFIRM = 2, PF_TUNER_LISTEN = 3, PF_TUNER_CLOSE = 4, PF_TUNER_PLAY_SCALE = 5, PF_TUNER_SILENCE = 6 };
enum pf_tuner_field { PF_TUNER_REVISION, PF_TUNER_ROOT, PF_TUNER_SCALE, PF_TUNER_STEP, PF_TUNER_COUNT,
  PF_TUNER_COMPLETE, PF_TUNER_LISTENING, PF_TUNER_PREVIEW_KIND, PF_TUNER_PITCH_STATUS,
  PF_TUNER_FREQUENCY, PF_TUNER_MIDI, PF_TUNER_CENTS, PF_TUNER_CONFIDENCE, PF_TUNER_RMS,
  PF_TUNER_ROUNDED_MIDI, PF_TUNER_LETTER, PF_TUNER_ACCIDENTAL, PF_TUNER_OCTAVE, PF_TUNER_FRAME,
  PF_TUNER_PREVIEW_STEP, PF_TUNER_TARGETS, PF_TUNER_FIELDS = 72 };
enum pf_tuner_target_field { PF_TUNER_TARGET_MIDI, PF_TUNER_TARGET_LETTER, PF_TUNER_TARGET_ACCIDENTAL,
  PF_TUNER_TARGET_OCTAVE, PF_TUNER_TARGET_FIELDS };
enum pf_compiled_limits { PF_COMPILED_MAGIC = 0x50464331, PF_COMPILED_LEGACY_VERSION = 6, PF_COMPILED_VERSION = 7, PF_COMPILED_HEADER_FIELDS = 16, PF_COMPILED_TAKE_FIELDS = 9, PF_COMPILED_LEGACY_CUE_FIELDS = 11, PF_COMPILED_CUE_FIELDS = 16, PF_COMPILED_MEMBER_FIELDS = 3, PF_COMPILED_PLAYBACK_FIELDS = 3, PF_COMPILED_MAX_TAKES = 32, PF_COMPILED_ROTATION_MAGIC = 0x50465231, PF_COMPILED_ROTATION_HEADER_FIELDS = 3, PF_COMPILED_ROTATION_FIELDS = 4, PF_COMPILED_NOTES_MAGIC = 0x50464e31, PF_COMPILED_NOTES_FIELDS = 5, PF_COMPILED_EXTERNAL_MAGIC = 0x50464531, PF_COMPILED_EXTERNAL_FIELDS = 5, PF_COMPILED_WINDOW_MAGIC = 0x50465731, PF_COMPILED_WINDOW_HEADER_FIELDS = 2, PF_COMPILED_WINDOW_FIELDS = 4 };
enum pf_compiled_take_field { PF_TAKE_VOICE, PF_TAKE_READY, PF_TAKE_LENGTH, PF_TAKE_CAPACITY, PF_TAKE_REVISION, PF_TAKE_PHASE, PF_TAKE_PLAYBACK_STATE, PF_TAKE_PERIOD, PF_TAKE_SOURCE_END, PF_TAKE_SELECTION, PF_TAKE_FIELDS };
enum pf_tempo_field { PF_TEMPO_COUNT, PF_TEMPO_FRAME, PF_TEMPO_HINT, PF_TEMPO_SOURCE, PF_TEMPO_ESTIMATED, PF_TEMPO_BPM, PF_TEMPO_FIELDS };
enum pf_effect_type { PF_EFFECT_SLAPBACK = 1, PF_EFFECT_CHORUS = 2 };
typedef struct pf_slapback_parameters { double delay_ms, feedback, wet; } pf_slapback_parameters;
typedef struct pf_chorus_parameters { double rate_hz, depth_ms, base_delay_ms, wet; } pf_chorus_parameters;
typedef struct pf_effect_definition {
  uint32_t type, version;
  union { pf_slapback_parameters slapback; pf_chorus_parameters chorus; } parameters;
} pf_effect_definition;
enum pf_effect_layout {
  PF_EFFECT_TYPE_OFFSET = 0, PF_EFFECT_VERSION_OFFSET = 4,
  PF_EFFECT_DELAY_OFFSET = 8, PF_EFFECT_FEEDBACK_OFFSET = 16,
  PF_EFFECT_WET_OFFSET = 24, PF_EFFECT_CHORUS_RATE_OFFSET = 8, PF_EFFECT_CHORUS_DEPTH_OFFSET = 16, PF_EFFECT_CHORUS_DELAY_OFFSET = 24, PF_EFFECT_CHORUS_WET_OFFSET = 32, PF_EFFECT_BYTES = 40
};
enum pf_voice_activity { PF_VOICE_STANDBY = 0, PF_VOICE_LIVE = 1, PF_VOICE_TAIL = 2, PF_VOICE_CAPTURE = 3 };
enum pf_voice_field { PF_VOICE_PREPARED, PF_VOICE_REVISION, PF_VOICE_STAGE_COUNT, PF_VOICE_ACTIVITY, PF_VOICE_ROTATION_ELIGIBLE, PF_VOICE_ROTATION_REMAINING, PF_VOICE_FIELDS };
enum pf_voice_effect_field { PF_VOICE_EFFECT_TYPE, PF_VOICE_EFFECT_VERSION, PF_VOICE_EFFECT_PARAMETER_0, PF_VOICE_EFFECT_PARAMETER_1, PF_VOICE_EFFECT_PARAMETER_2, PF_VOICE_EFFECT_PARAMETER_3, PF_VOICE_EFFECT_FIELDS };
enum pf_live_field { PF_LIVE_PREPARED, PF_LIVE_ACTIVE, PF_LIVE_REVISION, PF_LIVE_STAGE_COUNT, PF_LIVE_CAPTURE_SUPPORTED, PF_LIVE_FIELDS };
/* Program cue rows are fixed-width doubles. Bar zero is the lead-in.
   Positions are zero-based beats. The variant is -1 or a sampler variant ID.
   Tap cues use that same variant ID to select a retained sparse pattern. */
enum pf_cue_field { PF_CUE_BAR, PF_CUE_CHANNEL, PF_CUE_KIND, PF_CUE_TIMING, PF_CUE_CAPTURE,
  PF_CUE_VARIANT, PF_CUE_HITS, PF_CUE_RADIUS, PF_CUE_POSITIONS, PF_CUE_FIELDS = 24 };
enum pf_snapshot_field {
  PF_PHASE, PF_BAR_NUMBER, PF_BEAT_NUMBER, PF_COUNT_IN_REMAINING, PF_BPM,
  PF_START_BAR, PF_END_BAR, PF_LOOP, PF_AUTOMATIC, PF_CLICK, PF_SELECTED_CHANNEL,
  PF_SEQUENCE, PF_COUNT_IN_BEATS, PF_COUNT_IN_ELAPSED, PF_POSITION_BEAT,
  PF_LAST_BEAT_ID, PF_EPOCH, PF_BAR_COUNT, PF_BEATS_PER_BAR, PF_PROGRAM_LENGTH,
  PF_MICROPHONE, PF_FRAME, PF_CLOCK_BEAT_ID, PF_CLOCK_BEAT_FRAME, PF_ERROR,
  PF_CLICK_ENABLED, PF_TRACKER_DROPS, PF_EVENT_DROPS, PF_FIELDS
};
enum pf_channel_field { PF_CHANNEL_GAIN, PF_CHANNEL_MUTED, PF_CHANNEL_LOOPING,
  PF_CHANNEL_READY, PF_CHANNEL_STATUS, PF_CHANNEL_LIGHT, PF_CHANNEL_RELEASE_MS,
  PF_CHANNEL_PENDING_KIND, PF_CHANNEL_FIELDS };
/* Event records include the immutable transport and four channel snapshots.
   STATE begins at 8; CHANNELS begins at 36. */
enum pf_event_field { PF_EVENT_TYPE, PF_EVENT_SEQUENCE, PF_EVENT_FRAME, PF_EVENT_RATE,
  PF_EVENT_ERROR, PF_EVENT_APPLIED, PF_EVENT_CONTROL, PF_EVENT_VALUE,
  PF_EVENT_STATE, PF_EVENT_CHANNELS = 36, PF_EVENT_CUE = 68, PF_EVENT_FIELDS = 69 };

uint32_t pf_abi_version(void);
pf_engine* pf_create(double sample_rate, int mode, int max_voices, double max_seconds, int beats_per_bar);
void pf_destroy(pf_engine* engine);
const char* pf_error(const pf_engine* engine);
const char* pf_message(int code);
bt_tracker* pf_tracker(pf_engine* engine);
st_engine* pf_sampler(pf_engine* engine);
sq_engine* pf_sequencer(pf_engine* engine);
/* Configuration is copied atomically while stopped. Events are triples
   [whole-beat offset, channel ID, gain]. Playback rows are [bar,channel,variant]. */
int pf_configure(pf_engine* engine, double bpm, int beats_per_bar, int bar_count, int default_end_bar,
  int program_length, const double* events, int event_count,
  const double* cues, int cue_count, const double* playback, int playback_count);
/* Packet 6 rotation extension: [magic, window count, inactivity duration in
   chart-count beats, ...window rows]. Older packet semantics are rejected.
   Compiled records use the versioned double-table format. All tables and capture
   resources are validated/prepared before an atomic stopped replacement. */
int pf_configure_compiled(pf_engine* engine, const double* data, uint32_t fields);
/* Portable artifact encoding is the same table as little-endian IEEE754 doubles. */
int pf_load_compiled_bytes(pf_engine* engine, const uint8_t* data, uint32_t bytes);
int pf_set_bend_parameters(pf_engine* engine, double velocity_per_semitone, double stale_ms);
int pf_prepare_external_sample(pf_engine* engine, uint32_t slot, const float* left, const float* right, uint32_t frames);
int pf_trigger_external(pf_engine* engine, uint32_t slot);
void pf_compiled_take_info(const pf_engine* engine, uint32_t take, double* out);
/* Shared pedal/star tempo evidence. Control 6 submits an unhinted pedal hit. */
void pf_tempo_info(const pf_engine* engine, double* out);
int pf_clock_command(pf_engine* engine, int type, double value, double frame, double client_sequence, double epoch);
int pf_start(pf_engine* engine, double bpm, int count_in_bars, int start_bar, int end_bar, int loop, int automatic);
void pf_stop(pf_engine* engine);
/* Tuning borrows this engine's existing audio session while transport is stopped.
   Every mutation names the last observed control revision. Pitch telemetry does
   not advance it. Close/Start/Stop/Panic invalidate earlier tuner controls. */
int pf_tuner_command_apply(pf_engine* engine, int command, uint32_t expected_revision, int value, int scale);
void pf_tuner_info(const pf_engine* engine, double* out);
int pf_audio_needed(const pf_engine* engine);
/* IDs preserve JavaScript UTF-16 code-unit identity, including embedded NULs.
   Null pointer with zero length means no ID. Other IDs contain 1..200 units. */
/* Controls 0..3 pads, 4 Panic, 5 signed relative jiggle, 6 tempo hit,
   7 cue button (0 released, 1 held). Only a fresh rising edge performs cues. */
int pf_control(pf_engine* engine, int control, double value, const uint16_t* command_id, uint32_t command_length);
/* Complete engine-authored brightness image. Query on the engine owner thread.
   Repeated queries without a changed image retain their publication sequence. */
void pf_light_output(pf_engine* engine, double* out);
/* Software gesture thresholds in source-relative units. Integers 1..32767,
   reversal <= travel. Changes require Stop; identical valid values are a no-op
   even while playing and preserve gesture history. Defaults are 4 and 2. */
int pf_set_jiggle_thresholds(pf_engine* engine, double minimum_travel, double minimum_reversal);
int pf_select(pf_engine* engine, int channel);
int pf_set_channel(pf_engine* engine, int channel, double gain, int muted);
int pf_set_automatic(pf_engine* engine, int automatic);
int pf_set_click(pf_engine* engine, int enabled);
int pf_set_click_gain(pf_engine* engine, double gain);
int pf_set_microphone(pf_engine* engine, int enabled);
/* Preparation copies definitions and allocates while stopped, with no active or
   pending capture. Count zero prepares identity processing. Revisions are positive
   and host-owned; same revision and definitions are idempotent, lower or conflicting
   revisions fail. Failed preparation preserves the previous rack and revision. */
int pf_prepare_live_effects(pf_engine* engine, const pf_effect_definition* effects, uint32_t count, uint32_t revision);
void pf_live_info(const pf_engine* engine, double* out);
/* Six ordered profile stacks are prepared as one stopped transaction. Counts and
   revisions each contain PF_VOICE_PROFILES entries; effects concatenates their
   definitions in profile order. Unchanged revisions require identical definitions. */
int pf_prepare_voice_effects(pf_engine* engine, const pf_effect_definition* effects, const uint32_t* counts, const uint32_t* revisions);
void pf_voice_info(const pf_engine* engine, uint32_t profile, double* out);
void pf_voice_effect_info(const pf_engine* engine, uint32_t profile, uint32_t stage, double* out);
/* Planar float outputs add to caller-cleared buffers. Every output and input may
   be null. Non-null spans must not overlap. Overlap returns -1 without changing
   engine state, last error, or output. Live input is mono and maps to both channels.
   Start authorizes live only with microphone ready and effects prepared. Stop,
   Panic, end, fatal fault, or mic loss gate/reset it; mic readiness alone cannot
   reauthorize. Null live outputs discard audio while advancing DSP once. */
int pf_process_stems(pf_engine* engine, const float* input, float* sample_click_left, float* sample_click_right,
  float* live_left, float* live_right, uint32_t frames);
/* Process adds output, advances the owned clock, and executes all musical
   decisions. No JavaScript callbacks are used. One caller owns each engine. */
int pf_process(pf_engine* engine, const float* input, float* left, float* right, uint32_t frames);
/* Flush command acknowledgments and snapshot epoch changes without advancing time. */
void pf_flush(pf_engine* engine);
void pf_snapshot(const pf_engine* engine, double* out);
void pf_channel_info(const pf_engine* engine, int channel, double* out);
uint32_t pf_drain_tracker_events(pf_engine* engine, double* out, uint32_t capacity);
uint32_t pf_drain_events(pf_engine* engine, double* out, uint32_t capacity);
/* Diagnostic beat injection uses the same native transport/action path.
   Do not mix injected beats with normal owned-clock processing. */
int pf_on_beat(pf_engine* engine, double beat_id, double frame, double epoch);
int pf_trigger_count(const pf_engine* engine);
void pf_trigger_info(const pf_engine* engine, int index, double* out);
#ifdef __cplusplus
}
#endif
#endif
