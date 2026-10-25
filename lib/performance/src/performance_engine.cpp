#include "performance_engine.h"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <new>

namespace {
constexpr double safe_frame = 9007199254740991.0;
constexpr double infinity = 1e300;
constexpr int telemetry_capacity = 512;
constexpr int dedup_capacity = 256;
static_assert(PF_EVENT_CHANNELS == PF_EVENT_STATE + PF_FIELDS);
static_assert(PF_EVENT_FIELDS == PF_EVENT_CHANNELS + PF_CHANNELS * PF_CHANNEL_FIELDS);
static_assert(PF_CUE_FIELDS == PF_CUE_POSITIONS + ST_HITS);
struct Cue {
  int kind = PF_NONE, timing = PF_NOW, capture = PF_CONTINUOUS, variant = -1, hits = 0;
  double radius = 0, positions[ST_HITS]{};
};
struct ProgramEvent { int beat = 0, channel = 0; double gain = 1; };
struct Playback { int bar = 1, channel = 0, variant = 0; };
struct Song {
  int bars = 1, end = 1, length = 4, event_count = 0, playback_count = 0;
  Cue* cues = nullptr;
  ProgramEvent* events = nullptr;
  Playback* playback = nullptr;
  ~Song() { delete[] cues; delete[] events; delete[] playback; }
};
struct Pending { bool present = false; Cue cue; double target = 0; };
struct Dedup { bool present = false; uint16_t id[200]{}; uint32_t length = 0; int control = 0; double value = 0; };
struct ClockCommand { bool present = false; double client = 0, epoch = 0, native = 0; };
bool integer(double value) { return std::isfinite(value) && std::floor(value) == value && std::abs(value) <= safe_frame; }
bool flag(int value) { return value == 0 || value == 1; }
bool whitespace(uint16_t value) {
  return (value >= 0x0009 && value <= 0x000d) || value == 0x0020 || value == 0x00a0
    || value == 0x1680 || (value >= 0x2000 && value <= 0x200a) || value == 0x2028
    || value == 0x2029 || value == 0x202f || value == 0x205f || value == 0x3000 || value == 0xfeff;
}
bool channel(int value) { return value >= 0 && value < PF_CHANNELS; }
bool numeric_channel(double value) { return integer(value) && value >= 0 && value < PF_CHANNELS; }
bool frame(double value) { return std::isfinite(value) && std::abs(value) <= safe_frame; }
}

struct pf_engine {
  bt_tracker* tracker = nullptr;
  st_engine* sampler = nullptr;
  sq_engine* sequencer = nullptr;
  Song* song = nullptr;
  double rate = 0, processed = 0, bpm = 120, epoch = 1, clock_beat = 0, clock_frame = 0, click_origin = 0, max_seconds = 30;
  int mode = PF_TRACKER, phase = PF_IDLE, start = 1, end = 1, selected = 2, beats_per_bar = 4;
  int bar = -1, beat = -1, count_beats = 0, count_elapsed = 0, count_remaining = 0, position = -1;
  double last_beat = -1, run_epoch = -1, sequence = 0, clock_sequence = 0, client_sequence = -1;
  bool loop = true, automatic = false, song_click = false, generic_click = false, microphone = false;
  bool used[PF_CHANNELS]{}, suppressed[PF_CHANNELS]{};
  int tap_position[PF_CHANNELS]{};
  Pending pending[PF_CHANNELS];
  double resume[PF_CHANNELS]{-1, -1, -1, -1};
  int error_code = PF_OK;
  const char* error = "";
  float* clicks[2]{};
  int click_length = 0, click_accent = 0;
  double click_start = -infinity, click_gain = 1;
  double telemetry[telemetry_capacity][BT_E_COUNT]{};
  unsigned telemetry_head = 0, telemetry_count = 0, telemetry_drops = 0;
  double events[PF_EVENT_CAPACITY][PF_EVENT_FIELDS]{};
  unsigned event_head = 0, event_count = 0, event_drops = 0;
  Dedup dedup[dedup_capacity];
  unsigned dedup_cursor = 0;
  ClockCommand commands[64];
  unsigned command_cursor = 0;
  int trigger_count = 0;
  ProgramEvent triggers[PF_MAX_EVENTS];
};

