#ifndef SHOW_TOOLS_PERFORMANCE_ENGINE_H
#define SHOW_TOOLS_PERFORMANCE_ENGINE_H
#include "beat_tracker.h"
#include "sample_engine.h"
#include "audio_sequence_engine.h"
#ifdef __cplusplus
extern "C" {
#endif

typedef struct pf_engine pf_engine;
enum pf_mode { PF_TRACKER = 0, PF_PERFORMANCE = 1, PF_PRACTICE = 2 };
enum pf_phase { PF_IDLE = 0, PF_COUNT_IN = 1, PF_PLAYING = 2, PF_ENDED = 3 };
enum pf_cue_kind { PF_NONE = 0, PF_UNSUPPORTED = 1, PF_TAP = 2, PF_ARM = 3, PF_COMMIT = 4, PF_COMMIT_ARM = 5, PF_STOP = 6, PF_PLAY = 7 };
enum pf_timing { PF_NOW = 0, PF_BAR = 1 };
enum pf_capture_kind { PF_CONTINUOUS = 0, PF_SPARSE = 1, PF_WHOLE_BAR = 2 };
enum pf_light { PF_OFF = 0, PF_CUE = 1, PF_STEADY = 2, PF_RELEASING = 3 };
enum pf_channel_status { PF_EMPTY = 0, PF_READY = 1, PF_ARMED = 2, PF_RECORDING = 3, PF_STOPPING = 4, PF_LOOPING = 5 };
enum pf_event_type { PF_STATE = 1, PF_BEAT = 2, PF_CONTROL = 3, PF_FAULT = 4 };
enum pf_error_code { PF_OK = 0, PF_CLOCK_RESTARTED = 1, PF_MISSED_BEAT = 2, PF_ACTION_FAILED = 3,
  PF_MICROPHONE_REQUIRED = 4, PF_NO_RECORDING = 5, PF_NO_SAMPLE = 6, PF_PATTERN_REQUIRED = 7,
  PF_MISSING_HIT = 8, PF_UNSUPPORTED_CUE = 9, PF_INVALID_COMMAND_ID = 10, PF_COMMAND_CONFLICT = 11,
  PF_INVALID_KNOB = 12, PF_INVALID_CHANNEL = 13, PF_INVALID_START = 14, PF_ALLOCATION_FAILED = 15, PF_INVALID_PROGRAM = 16 };
enum pf_limits { PF_CHANNELS = 4, PF_MAX_BARS = 4096, PF_MAX_EVENTS = 4096, PF_EVENT_CAPACITY = 512, PF_ABI_VERSION = 1 };
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
  PF_EVENT_STATE, PF_EVENT_CHANNELS = 36, PF_EVENT_FIELDS = 68 };

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
int pf_clock_command(pf_engine* engine, int type, double value, double frame, double client_sequence, double epoch);
int pf_start(pf_engine* engine, double bpm, int count_in_bars, int start_bar, int end_bar, int loop, int automatic);
void pf_stop(pf_engine* engine);
/* IDs preserve JavaScript UTF-16 code-unit identity, including embedded NULs.
   Null pointer with zero length means no ID. Other IDs contain 1..200 units. */
int pf_control(pf_engine* engine, int control, double value, const uint16_t* command_id, uint32_t command_length);
int pf_select(pf_engine* engine, int channel);
int pf_set_channel(pf_engine* engine, int channel, double gain, int muted);
int pf_set_automatic(pf_engine* engine, int automatic);
int pf_set_click(pf_engine* engine, int enabled);
int pf_set_click_gain(pf_engine* engine, double gain);
int pf_set_microphone(pf_engine* engine, int enabled);
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