namespace {
int fail(pf_engine* engine, int code, const char* message = nullptr) {
  if (engine) { engine->error_code = code; engine->error = message ? message : pf_message(code); }
  return -1;
}
bool recording(const pf_engine* engine, int id) {
  double data[ST_SLOT_FIELDS]; st_slot_info(engine->sampler, id, 0, data);
  return data[ST_SLOT_RECORDING] != 0;
}
bool click_enabled(const pf_engine* engine) {
  return engine->mode == PF_PRACTICE ? engine->phase == PF_COUNT_IN || (engine->phase == PF_PLAYING && engine->song_click) : engine->generic_click;
}
const Cue& current_cue(const pf_engine* engine, int id) {
  static const Cue none;
  if (!engine->song || !channel(id)) return none;
  int bar = engine->phase == PF_COUNT_IN ? 0 : engine->phase == PF_PLAYING ? engine->bar : -1;
  return bar < 0 ? none : engine->song->cues[bar * PF_CHANNELS + id];
}
double next_bar(const pf_engine* engine) {
  if (engine->last_beat < 0) return engine->clock_beat + 1 + (engine->phase == PF_COUNT_IN ? engine->count_beats : 0);
  if (engine->phase == PF_COUNT_IN) return engine->last_beat + engine->count_remaining;
  return engine->last_beat + 4 - std::max(1, engine->beat) + 1;
}
void emit(pf_engine* engine, int type, double when = -1, int applied = -1, int control = -1, double value = 0) {
  if (engine->event_count == PF_EVENT_CAPACITY) {
    engine->event_head = (engine->event_head + 1) % PF_EVENT_CAPACITY;
    --engine->event_count; ++engine->event_drops;
  }
  double* event = engine->events[(engine->event_head + engine->event_count++) % PF_EVENT_CAPACITY];
  std::fill(event, event + PF_EVENT_FIELDS, 0);
  event[PF_EVENT_TYPE] = type;
  event[PF_EVENT_SEQUENCE] = ++engine->sequence;
  event[PF_EVENT_FRAME] = when;
  event[PF_EVENT_RATE] = engine->rate;
  event[PF_EVENT_ERROR] = engine->error_code;
  event[PF_EVENT_APPLIED] = applied;
  event[PF_EVENT_CONTROL] = control;
  event[PF_EVENT_VALUE] = value;
  pf_snapshot(engine, event + PF_EVENT_STATE);
  for (int id = 0; id < PF_CHANNELS; ++id) pf_channel_info(engine, id, event + PF_EVENT_CHANNELS + id * PF_CHANNEL_FIELDS);
}
void silence(pf_engine* engine, int reason = 3) {
  sq_stop(engine->sequencer);
  for (int id = 0; id < PF_CHANNELS; ++id) {
    engine->pending[id].present = false;
    engine->resume[id] = -1;
    engine->used[id] = false;
    engine->tap_position[id] = 0;
  }
  st_stop_all_recordings(engine->sampler, reason);
  st_stop_all_voices(engine->sampler);
  engine->click_start = -infinity;
}
int sample_result(pf_engine* engine, int result) { return result < 0 ? fail(engine, PF_ACTION_FAILED, st_error(engine->sampler)) : result; }
int sequence_result(pf_engine* engine, int result) { return result < 0 ? fail(engine, PF_ACTION_FAILED, sq_error(engine->sequencer)) : result; }
int execute(pf_engine* engine, int id, const Cue& cue, double when) {
  switch (cue.kind) {
    case PF_ARM:
      if (sample_result(engine, st_start(engine->sampler, id, when, 0)) < 0) return -1;
      engine->suppressed[id] = false;
      break;
    case PF_COMMIT:
    case PF_COMMIT_ARM: {
      int committed = st_stop(engine->sampler, id, when, 3);
      if (sample_result(engine, committed) < 0) return -1;
      if (committed) {
        if (sample_result(engine, st_trigger(engine->sampler, id, std::ceil(when), 1, ST_LOOP, -1, -1)) < 0) return -1;
        engine->suppressed[id] = false;
      }
      if (cue.kind == PF_COMMIT_ARM && sample_result(engine, st_start(engine->sampler, id, when, 1)) < 0) return -1;
      break;
    }
    case PF_STOP:
      sq_silence(engine->sequencer, id);
      engine->suppressed[id] = true;
      break;
    case PF_PLAY:
      if (sample_result(engine, st_trigger(engine->sampler, id, std::ceil(when), 1, ST_LOOP, -1, -1)) < 0) return -1;
      engine->suppressed[id] = false;
      break;
    default: return fail(engine, PF_UNSUPPORTED_CUE);
  }
  return 0;
}
int press(pf_engine* engine, int id) {
  engine->selected = id;
  const Cue& cue = current_cue(engine, id);
  if (cue.kind == PF_NONE) return 0;
  if (cue.kind == PF_UNSUPPORTED) return fail(engine, PF_UNSUPPORTED_CUE);
  if (cue.kind == PF_TAP) {
    if (!st_has(engine->sampler, id, -1)) return fail(engine, PF_NO_SAMPLE);
    int variant = cue.variant >= 0 && st_has(engine->sampler, id, cue.variant) ? cue.variant : -1;
    if (variant < 0 && st_slice_count(engine->sampler, id, -1) > 0) return fail(engine, PF_PATTERN_REQUIRED);
    int count = st_slice_count(engine->sampler, id, variant);
    int slice = count > 0 ? engine->tap_position[id] : -1;
    if (slice >= 0 && !st_has_slice(engine->sampler, id, slice, variant)) return fail(engine, PF_MISSING_HIT);
    if (st_is_looping(engine->sampler, id)) engine->resume[id] = next_bar(engine);
    sq_silence(engine->sequencer, id);
    if (sample_result(engine, st_trigger(engine->sampler, id, engine->processed, 1, slice < 0 ? ST_TRIM_START : 0, slice, variant)) < 0) return -1;
    engine->used[id] = true;
    if (slice >= 0) engine->tap_position[id] = (slice + 1) % count;
    return 0;
  }
  if (cue.kind == PF_STOP || cue.kind == PF_PLAY || cue.kind == PF_COMMIT || cue.kind == PF_COMMIT_ARM) engine->resume[id] = -1;
  double target = cue.timing == PF_BAR ? next_bar(engine) : engine->clock_beat;
  Pending& previous = engine->pending[id];
  if (previous.present && previous.cue.kind == cue.kind && previous.target == target) return 0;
  if (cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM) {
    if (!engine->microphone) return fail(engine, PF_MICROPHONE_REQUIRED);
    if (cue.kind == PF_COMMIT_ARM && !recording(engine, id)) return fail(engine, PF_NO_RECORDING);
    double expected[ST_HITS];
    for (int hit = 0; hit < cue.hits; ++hit) expected[hit] = std::floor(cue.positions[hit] * engine->rate * 60 / engine->bpm + 0.5);
    int hits = cue.capture == PF_SPARSE ? cue.hits : 0;
    double radius = hits ? std::floor(cue.radius * engine->rate * 60 / engine->bpm + 0.5) : 0;
    if (sample_result(engine, st_prepare(engine->sampler, id, cue.kind == PF_COMMIT_ARM, engine->max_seconds, cue.variant, expected, hits, radius)) < 0) return -1;
  } else if (cue.kind == PF_COMMIT && !recording(engine, id)) return fail(engine, PF_NO_RECORDING);
  else if (cue.kind == PF_PLAY && !st_has(engine->sampler, id, -1)) return fail(engine, PF_NO_SAMPLE);
  if (previous.present && previous.cue.kind == PF_COMMIT_ARM && cue.kind != PF_COMMIT_ARM) st_cancel_next(engine->sampler, id);
  if (cue.timing == PF_BAR) { previous.present = true; previous.cue = cue; previous.target = target; }
  else { previous.present = false; if (execute(engine, id, cue, engine->processed) < 0) return -1; }
  engine->used[id] = true;
  return 0;
}
void queue_tracker(pf_engine* engine, const double* event) {
  if (engine->telemetry_count == telemetry_capacity) {
    engine->telemetry_head = (engine->telemetry_head + 1) % telemetry_capacity;
    --engine->telemetry_count; ++engine->telemetry_drops;
  }
  double* destination = engine->telemetry[(engine->telemetry_head + engine->telemetry_count++) % telemetry_capacity];
  std::copy(event, event + BT_E_COUNT, destination);
}
void render_segment(pf_engine* engine, const float* input, float* left, float* right, unsigned count, double start) {
  if (!count) return;
  if (engine->mode != PF_TRACKER) {
    uint32_t limited = st_capture(engine->sampler, input, count, start);
    if (engine->mode == PF_PRACTICE && engine->phase == PF_PLAYING) {
      for (int id = 0; id < PF_CHANNELS; ++id) if (limited & (uint32_t(1) << id)) {
        double slot[ST_SLOT_FIELDS]; st_slot_info(engine->sampler, id, 0, slot);
        sq_cancel_recording(engine->sequencer, id);
        st_trigger(engine->sampler, id, slot[ST_SLOT_START] + slot[ST_SLOT_FRAMES], 1, ST_LOOP, -1, -1);
      }
    }
  }
  if (click_enabled(engine)) {
    const float* click = engine->clicks[engine->click_accent];
    for (unsigned index = 0; index < count; ++index) {
      double age = start + index - engine->click_start;
      if (age < 0 || age >= engine->click_length - 1) continue;
      unsigned base = unsigned(std::floor(age));
      double value = (click[base] + (age - base) * (click[base + 1] - click[base])) * engine->click_gain;
      if (left) left[index] = float(left[index] + value);
      if (right) right[index] = float(right[index] + value);
    }
  }
  if (engine->mode != PF_TRACKER) st_render(engine->sampler, left, right, count, start);
  engine->processed = std::max(engine->processed, start + count);
}
int clock_command(pf_engine* engine, int type, double value, double when, double sequence, double epoch) {
  if (!engine || !frame(when) || !integer(sequence) || sequence < 0 || !integer(epoch) || epoch < 0) return BT_INVALID;
  for (const ClockCommand& command : engine->commands) if (command.present && command.client == sequence && command.epoch == epoch) {
    return bt_command(engine->tracker, type, value, when, command.native, epoch);
  }
  if (sequence <= engine->client_sequence) return BT_OUT_OF_ORDER;
  double native = std::max(engine->clock_sequence + 1, sequence);
  if (!integer(native)) return BT_INVALID;
  int result = bt_command(engine->tracker, type, value, when, native, epoch);
  if (result == BT_OK || result == BT_DUPLICATE) {
    engine->clock_sequence = native; engine->client_sequence = sequence;
    engine->commands[engine->command_cursor++ % 64] = {true, sequence, epoch, native};
  }
  return result;
}
void reset_epoch(pf_engine* engine, double epoch, double beat_id) {
  engine->epoch = epoch;
  engine->phase = PF_IDLE;
  engine->count_remaining = 0;
  sq_reset(engine->sequencer, beat_id);
  silence(engine, 4);
  engine->clock_beat = beat_id; engine->click_origin = beat_id;
  engine->telemetry_head = engine->telemetry_count = 0;
}
}

extern "C" {
const char* pf_message(int code) {
  switch (code) {
    case PF_OK: return "";
    case PF_CLOCK_RESTARTED: return "The audio clock restarted. Start a fresh run.";
    case PF_MISSED_BEAT: return "The audio clock missed a beat. Start a fresh run.";
    case PF_ACTION_FAILED: return "Audio action failed";
    case PF_MICROPHONE_REQUIRED: return "Enable the microphone before recording";
    case PF_NO_RECORDING: return "This channel has no recording to commit";
    case PF_NO_SAMPLE: return "Capture or load a sample before playing this channel";
    case PF_PATTERN_REQUIRED: return "Capture this hit pattern before playing its chart cue.";
    case PF_MISSING_HIT: return "Recorded hit is missing. Record this channel again near its charted beats.";
    case PF_UNSUPPORTED_CUE: return "Unsupported chart cue";
    case PF_INVALID_COMMAND_ID: return "Command ID must be a nonempty string of at most 200 characters";
    case PF_COMMAND_CONFLICT: return "Command ID was already used for another control";
    case PF_INVALID_KNOB: return "Knob value must be between zero and one";
    case PF_INVALID_CHANNEL: return "Unknown channel";
    case PF_INVALID_START: return "Invalid practice start options";
    case PF_ALLOCATION_FAILED: return "Could not allocate performance program";
    case PF_INVALID_PROGRAM: return "Invalid performance program";
    default: return "Unknown performance error";
  }
}
uint32_t pf_abi_version(void) { return PF_ABI_VERSION; }
pf_engine* pf_create(double rate, int mode, int voices, double seconds, int beats_per_bar) {
  if (!std::isfinite(rate) || rate < ST_MIN_SAMPLE_RATE || rate > ST_MAX_SAMPLE_RATE || mode < PF_TRACKER || mode > PF_PRACTICE) return nullptr;
  if (beats_per_bar < 1 || (mode == PF_PRACTICE && beats_per_bar != 4)) return nullptr;
  pf_engine* engine = new (std::nothrow) pf_engine;
  if (!engine) return nullptr;
  engine->rate = rate; engine->mode = mode; engine->beats_per_bar = beats_per_bar; engine->max_seconds = seconds;
  engine->tracker = bt_create(rate);
  engine->sampler = st_create(rate, voices, 8, seconds);
  if (engine->sampler) engine->sequencer = sq_create(engine->sampler, beats_per_bar);
  engine->song = new (std::nothrow) Song;
  if (engine->song) engine->song->cues = new (std::nothrow) Cue[8];
  engine->click_length = int(std::ceil(rate * 0.012)) + 1;
  for (int accent = 0; accent < 2; ++accent) {
    engine->clicks[accent] = new (std::nothrow) float[engine->click_length];
    if (!engine->clicks[accent]) continue;
    double frequency = accent ? 2100 : 1400, gain = accent ? 0.12 : 0.08;
    for (int index = 0; index < engine->click_length - 1; ++index) {
      double time = index / rate;
      engine->clicks[accent][index] = float(gain * std::cos(2 * std::acos(-1.0) * frequency * time) * std::exp(-time / 0.002) * (1 - double(index) / (engine->click_length - 1)));
    }
    engine->clicks[accent][engine->click_length - 1] = 0;
  }
  if (!engine->tracker || !engine->sampler || !engine->sequencer || !engine->song || !engine->song->cues || !engine->clicks[0] || !engine->clicks[1]) { pf_destroy(engine); return nullptr; }
  return engine;
}
void pf_destroy(pf_engine* engine) {
  if (!engine) return;
  sq_destroy(engine->sequencer); st_destroy(engine->sampler); bt_destroy(engine->tracker);
  delete engine->song; delete[] engine->clicks[0]; delete[] engine->clicks[1]; delete engine;
}
const char* pf_error(const pf_engine* engine) { return engine ? engine->error : "Could not allocate performance engine"; }
bt_tracker* pf_tracker(pf_engine* engine) { return engine ? engine->tracker : nullptr; }
st_engine* pf_sampler(pf_engine* engine) { return engine ? engine->sampler : nullptr; }
sq_engine* pf_sequencer(pf_engine* engine) { return engine ? engine->sequencer : nullptr; }
int pf_clock_command(pf_engine* engine, int type, double value, double when, double sequence, double epoch) { return clock_command(engine, type, value, when, sequence, epoch); }
int pf_configure(pf_engine* engine, double bpm, int beats, int bars, int end, int length,
  const double* events, int event_count, const double* cues, int cue_count, const double* playback, int playback_count) {
  if (!engine) return -1;
  if (engine->phase == PF_PLAYING || engine->phase == PF_COUNT_IN) return fail(engine, PF_INVALID_PROGRAM, "Stop before configuring a song");
  if (!std::isfinite(bpm) || bpm < 40 || bpm > 240 || beats != 4 || bars < 1 || bars > PF_MAX_BARS || end < 1 || end > bars || length < 1 || event_count < 0 || event_count > PF_MAX_EVENTS || cue_count < 0 || cue_count > (bars + 1) * 4 || playback_count < 0 || playback_count > PF_MAX_EVENTS || (event_count && !events) || (cue_count && !cues) || (playback_count && !playback)) return fail(engine, PF_INVALID_PROGRAM);
  for (int index = 0; index < event_count; ++index) {
    const double* item = events + index * 3;
    if (!integer(item[0]) || item[0] < 0 || item[0] >= length || !numeric_channel(item[1]) || !std::isfinite(item[2]) || item[2] < 0) return fail(engine, PF_INVALID_PROGRAM);
  }
  for (int index = 0; index < cue_count; ++index) {
    const double* item = cues + index * PF_CUE_FIELDS;
    for (int field = PF_CUE_BAR; field <= PF_CUE_HITS; ++field) if (!integer(item[field])) return fail(engine, PF_INVALID_PROGRAM);
    if (item[PF_CUE_BAR] < 0 || item[PF_CUE_BAR] > bars || !numeric_channel(item[PF_CUE_CHANNEL]) || item[PF_CUE_KIND] < PF_NONE || item[PF_CUE_KIND] > PF_PLAY || item[PF_CUE_TIMING] < PF_NOW || item[PF_CUE_TIMING] > PF_BAR || item[PF_CUE_CAPTURE] < PF_CONTINUOUS || item[PF_CUE_CAPTURE] > PF_WHOLE_BAR || item[PF_CUE_VARIANT] < -1 || item[PF_CUE_VARIANT] >= ST_VARIANTS || item[PF_CUE_HITS] < 0 || item[PF_CUE_HITS] > ST_HITS) return fail(engine, PF_INVALID_PROGRAM);
    int hits = int(item[PF_CUE_HITS]);
    if (item[PF_CUE_CAPTURE] == PF_SPARSE && (!hits || !std::isfinite(item[PF_CUE_RADIUS]) || item[PF_CUE_RADIUS] <= 0)) return fail(engine, PF_INVALID_PROGRAM);
    for (int hit = 0; hit < hits; ++hit) if (!std::isfinite(item[PF_CUE_POSITIONS + hit]) || item[PF_CUE_POSITIONS + hit] < 0 || (hit && item[PF_CUE_POSITIONS + hit] <= item[PF_CUE_POSITIONS + hit - 1])) return fail(engine, PF_INVALID_PROGRAM);
  }
  for (int index = 0; index < playback_count; ++index) {
    const double* item = playback + index * 3;
    if (!integer(item[0]) || item[0] < 1 || item[0] > bars || !numeric_channel(item[1]) || !integer(item[2]) || item[2] < 0 || item[2] >= ST_VARIANTS) return fail(engine, PF_INVALID_PROGRAM);
  }
  Song* song = new (std::nothrow) Song;
  if (!song) return fail(engine, PF_ALLOCATION_FAILED);
  song->bars = bars; song->end = end; song->length = length;
  song->cues = new (std::nothrow) Cue[(bars + 1) * 4];
  if (event_count) song->events = new (std::nothrow) ProgramEvent[event_count];
  if (playback_count) song->playback = new (std::nothrow) Playback[playback_count];
  if (!song->cues || (event_count && !song->events) || (playback_count && !song->playback)) { delete song; return fail(engine, PF_ALLOCATION_FAILED); }
  song->event_count = event_count; song->playback_count = playback_count;
  for (int index = 0; index < event_count; ++index) song->events[index] = {int(events[index * 3]), int(events[index * 3 + 1]), events[index * 3 + 2]};
  for (int index = 0; index < playback_count; ++index) song->playback[index] = {int(playback[index * 3]), int(playback[index * 3 + 1]), int(playback[index * 3 + 2])};
  for (int index = 0; index < cue_count; ++index) {
    const double* item = cues + index * PF_CUE_FIELDS;
    Cue& cue = song->cues[int(item[PF_CUE_BAR]) * 4 + int(item[PF_CUE_CHANNEL])];
    cue.kind = int(item[PF_CUE_KIND]); cue.timing = int(item[PF_CUE_TIMING]); cue.capture = int(item[PF_CUE_CAPTURE]); cue.variant = int(item[PF_CUE_VARIANT]); cue.hits = int(item[PF_CUE_HITS]); cue.radius = item[PF_CUE_RADIUS];
    std::copy(item + PF_CUE_POSITIONS, item + PF_CUE_POSITIONS + cue.hits, cue.positions);
  }
  delete engine->song; engine->song = song; engine->bpm = bpm; engine->end = end;
  engine->error_code = PF_OK; engine->error = "";
  return 0;
}
int pf_start(pf_engine* engine, double bpm, int count, int start, int end, int loop, int automatic) {
  if (!engine) return -1;
  if (engine->phase == PF_PLAYING || engine->phase == PF_COUNT_IN) return fail(engine, PF_INVALID_START, "Stop before starting another run");
  if (!std::isfinite(bpm) || bpm < 40 || bpm > 240 || count < 0 || count > 4 || start < 1 || end < start || end > engine->song->bars || !flag(loop) || !flag(automatic)) return fail(engine, PF_INVALID_START);
  double snapshot[BT_S_COUNT]; bt_snapshot(engine->tracker, snapshot);
  double sequence = engine->clock_sequence + 1;
  if (bt_command(engine->tracker, BT_SELECT_MANUAL, 0, snapshot[BT_S_FRAME], sequence, snapshot[BT_S_EPOCH]) != BT_OK) return fail(engine, PF_INVALID_START);
  engine->clock_sequence = sequence;
  if (bt_command(engine->tracker, BT_APPLY_BPM, bpm, snapshot[BT_S_FRAME], ++engine->clock_sequence, snapshot[BT_S_EPOCH]) != BT_OK) return fail(engine, PF_INVALID_START);
  engine->bpm = bpm; engine->start = start; engine->end = end; engine->loop = loop; engine->automatic = automatic;
  engine->event_head = engine->event_count = 0;
  engine->sequence = 0; engine->count_beats = count * 4; engine->count_elapsed = 0; engine->count_remaining = count * 4; engine->position = -1;
  engine->phase = count ? PF_COUNT_IN : PF_PLAYING; engine->bar = engine->beat = -1; engine->last_beat = engine->run_epoch = -1;
  engine->error_code = PF_OK; engine->error = ""; engine->trigger_count = 0;
  silence(engine);
  for (bool& suppressed : engine->suppressed) suppressed = false;
  emit(engine, PF_STATE);
  return 0;
}
void pf_stop(pf_engine* engine) {
  if (!engine) return;
  engine->phase = PF_IDLE; engine->count_remaining = 0;
  engine->error_code = PF_OK; engine->error = ""; silence(engine); emit(engine, PF_STATE);
}
int pf_select(pf_engine* engine, int id) {
  if (!engine || !channel(id)) return fail(engine, PF_INVALID_CHANNEL);
  engine->selected = id; engine->error_code = PF_OK; engine->error = ""; emit(engine, PF_STATE); return 0;
}
int pf_set_channel(pf_engine* engine, int id, double gain, int muted) {
  if (!engine || !channel(id)) return fail(engine, PF_INVALID_CHANNEL);
  if (sample_result(engine, st_set_channel(engine->sampler, id, gain, muted)) < 0) return -1;
  engine->error_code = PF_OK; engine->error = ""; emit(engine, PF_STATE); return 0;
}
int pf_set_automatic(pf_engine* engine, int automatic) {
  if (!engine || !flag(automatic)) return fail(engine, PF_INVALID_PROGRAM, "Automatic must be boolean");
  engine->automatic = automatic; engine->error_code = PF_OK; engine->error = ""; emit(engine, PF_STATE); return 0;
}
int pf_set_click(pf_engine* engine, int enabled) {
  if (!engine || !flag(enabled)) return fail(engine, PF_INVALID_PROGRAM, "Click must be boolean");
  if (engine->mode == PF_PRACTICE) engine->song_click = enabled; else engine->generic_click = enabled;
  if (!click_enabled(engine)) engine->click_start = -infinity;
  engine->error_code = PF_OK; engine->error = ""; emit(engine, PF_STATE); return 0;
}
int pf_set_click_gain(pf_engine* engine, double gain) {
  if (!engine || !std::isfinite(gain) || gain < 0 || gain > 1) return fail(engine, PF_INVALID_PROGRAM, "Invalid click gain");
  engine->click_gain = gain; return 0;
}
int pf_set_microphone(pf_engine* engine, int enabled) {
  if (!engine || !flag(enabled)) return fail(engine, PF_INVALID_PROGRAM, "Microphone state must be boolean");
  engine->microphone = enabled;
  if (!enabled) {
    for (int id = 0; id < ST_CHANNELS; ++id) sq_cancel_recording(engine->sequencer, id);
    for (int id = 0; id < PF_CHANNELS; ++id) { engine->pending[id].present = false; engine->resume[id] = -1; }
    st_stop_all_recordings(engine->sampler, 5);
  }
  engine->error_code = PF_OK; engine->error = ""; emit(engine, PF_STATE); return 0;
}
int pf_control(pf_engine* engine, int control, double value, const uint16_t* command_id, uint32_t command_length) {
  if (!engine) return -1;
  engine->error_code = PF_OK; engine->error = "";
  if ((!command_id && command_length) || (command_id && (!command_length || command_length > 200))) {
    fail(engine, PF_INVALID_COMMAND_ID); emit(engine, PF_CONTROL, -1, 0, control, value); return -1;
  }
  if (command_id) {
    bool nonspace = false;
    for (uint32_t index = 0; index < command_length; ++index) if (!whitespace(command_id[index])) nonspace = true;
    if (!nonspace) { fail(engine, PF_INVALID_COMMAND_ID); emit(engine, PF_CONTROL, -1, 0, control, value); return -1; }
    for (const Dedup& item : engine->dedup) if (item.present && item.length == command_length && std::memcmp(item.id, command_id, command_length * sizeof(uint16_t)) == 0) {
      if (item.control != control || (control == 5 && item.value != value)) { fail(engine, PF_COMMAND_CONFLICT); emit(engine, PF_CONTROL, -1, 0, control, value); return -1; }
      emit(engine, PF_CONTROL, -1, 1, control, value); return 0;
    }
  }
  int result = 0;
  if (channel(control)) result = press(engine, control);
  else if (control == 4) { engine->phase = PF_IDLE; engine->count_remaining = 0; silence(engine); }
  else if (control == 5) {
    if (!std::isfinite(value) || value < 0 || value > 1) result = fail(engine, PF_INVALID_KNOB);
    else {
      double info[ST_CHANNEL_FIELDS]; st_channel_info(engine->sampler, engine->selected, info);
      result = sample_result(engine, st_set_channel(engine->sampler, engine->selected, value, int(info[ST_CHANNEL_MUTED])));
    }
  } else result = fail(engine, PF_INVALID_CHANNEL);
  if (result >= 0 && command_id) {
    Dedup& item = engine->dedup[engine->dedup_cursor++ % dedup_capacity];
    item.present = true; std::memcpy(item.id, command_id, command_length * sizeof(uint16_t)); item.length = command_length; item.control = control; item.value = value;
  }
  emit(engine, PF_CONTROL, -1, result >= 0, control, value);
  return result;
}
int pf_on_beat(pf_engine* engine, double id, double when, double epoch) {
  if (!engine || !integer(id) || id < 0 || !frame(when) || !integer(epoch) || epoch < 0) return fail(engine, PF_ACTION_FAILED, "Invalid clock crossing");
  engine->clock_beat = id; engine->clock_frame = when; engine->trigger_count = 0;
  engine->error_code = PF_OK; engine->error = "";
  bool running = engine->mode == PF_PRACTICE && (engine->phase == PF_PLAYING || engine->phase == PF_COUNT_IN);
  bool stopped = false, downbeat = false;
  if (running) {
    if (engine->last_beat >= 0 && epoch != engine->run_epoch) { fail(engine, PF_CLOCK_RESTARTED); stopped = true; }
    else if (engine->last_beat >= 0 && id <= engine->last_beat) return 0;
    else if (engine->last_beat >= 0 && id != engine->last_beat + 1) { fail(engine, PF_MISSED_BEAT); stopped = true; }
    if (stopped) { engine->phase = PF_IDLE; engine->count_remaining = 0; }
    else {
      engine->last_beat = id; engine->run_epoch = epoch;
      if (engine->phase == PF_COUNT_IN && engine->count_elapsed < engine->count_beats) {
        engine->bar = -1; engine->beat = engine->count_elapsed % 4 + 1;
        engine->count_remaining = engine->count_beats - engine->count_elapsed++; downbeat = engine->beat == 1;
      } else {
        engine->phase = PF_PLAYING; engine->count_remaining = 0; ++engine->position;
        if (engine->position == (engine->end - engine->start + 1) * 4) {
          if (engine->loop) engine->position = 0; else { engine->phase = PF_ENDED; stopped = true; }
        }
        if (!stopped) {
          engine->bar = engine->start + engine->position / 4; engine->beat = engine->position % 4 + 1; downbeat = engine->beat == 1;
          int absolute = ((engine->bar - 1) * 4 + engine->beat - 1) % engine->song->length;
          if (engine->automatic) for (int index = 0; index < engine->song->event_count; ++index) if (engine->song->events[index].beat == absolute) engine->triggers[engine->trigger_count++] = engine->song->events[index];
        }
      }
    }
  }
  if (running && !stopped && downbeat) {
    for (int channel = 0; channel < PF_CHANNELS; ++channel) { engine->tap_position[channel] = 0; engine->used[channel] = false; }
    if (engine->position == 0 || engine->count_elapsed == 1) sq_mark_one(engine->sequencer);
  }
  if (sequence_result(engine, sq_on_beat(engine->sequencer, id, when, epoch)) < 0) stopped = true;
  if (running && !stopped) {
    for (int channel = 0; channel < PF_CHANNELS; ++channel) {
      if (engine->resume[channel] >= 0 && id >= engine->resume[channel]) {
        engine->resume[channel] = -1;
        if (sample_result(engine, st_trigger(engine->sampler, channel, std::ceil(when), 1, ST_LOOP, -1, -1)) < 0) stopped = true;
      }
    }
    for (int channel = 0; channel < PF_CHANNELS; ++channel) {
      Pending& pending = engine->pending[channel];
      if (!pending.present || id < pending.target) continue;
      pending.present = false;
      if (execute(engine, channel, pending.cue, when) < 0) stopped = true;
    }
    if (downbeat) for (int index = 0; index < engine->song->playback_count; ++index) {
      const Playback& cue = engine->song->playback[index];
      if (cue.bar != engine->bar || engine->suppressed[cue.channel] || recording(engine, cue.channel) || !st_has(engine->sampler, cue.channel, cue.variant) || !st_is_looping(engine->sampler, cue.channel)) continue;
      if (sample_result(engine, st_trigger(engine->sampler, cue.channel, std::ceil(when), 1, ST_LOOP, -1, cue.variant)) < 0) stopped = true;
    }
    for (int index = 0; index < engine->trigger_count; ++index) {
      const ProgramEvent& trigger = engine->triggers[index];
      double arm[SQ_RECORD_FIELDS]; sq_record_info(engine->sequencer, trigger.channel, arm);
      if (st_has(engine->sampler, trigger.channel, -1) && !st_is_looping(engine->sampler, trigger.channel) && !engine->suppressed[trigger.channel] && !recording(engine, trigger.channel) && !(arm[SQ_RECORD_PRESENT] && arm[SQ_RECORD_ACTION] == SQ_START)) {
        if (sample_result(engine, st_trigger(engine->sampler, trigger.channel, when, trigger.gain, 0, -1, -1)) < 0) stopped = true;
      }
    }
  }
  if (stopped) { if (engine->phase != PF_ENDED) engine->phase = PF_IDLE; silence(engine); }
  if (click_enabled(engine)) {
    engine->click_start = when;
    engine->click_accent = engine->mode == PF_PRACTICE ? downbeat : std::fmod(id - engine->click_origin - 1, 4) == 0;
  } else engine->click_start = -infinity;
  if (running) emit(engine, engine->error_code ? PF_FAULT : PF_BEAT, when);
  return stopped && engine->error_code ? -1 : running ? 1 : 0;
}
void pf_flush(pf_engine* engine) {
  if (!engine) return;
  double state[BT_S_COUNT]; bt_snapshot(engine->tracker, state);
  if (engine->epoch != state[BT_S_EPOCH]) reset_epoch(engine, state[BT_S_EPOCH], state[BT_S_BEAT_ID]);
  double events[64 * BT_E_COUNT];
  unsigned count;
  do {
    count = bt_drain_events(engine->tracker, events, 64);
    for (unsigned index = 0; index < count; ++index) {
      const double* event = events + index * BT_E_COUNT;
      if (event[BT_E_TYPE] == BT_CLOCK && event[BT_E_EPOCH] == engine->epoch) pf_on_beat(engine, event[BT_E_ID], event[BT_E_FRAME], event[BT_E_EPOCH]);
      queue_tracker(engine, event);
    }
  } while (count == 64);
}
int pf_process(pf_engine* engine, const float* input, float* left, float* right, uint32_t frames) {
  if (!engine || !frame(engine->processed) || engine->processed < 0 || engine->processed + frames > safe_frame) return fail(engine, PF_ACTION_FAILED, "Invalid audio block");
  pf_flush(engine);
  unsigned block = unsigned(std::max(1.0, std::min(1024.0, std::floor(engine->rate * 0.25))));
  for (unsigned offset = 0; offset < frames;) {
    unsigned length = std::min(block, frames - offset), cursor = 0;
    double start = engine->processed;
    bt_process(engine->tracker, input ? input + offset : nullptr, length);
    double events[64 * BT_E_COUNT]; unsigned count;
    do {
      count = bt_drain_events(engine->tracker, events, 64);
      for (unsigned index = 0; index < count; ++index) {
        const double* event = events + index * BT_E_COUNT;
        if (event[BT_E_TYPE] == BT_CLOCK && event[BT_E_EPOCH] == engine->epoch) {
          unsigned end = unsigned(std::max(double(cursor), std::min(double(length), std::ceil(event[BT_E_FRAME] - start))));
          render_segment(engine, input ? input + offset + cursor : nullptr, left ? left + offset + cursor : nullptr, right ? right + offset + cursor : nullptr, end - cursor, start + cursor);
          cursor = end;
          pf_on_beat(engine, event[BT_E_ID], event[BT_E_FRAME], event[BT_E_EPOCH]);
        }
        queue_tracker(engine, event);
      }
    } while (count == 64);
    render_segment(engine, input ? input + offset + cursor : nullptr, left ? left + offset + cursor : nullptr, right ? right + offset + cursor : nullptr, length - cursor, start + cursor);
    offset += length;
  }
  return 0;
}
void pf_snapshot(const pf_engine* engine, double* out) {
  if (!out) return;
  std::fill(out, out + PF_FIELDS, 0);
  if (!engine) return;
  out[PF_PHASE] = engine->phase; out[PF_BAR_NUMBER] = engine->bar; out[PF_BEAT_NUMBER] = engine->beat;
  out[PF_COUNT_IN_REMAINING] = engine->count_remaining; out[PF_BPM] = engine->bpm;
  out[PF_START_BAR] = engine->start; out[PF_END_BAR] = engine->end; out[PF_LOOP] = engine->loop;
  out[PF_AUTOMATIC] = engine->automatic; out[PF_CLICK] = engine->mode == PF_PRACTICE ? engine->song_click : engine->generic_click;
  out[PF_SELECTED_CHANNEL] = engine->selected; out[PF_SEQUENCE] = engine->sequence;
  out[PF_COUNT_IN_BEATS] = engine->count_beats; out[PF_COUNT_IN_ELAPSED] = engine->count_elapsed;
  out[PF_POSITION_BEAT] = engine->position; out[PF_LAST_BEAT_ID] = engine->last_beat; out[PF_EPOCH] = engine->run_epoch;
  out[PF_BAR_COUNT] = engine->song ? engine->song->bars : 1; out[PF_BEATS_PER_BAR] = engine->beats_per_bar; out[PF_PROGRAM_LENGTH] = engine->song ? engine->song->length : 4;
  out[PF_MICROPHONE] = engine->microphone; out[PF_FRAME] = engine->processed;
  out[PF_CLOCK_BEAT_ID] = engine->clock_beat; out[PF_CLOCK_BEAT_FRAME] = engine->clock_frame;
  out[PF_ERROR] = engine->error_code; out[PF_CLICK_ENABLED] = click_enabled(engine);
  out[PF_TRACKER_DROPS] = engine->telemetry_drops; out[PF_EVENT_DROPS] = engine->event_drops;
}
void pf_channel_info(const pf_engine* engine, int id, double* out) {
  if (!out) return;
  std::fill(out, out + PF_CHANNEL_FIELDS, 0);
  if (!engine || !channel(id)) return;
  double settings[ST_CHANNEL_FIELDS]; st_channel_info(engine->sampler, id, settings);
  bool active = st_is_looping(engine->sampler, id), ready = st_has(engine->sampler, id, -1), capture = recording(engine, id);
  const Pending& pending = engine->pending[id];
  int status = pending.present && pending.cue.kind == PF_ARM ? PF_ARMED
    : pending.present && (pending.cue.kind == PF_COMMIT || pending.cue.kind == PF_COMMIT_ARM) ? PF_STOPPING
    : capture ? PF_RECORDING : active ? PF_LOOPING : ready ? PF_READY : PF_EMPTY;
  int light = PF_OFF; double remaining = 0;
  if (active && pending.present && pending.cue.kind == PF_STOP) {
    remaining = std::max(0.0, ((pending.target - engine->clock_beat) * engine->rate * 60 / engine->bpm - (engine->processed - engine->clock_frame)) * 1000 / engine->rate);
    light = PF_RELEASING;
  } else if (active || pending.present || capture) light = PF_STEADY;
  else if (!engine->used[id] && current_cue(engine, id).kind != PF_NONE && current_cue(engine, id).kind != PF_UNSUPPORTED) light = PF_CUE;
  out[PF_CHANNEL_GAIN] = settings[ST_CHANNEL_GAIN]; out[PF_CHANNEL_MUTED] = settings[ST_CHANNEL_MUTED];
  out[PF_CHANNEL_LOOPING] = active; out[PF_CHANNEL_READY] = ready; out[PF_CHANNEL_STATUS] = status;
  out[PF_CHANNEL_LIGHT] = light; out[PF_CHANNEL_RELEASE_MS] = remaining;
  out[PF_CHANNEL_PENDING_KIND] = pending.present ? pending.cue.kind : PF_NONE;
}
uint32_t pf_drain_tracker_events(pf_engine* engine, double* out, uint32_t capacity) {
  if (!engine || !out) return 0;
  unsigned count = std::min(capacity, engine->telemetry_count);
  for (unsigned index = 0; index < count; ++index) std::copy(engine->telemetry[(engine->telemetry_head + index) % telemetry_capacity], engine->telemetry[(engine->telemetry_head + index) % telemetry_capacity] + BT_E_COUNT, out + index * BT_E_COUNT);
  engine->telemetry_head = (engine->telemetry_head + count) % telemetry_capacity; engine->telemetry_count -= count;
  return count;
}
uint32_t pf_drain_events(pf_engine* engine, double* out, uint32_t capacity) {
  if (!engine || !out) return 0;
  unsigned count = std::min(capacity, engine->event_count);
  for (unsigned index = 0; index < count; ++index) std::copy(engine->events[(engine->event_head + index) % PF_EVENT_CAPACITY], engine->events[(engine->event_head + index) % PF_EVENT_CAPACITY] + PF_EVENT_FIELDS, out + index * PF_EVENT_FIELDS);
  engine->event_head = (engine->event_head + count) % PF_EVENT_CAPACITY; engine->event_count -= count;
  return count;
}
int pf_trigger_count(const pf_engine* engine) { return engine ? engine->trigger_count : 0; }
void pf_trigger_info(const pf_engine* engine, int index, double* out) {
  if (!out) return;
  std::fill(out, out + 3, 0);
  if (!engine || index < 0 || index >= engine->trigger_count) return;
  const ProgramEvent& event = engine->triggers[index]; out[0] = event.beat; out[1] = event.channel; out[2] = event.gain;
}
}
