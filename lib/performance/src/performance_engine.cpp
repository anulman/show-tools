#include "performance_engine.h"
#include "patch_engine.h"
#include "compiled_program.h"
#include "tuner.h"
#include <cstddef>
#include <limits>
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
static_assert(PF_EVENT_CUE == PF_EVENT_CHANNELS + PF_CHANNELS * PF_CHANNEL_FIELDS);
static_assert(PF_EVENT_FIELDS == PF_EVENT_CUE + 1);
static_assert(PF_CUE_FIELDS == PF_CUE_POSITIONS + ST_HITS);
static_assert(sizeof(double) == 8 && std::numeric_limits<double>::is_iec559);
static_assert(sizeof(pf_effect_definition) == PF_EFFECT_BYTES);
static_assert(offsetof(pf_effect_definition, type) == PF_EFFECT_TYPE_OFFSET);
static_assert(offsetof(pf_effect_definition, version) == PF_EFFECT_VERSION_OFFSET);
static_assert(offsetof(pf_effect_definition, parameters) + offsetof(pf_slapback_parameters, delay_ms) == PF_EFFECT_DELAY_OFFSET);
static_assert(offsetof(pf_effect_definition, parameters) + offsetof(pf_slapback_parameters, feedback) == PF_EFFECT_FEEDBACK_OFFSET);
static_assert(offsetof(pf_effect_definition, parameters) + offsetof(pf_slapback_parameters, wet) == PF_EFFECT_WET_OFFSET);
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

struct EffectProfile {
  std::unique_ptr<patches::Rack> rack;
  pf_effect_definition definitions[PF_MAX_LIVE_EFFECTS]{};
  uint32_t count = 0, revision = 0;
};
struct pf_engine {
  std::unique_ptr<tuner::Engine> tuning;
  bt_tracker* tracker = nullptr;
  st_engine* sampler = nullptr;
  sq_engine* sequencer = nullptr;
  Song* song = nullptr;
  std::unique_ptr<compiled::Program> compiled;
  EffectProfile profiles[PF_VOICE_PROFILES];
  double tempo_info[PF_TEMPO_FIELDS]{};
  double tempo_epoch = -1;
  bool live_authorized = false, cue_button_held = false;
  double light_run = 0, light_sequence = 0;
  int jiggle_travel = 4, jiggle_reversal = 2;
  double light_image[PF_LIGHT_FIELDS]{};
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
bool running(const pf_engine* engine) { return engine->phase == PF_COUNT_IN || engine->phase == PF_PLAYING; }
bool live_active(const pf_engine* engine) { return engine->mode == PF_PRACTICE && engine->live_authorized && engine->microphone && engine->profiles[PF_DEFAULT_PROFILE].rack && running(engine); }
void clear_live(pf_engine* engine) {
  engine->live_authorized = false;
  for (auto& profile : engine->profiles) if (profile.rack) profile.rack->reset();
}
bool valid_effect(const pf_effect_definition& effect) {
  if (effect.version != 1) return false;
  if (effect.type == PF_EFFECT_SLAPBACK) {
    const auto& p = effect.parameters.slapback;
    return std::isfinite(p.delay_ms) && p.delay_ms >= 40 && p.delay_ms <= 250 && std::isfinite(p.feedback) && p.feedback >= 0 && p.feedback <= .7 && std::isfinite(p.wet) && p.wet >= 0 && p.wet <= 1;
  }
  if (effect.type == PF_EFFECT_CHORUS) {
    const auto& p = effect.parameters.chorus;
    return std::isfinite(p.rate_hz) && p.rate_hz >= .05 && p.rate_hz <= 5 && std::isfinite(p.depth_ms) && p.depth_ms >= 0 && p.depth_ms <= 9 && std::isfinite(p.base_delay_ms) && p.base_delay_ms >= 10 && p.base_delay_ms <= 40 && std::isfinite(p.wet) && p.wet >= 0 && p.wet <= 1;
  }
  return false;
}
bool same_effect(const pf_effect_definition& left, const pf_effect_definition& right) {
  if (left.type != right.type || left.version != right.version) return false;
  if (left.type == PF_EFFECT_CHORUS) {
    const auto& a = left.parameters.chorus; const auto& b = right.parameters.chorus;
    return a.rate_hz == b.rate_hz && a.depth_ms == b.depth_ms && a.base_delay_ms == b.base_delay_ms && a.wet == b.wet;
  }
  const auto& a = left.parameters.slapback; const auto& b = right.parameters.slapback;
  return a.delay_ms == b.delay_ms && a.feedback == b.feedback && a.wet == b.wet;
}
std::unique_ptr<patches::Rack> prepare_rack(double rate, const pf_effect_definition* effects, uint32_t count) {
  std::unique_ptr<patches::Effect> stages[PF_MAX_LIVE_EFFECTS];
  for (uint32_t index = 0; index < count; ++index) {
    if (effects[index].type == PF_EFFECT_SLAPBACK) {
      const auto& p = effects[index].parameters.slapback;
      stages[index] = patches::make_slapback(rate, {p.delay_ms, p.feedback, p.wet});
    } else {
      const auto& p = effects[index].parameters.chorus;
      stages[index] = patches::make_chorus(rate, {p.rate_hz, p.depth_ms, p.base_delay_ms, p.wet});
    }
    if (!stages[index]) return nullptr;
  }
  return patches::Rack::create(stages, count);
}
bool disjoint_audio(const float* const* spans, unsigned count, uint32_t frames) {
  const uint64_t bytes = uint64_t(frames) * sizeof(float);
  for (unsigned left = 0; left < count; ++left) {
    if (!spans[left]) continue;
    uintptr_t begin = reinterpret_cast<uintptr_t>(spans[left]);
    if (bytes > std::numeric_limits<uintptr_t>::max() - begin) return false;
    for (unsigned right = 0; right < left; ++right) {
      if (!spans[right]) continue;
      uintptr_t other = reinterpret_cast<uintptr_t>(spans[right]);
      if (bytes && begin < other + bytes && other < begin + bytes) return false;
    }
  }
  return true;
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
void emit(pf_engine* engine, int type, double when = -1, int applied = -1, int control = -1, double value = 0, int cue = -1) {
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
  event[PF_EVENT_VALUE] = value; event[PF_EVENT_CUE] = cue;
  pf_snapshot(engine, event + PF_EVENT_STATE);
  for (int id = 0; id < PF_CHANNELS; ++id) pf_channel_info(engine, id, event + PF_EVENT_CHANNELS + id * PF_CHANNEL_FIELDS);
}
void silence(pf_engine* engine, int reason = 3) {
  if (engine->tuning) engine->tuning->close();
  engine->cue_button_held = false;
  if (engine->compiled) engine->compiled->stop();
  clear_live(engine);
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
  if (engine->profiles[PF_DEFAULT_PROFILE].count && (cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM)) return fail(engine, PF_CAPTURE_EFFECTS_UNAVAILABLE);
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
int tempo_hit(pf_engine* engine, int hint, int source) {
  if (engine->mode != PF_PRACTICE || !running(engine)) return PF_TEMPO_REJECTED;
  if (engine->tempo_info[PF_TEMPO_COUNT] && engine->tempo_epoch == engine->epoch && engine->tempo_info[PF_TEMPO_FRAME] == engine->processed) return PF_OK;
  int estimated = 0;
  if (bt_tempo_hit(engine->tracker, engine->processed, &estimated) != BT_OK) return PF_TEMPO_REJECTED;
  double clock[BT_S_COUNT]; bt_snapshot(engine->tracker, clock);
  double bpm = clock[BT_S_BPM];
  if (engine->compiled) engine->compiled->tempo_changed(engine->processed, engine->bpm, bpm);
  engine->bpm = bpm;
  ++engine->tempo_info[PF_TEMPO_COUNT]; engine->tempo_info[PF_TEMPO_FRAME] = engine->processed;
  engine->tempo_info[PF_TEMPO_HINT] = hint; engine->tempo_info[PF_TEMPO_SOURCE] = source;
  engine->tempo_info[PF_TEMPO_ESTIMATED] = estimated; engine->tempo_info[PF_TEMPO_BPM] = bpm;
  engine->tempo_epoch = engine->epoch;
  emit(engine, PF_TEMPO_HIT, engine->processed, estimated, source, hint);
  return PF_OK;
}
int chart_tempo_hit(void* context, int hint) { return tempo_hit(static_cast<pf_engine*>(context), hint, 1); }
int press(pf_engine* engine, int id) {
  if (engine->compiled) {
    int result = engine->compiled->press(id, engine->processed, engine->bpm, engine->microphone);
    if (result != PF_OK) return fail(engine, result);
    engine->selected = id;
    return 0;
  }
  engine->selected = id;
  const Cue& cue = current_cue(engine, id);
  if (engine->profiles[PF_DEFAULT_PROFILE].count && (cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM)) return fail(engine, PF_CAPTURE_EFFECTS_UNAVAILABLE);
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
void render_segment(pf_engine* engine, const float* input, float* left, float* right, float* live_left, float* live_right, unsigned count, double start) {
  if (!count) return;
  if (engine->compiled && engine->profiles[PF_DEFAULT_PROFILE].rack) {
    engine->compiled->render(input, left, right, live_left, live_right, count, start, engine->bpm, live_active(engine), *engine->profiles[PF_DEFAULT_PROFILE].rack, *engine->profiles[PF_BACKUP_PROFILE].rack);
    if (engine->compiled->error() != PF_OK) {
      int error = engine->compiled->error(); engine->compiled->clear_error();
      if (error != PF_LOOP_MISMATCH) { engine->phase = PF_IDLE; engine->count_remaining = 0; clear_live(engine); }
      fail(engine, error); emit(engine, PF_FAULT, start + count);
    }
  }
  else if (live_active(engine)) for (unsigned index = 0; index < count; ++index) {
    float value = input && std::isfinite(input[index]) ? input[index] : 0;
    patches::Stereo output = engine->profiles[PF_DEFAULT_PROFILE].rack->process({value, value});
    if (live_left) live_left[index] += output.left;
    if (live_right) live_right[index] += output.right;
  }
  if (engine->mode != PF_TRACKER && !engine->compiled) {
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
    case PF_INVALID_KNOB: return "Rotation must be a finite signed relative value";
    case PF_INVALID_CHANNEL: return "Unknown channel";
    case PF_INVALID_START: return "Invalid practice start options";
    case PF_ALLOCATION_FAILED: return "Could not allocate performance program";
    case PF_INVALID_PROGRAM: return "Invalid performance program";
    case PF_INVALID_EFFECTS: return "Invalid live effects configuration";
    case PF_CAPTURE_EFFECTS_UNAVAILABLE: return "Sample capture with effects is not available in this build. Bypass effects to record samples.";
    case PF_CAPTURE_BUSY: return "Another capture is armed or recording. Finish it before arming this voice.";
    case PF_TAKE_UNAVAILABLE: return "No reusable take bank is available. Wait for playback tails, or stop and prepare effects before recapturing after a venue edit.";
    case PF_CUE_AMBIGUOUS: return "Two cues are equally near this press; no action was applied.";
    case PF_LOOP_MISMATCH: return "The captured period or phase does not match its declared phrase; the previous take is preserved.";
    case PF_TEMPO_REJECTED: return "Tempo hits require active practice and a valid tap interval; playback was not changed.";
    case PF_CUE_LATE: return "The cue's execution boundary has already passed.";
    default: return "Unknown performance error";
  }
}
uint32_t pf_abi_version(void) { return PF_ABI_VERSION; }
pf_engine* pf_create(double rate, int mode, int voices, double seconds, int beats_per_bar) {
  if (!std::isfinite(rate) || rate < ST_MIN_SAMPLE_RATE || rate > ST_MAX_SAMPLE_RATE || mode < PF_TRACKER || mode > PF_PRACTICE) return nullptr;
  if (beats_per_bar < 1 || (mode == PF_PRACTICE && beats_per_bar != 4 && beats_per_bar != 6)) return nullptr;
  pf_engine* engine = new (std::nothrow) pf_engine;
  if (!engine) return nullptr;
  engine->rate = rate; engine->mode = mode; engine->beats_per_bar = beats_per_bar; engine->max_seconds = seconds;
  engine->tuning.reset(new (std::nothrow) tuner::Engine(rate));
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
  if (!engine->tuning || !engine->tracker || !engine->sampler || !engine->sequencer || !engine->song || !engine->song->cues || !engine->clicks[0] || !engine->clicks[1]) { pf_destroy(engine); return nullptr; }
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
  engine->compiled.reset();
  delete engine->song; engine->song = song; engine->bpm = bpm; engine->end = end; engine->beats_per_bar = beats;
  engine->error_code = PF_OK; engine->error = "";
  return 0;
}
int pf_configure_compiled(pf_engine* engine, const double* data, uint32_t fields) {
  if (!engine || engine->mode != PF_PRACTICE || running(engine)) return fail(engine, PF_INVALID_PROGRAM, "Stop before loading a compiled song");
  auto identity = engine->profiles[PF_DEFAULT_PROFILE].rack ? nullptr : patches::Rack::create(nullptr, 0);
  const patches::Rack* definition = engine->profiles[PF_DEFAULT_PROFILE].rack ? engine->profiles[PF_DEFAULT_PROFILE].rack.get() : identity.get();
  if (!definition) return fail(engine, PF_ALLOCATION_FAILED);
  const patches::Rack* definitions[PF_CHANNELS]; uint32_t revisions[PF_CHANNELS];
  for (int voice = 0; voice < PF_CHANNELS; ++voice) {
    definitions[voice] = engine->profiles[voice].rack ? engine->profiles[voice].rack.get() : definition;
    revisions[voice] = engine->profiles[voice].rack ? engine->profiles[voice].revision : engine->profiles[PF_DEFAULT_PROFILE].revision;
  }
  auto prepared = compiled::Program::create(data, fields, engine->rate, definitions, revisions);
  auto backup = engine->profiles[PF_BACKUP_PROFILE].rack ? nullptr : patches::Rack::create(nullptr, 0);
  if (!engine->profiles[PF_BACKUP_PROFILE].rack && !backup) return fail(engine, PF_ALLOCATION_FAILED);
  if (!prepared) return fail(engine, PF_INVALID_PROGRAM, "Invalid compiled song or insufficient prepared resources");
  auto song = std::unique_ptr<Song>(new (std::nothrow) Song);
  if (!song) return fail(engine, PF_ALLOCATION_FAILED);
  song->bars = prepared->bars(); song->end = prepared->end_bar(); song->length = prepared->beats_per_bar();
  song->cues = new (std::nothrow) Cue[(song->bars + 1) * PF_CHANNELS];
  if (!song->cues) return fail(engine, PF_ALLOCATION_FAILED);
  silence(engine);
  if (identity) engine->profiles[PF_DEFAULT_PROFILE].rack = std::move(identity);
  if (backup) engine->profiles[PF_BACKUP_PROFILE].rack = std::move(backup);
  prepared->tempo_handler(engine, chart_tempo_hit);
  prepared->jiggle_thresholds(engine->jiggle_travel, engine->jiggle_reversal);
  engine->beats_per_bar = prepared->beats_per_bar(); engine->bpm = prepared->initial_bpm(); engine->end = prepared->end_bar();
  delete engine->song; engine->song = song.release(); engine->compiled = std::move(prepared);
  engine->compiled->observe(engine, [](void* context, double when) {
    auto* owner = static_cast<pf_engine*>(context);
    owner->processed = std::max(owner->processed, when);
    emit(owner, PF_STATE, when);
  });
  engine->compiled->outcomes(engine, [](void* context, double when, int button, int cue, int error) {
    auto* owner = static_cast<pf_engine*>(context);
    int previous_code = owner->error_code; const char* previous_message = owner->error;
    fail(owner, error); emit(owner, PF_CONTROL, when, error == PF_OK, button, 0, cue);
    owner->error_code = previous_code; owner->error = previous_message;
  });
  engine->error_code = PF_OK; engine->error = ""; emit(engine, PF_STATE); return 0;
}
int pf_load_compiled_bytes(pf_engine* engine, const uint8_t* data, uint32_t bytes) {
  if (!data || bytes % 8 || bytes / 8 < PF_COMPILED_HEADER_FIELDS || bytes / 8 > 200000) return fail(engine, PF_INVALID_PROGRAM);
  auto values = std::unique_ptr<double[]>(new (std::nothrow) double[bytes / 8]);
  if (!values) return fail(engine, PF_ALLOCATION_FAILED);
  for (uint32_t index = 0; index < bytes / 8; ++index) {
    uint64_t bits = 0;
    for (unsigned byte = 0; byte < 8; ++byte) bits |= uint64_t(data[index * 8 + byte]) << (byte * 8);
    std::memcpy(values.get() + index, &bits, sizeof(double));
  }
  return pf_configure_compiled(engine, values.get(), bytes / 8);
}
int pf_set_bend_parameters(pf_engine* engine, double velocity_per_semitone, double stale_ms) {
  if (!engine || !engine->compiled || running(engine)) return fail(engine, PF_INVALID_PROGRAM);
  return engine->compiled->set_bend_parameters(velocity_per_semitone, stale_ms) ? 0 : fail(engine, PF_INVALID_KNOB);
}
int pf_prepare_external_sample(pf_engine* engine, uint32_t slot, const float* left, const float* right, uint32_t frames) {
  if (!engine || !engine->compiled || running(engine)) return fail(engine, PF_INVALID_PROGRAM);
  return engine->compiled->prepare_external_sample(slot, left, right, frames) ? 0 : fail(engine, PF_INVALID_PROGRAM, "External sample preparation rejected");
}
int pf_trigger_external(pf_engine* engine, uint32_t slot) {
  if (!engine || !engine->compiled) return fail(engine, PF_INVALID_PROGRAM);
  int result = engine->compiled->trigger_external(slot);
  return result == PF_OK ? 0 : fail(engine, result);
}
void pf_compiled_take_info(const pf_engine* engine, uint32_t take, double* out) {
  if (!out) return;
  if (engine && engine->compiled) engine->compiled->take_info(take, out);
  else { std::fill(out, out + PF_TAKE_FIELDS, 0); out[PF_TAKE_SOURCE_END] = out[PF_TAKE_SELECTION] = -1; }
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
  engine->tempo_epoch = -1;
  engine->bpm = bpm; engine->start = start; engine->end = end; engine->loop = loop; engine->automatic = automatic;
  engine->event_head = engine->event_count = 0;
  engine->sequence = 0; engine->count_beats = count * engine->beats_per_bar; engine->count_elapsed = 0; engine->count_remaining = count * engine->beats_per_bar; engine->position = -1;
  engine->phase = count ? PF_COUNT_IN : PF_PLAYING; engine->bar = engine->beat = -1; engine->last_beat = engine->run_epoch = -1;
  engine->error_code = PF_OK; engine->error = ""; engine->trigger_count = 0;
  silence(engine);
  ++engine->light_run;
  for (bool& suppressed : engine->suppressed) suppressed = false;
  engine->live_authorized = engine->mode == PF_PRACTICE && engine->microphone && bool(engine->profiles[PF_DEFAULT_PROFILE].rack);
  if (engine->compiled) engine->compiled->start(start, engine->count_beats, engine->processed, bpm);
  emit(engine, PF_STATE);
  return 0;
}
void pf_stop(pf_engine* engine) {
  if (!engine) return;
  engine->phase = PF_IDLE; engine->count_remaining = 0;
  engine->error_code = PF_OK; engine->error = ""; silence(engine); emit(engine, PF_STATE);
}
int pf_tuner_command_apply(pf_engine* engine, int command, uint32_t expected, int value, int scale) {
  if (!engine || !engine->tuning) return -1;
  if (engine->tuning->snapshot().commandRevision != expected) return fail(engine, PF_COMMAND_CONFLICT, "Tuner changed. Refresh its state and retry.");
  if (command != PF_TUNER_CLOSE && command != PF_TUNER_SILENCE && running(engine)) return fail(engine, PF_ACTION_FAILED, "Stop the performance before using the tuner.");
  bool applied = false;
  switch (command) {
    case PF_TUNER_CONFIGURE: applied = engine->tuning->configure(value, static_cast<tuner::Scale>(scale)); break;
    case PF_TUNER_CUE: applied = engine->tuning->cue(); break;
    case PF_TUNER_PLAY_SCALE: applied = engine->tuning->playScale(); break;
    case PF_TUNER_SILENCE: applied = engine->tuning->silence(); break;
    case PF_TUNER_CONFIRM: applied = engine->tuning->confirm(expected); break;
    case PF_TUNER_LISTEN:
      if (!flag(value) || (value && !engine->microphone)) return fail(engine, PF_MICROPHONE_REQUIRED);
      applied = engine->tuning->setListening(value != 0); break;
    case PF_TUNER_CLOSE: applied = engine->tuning->close(); break;
    default: return fail(engine, PF_INVALID_PROGRAM, "Unknown tuner command");
  }
  if (!applied) return fail(engine, PF_INVALID_PROGRAM, "Invalid tuner command or scale selection");
  engine->error_code = PF_OK; engine->error = "";
  return 0;
}
int pf_audio_needed(const pf_engine* engine) {
  if (!engine || !engine->tuning) return 0;
  const auto state = engine->tuning->snapshot();
  return running(engine) || state.listening || state.previewKind != tuner::PreviewKind::Silent;
}
void pf_tuner_info(const pf_engine* engine, double* out) {
  if (!out) return;
  std::fill(out, out + PF_TUNER_FIELDS, 0);
  if (!engine || !engine->tuning) return;
  const auto state = engine->tuning->snapshot();
  const auto& pitch = state.detector;
  out[PF_TUNER_REVISION] = state.commandRevision; out[PF_TUNER_ROOT] = state.rootMidi;
  out[PF_TUNER_SCALE] = int(state.scale); out[PF_TUNER_STEP] = state.step; out[PF_TUNER_COUNT] = state.targetCount;
  out[PF_TUNER_COMPLETE] = state.complete; out[PF_TUNER_LISTENING] = state.listening;
  out[PF_TUNER_PREVIEW_KIND] = int(state.previewKind); out[PF_TUNER_PREVIEW_STEP] = state.previewStep;
  out[PF_TUNER_PITCH_STATUS] = int(pitch.status); out[PF_TUNER_FREQUENCY] = pitch.frequency;
  out[PF_TUNER_MIDI] = pitch.midi; out[PF_TUNER_CENTS] = pitch.cents; out[PF_TUNER_CONFIDENCE] = pitch.confidence;
  out[PF_TUNER_RMS] = pitch.rms; out[PF_TUNER_ROUNDED_MIDI] = pitch.roundedMidi;
  out[PF_TUNER_LETTER] = pitch.note.letter; out[PF_TUNER_ACCIDENTAL] = pitch.note.accidental;
  out[PF_TUNER_OCTAVE] = pitch.note.octave; out[PF_TUNER_FRAME] = double(state.frameCount);
  for (unsigned i = 0; i < state.targetCount; ++i) {
    const auto& note = state.targets[i]; double* row = out + PF_TUNER_TARGETS + i * PF_TUNER_TARGET_FIELDS;
    row[PF_TUNER_TARGET_MIDI] = note.midi; row[PF_TUNER_TARGET_LETTER] = note.letter;
    row[PF_TUNER_TARGET_ACCIDENTAL] = note.accidental; row[PF_TUNER_TARGET_OCTAVE] = note.octave;
  }
}
int pf_select(pf_engine* engine, int id) {
  if (!engine || !channel(id)) return fail(engine, PF_INVALID_CHANNEL);
  engine->selected = id; engine->error_code = PF_OK; engine->error = ""; emit(engine, PF_STATE); return 0;
}
int pf_set_channel(pf_engine* engine, int id, double gain, int muted) {
  if (!engine || !channel(id)) return fail(engine, PF_INVALID_CHANNEL);
  if (sample_result(engine, st_set_channel(engine->sampler, id, gain, muted)) < 0) return -1;
  if (engine->compiled) engine->compiled->set_channel(id, gain, muted != 0);
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
    engine->tuning->close();
    if (engine->compiled) engine->compiled->microphone_lost();
    clear_live(engine);
    for (int id = 0; id < ST_CHANNELS; ++id) sq_cancel_recording(engine->sequencer, id);
    for (int id = 0; id < PF_CHANNELS; ++id) { engine->pending[id].present = false; engine->resume[id] = -1; }
    st_stop_all_recordings(engine->sampler, 5);
  }
  engine->error_code = PF_OK; engine->error = ""; emit(engine, PF_STATE); return 0;
}
int pf_prepare_voice_effects(pf_engine* engine, const pf_effect_definition* effects, const uint32_t* counts, const uint32_t* revisions) {
  if (!engine) return -1;
  if (engine->mode != PF_PRACTICE || running(engine) || engine->live_authorized || !counts || !revisions) return fail(engine, PF_INVALID_EFFECTS);
  for (int id = 0; id < ST_CHANNELS; ++id) {
    double queued[SQ_RECORD_FIELDS]; sq_record_info(engine->sequencer, id, queued);
    if (recording(engine, id) || queued[SQ_RECORD_PRESENT]) return fail(engine, PF_INVALID_EFFECTS, "Stop capture before preparing voice effects");
  }
  for (const Pending& pending : engine->pending) if (pending.present && (pending.cue.kind == PF_ARM || pending.cue.kind == PF_COMMIT_ARM)) return fail(engine, PF_INVALID_EFFECTS);
  uint32_t offsets[PF_VOICE_PROFILES]{}, total = 0; bool changed[PF_VOICE_PROFILES]{};
  for (int voice = 0; voice < PF_VOICE_PROFILES; ++voice) {
    const auto& old = engine->profiles[voice];
    if (counts[voice] > PF_MAX_LIVE_EFFECTS || !revisions[voice] || revisions[voice] < old.revision || (counts[voice] && !effects)) return fail(engine, PF_INVALID_EFFECTS);
    offsets[voice] = total;
    bool same = counts[voice] == old.count;
    for (uint32_t stage = 0; stage < counts[voice]; ++stage) {
      const auto& effect = effects[total + stage];
      if (!valid_effect(effect)) return fail(engine, PF_INVALID_EFFECTS);
      if (same && !same_effect(effect, old.definitions[stage])) same = false;
    }
    if (revisions[voice] == old.revision && !same) return fail(engine, PF_INVALID_EFFECTS);
    changed[voice] = !old.rack || revisions[voice] != old.revision;
    total += counts[voice];
  }
  std::unique_ptr<patches::Rack> racks[PF_VOICE_PROFILES];
  const patches::Rack* definitions[PF_CHANNELS];
  for (int voice = 0; voice < PF_VOICE_PROFILES; ++voice) {
    if (changed[voice]) {
      racks[voice] = prepare_rack(engine->rate, counts[voice] ? effects + offsets[voice] : nullptr, counts[voice]);
      if (!racks[voice]) return fail(engine, PF_ALLOCATION_FAILED);
    }
    if (voice < PF_CHANNELS) definitions[voice] = changed[voice] ? racks[voice].get() : engine->profiles[voice].rack.get();
  }
  if (engine->compiled && !engine->compiled->prepare_effects(definitions, revisions)) return fail(engine, PF_ALLOCATION_FAILED, "Could not prepare voice capture resources");
  for (int voice = 0; voice < PF_VOICE_PROFILES; ++voice) {
    auto& profile = engine->profiles[voice];
    if (racks[voice]) profile.rack = std::move(racks[voice]);
    profile.count = counts[voice]; profile.revision = revisions[voice];
    for (uint32_t stage = 0; stage < profile.count; ++stage) profile.definitions[stage] = effects[offsets[voice] + stage];
  }
  engine->error_code = PF_OK; engine->error = ""; emit(engine, PF_STATE); return 0;
}
int pf_prepare_live_effects(pf_engine* engine, const pf_effect_definition* effects, uint32_t count, uint32_t revision) {
  if (!engine || count > PF_MAX_LIVE_EFFECTS || (count && !effects)) return fail(engine, PF_INVALID_EFFECTS);
  pf_effect_definition all[PF_VOICE_PROFILES * PF_MAX_LIVE_EFFECTS]; uint32_t counts[PF_VOICE_PROFILES], revisions[PF_VOICE_PROFILES];
  for (int voice = 0; voice < PF_VOICE_PROFILES; ++voice) {
    counts[voice] = count; revisions[voice] = revision;
    for (uint32_t stage = 0; stage < count; ++stage) all[voice * count + stage] = effects[stage];
  }
  return pf_prepare_voice_effects(engine, all, counts, revisions);
}
void pf_voice_info(const pf_engine* engine, uint32_t profile, double* out) {
  if (!out) return;
  std::fill(out, out + PF_VOICE_FIELDS, 0);
  if (!engine || profile >= PF_VOICE_PROFILES) return;
  const auto& voice = engine->profiles[profile];
  out[PF_VOICE_PREPARED] = bool(voice.rack); out[PF_VOICE_REVISION] = voice.revision; out[PF_VOICE_STAGE_COUNT] = voice.count;
  if (live_active(engine)) out[PF_VOICE_ACTIVITY] = engine->compiled ? engine->compiled->profile_activity(profile) : profile == PF_DEFAULT_PROFILE ? PF_VOICE_LIVE : PF_VOICE_STANDBY;
  if (engine->compiled && profile == PF_BACKUP_PROFILE) {
    out[PF_VOICE_ROTATION_ELIGIBLE] = engine->compiled->rotation_eligible(); out[PF_VOICE_ROTATION_REMAINING] = engine->compiled->rotation_remaining();
  }
}
void pf_voice_effect_info(const pf_engine* engine, uint32_t profile, uint32_t stage, double* out) {
  if (!out) return;
  std::fill(out, out + PF_VOICE_EFFECT_FIELDS, 0);
  if (!engine || profile >= PF_VOICE_PROFILES || stage >= engine->profiles[profile].count) return;
  const auto& effect = engine->profiles[profile].definitions[stage];
  out[PF_VOICE_EFFECT_TYPE] = effect.type; out[PF_VOICE_EFFECT_VERSION] = effect.version;
  if (effect.type == PF_EFFECT_SLAPBACK) {
    const auto& p = effect.parameters.slapback;
    out[PF_VOICE_EFFECT_PARAMETER_0] = p.delay_ms; out[PF_VOICE_EFFECT_PARAMETER_1] = p.feedback; out[PF_VOICE_EFFECT_PARAMETER_2] = p.wet;
  } else {
    const auto& p = effect.parameters.chorus;
    out[PF_VOICE_EFFECT_PARAMETER_0] = p.rate_hz; out[PF_VOICE_EFFECT_PARAMETER_1] = p.depth_ms; out[PF_VOICE_EFFECT_PARAMETER_2] = p.base_delay_ms; out[PF_VOICE_EFFECT_PARAMETER_3] = p.wet;
  }
}
void pf_tempo_info(const pf_engine* engine, double* out) {
  if (!out) return;
  std::fill(out, out + PF_TEMPO_FIELDS, 0);
  if (engine) std::copy(engine->tempo_info, engine->tempo_info + PF_TEMPO_FIELDS, out);
}
void pf_live_info(const pf_engine* engine, double* out) {
  if (!out) return;
  std::fill(out, out + PF_LIVE_FIELDS, 0);
  if (!engine) return;
  out[PF_LIVE_PREPARED] = bool(engine->profiles[PF_DEFAULT_PROFILE].rack); out[PF_LIVE_ACTIVE] = live_active(engine);
  out[PF_LIVE_REVISION] = engine->profiles[PF_DEFAULT_PROFILE].revision; out[PF_LIVE_STAGE_COUNT] = engine->profiles[PF_DEFAULT_PROFILE].count;
  out[PF_LIVE_CAPTURE_SUPPORTED] = bool(engine->compiled) || engine->profiles[PF_DEFAULT_PROFILE].count == 0;
}
int pf_control(pf_engine* engine, int control, double value, const uint16_t* command_id, uint32_t command_length) {
  if (!engine) return -1;
  engine->error_code = PF_OK; engine->error = "";
  if ((!command_id && command_length) || (command_id && (!command_length || command_length > 200))) {
    fail(engine, PF_INVALID_COMMAND_ID); emit(engine, PF_CONTROL, (control == 5 || control == 7) ? engine->processed : -1, 0, control, value); return -1;
  }
  if (command_id) {
    bool nonspace = false;
    for (uint32_t index = 0; index < command_length; ++index) if (!whitespace(command_id[index])) nonspace = true;
    if (!nonspace) { fail(engine, PF_INVALID_COMMAND_ID); emit(engine, PF_CONTROL, (control == 5 || control == 7) ? engine->processed : -1, 0, control, value); return -1; }
    for (const Dedup& item : engine->dedup) if (item.present && item.length == command_length && std::memcmp(item.id, command_id, command_length * sizeof(uint16_t)) == 0) {
      if (item.control != control || ((control == 5 || control == 7) && item.value != value)) { fail(engine, PF_COMMAND_CONFLICT); emit(engine, PF_CONTROL, (control == 5 || control == 7) ? engine->processed : -1, 0, control, value); return -1; }
      emit(engine, PF_CONTROL, (control == 5 || control == 7) ? engine->processed : -1, 1, control, value); return 0;
    }
  }
  int result = 0;
  if (channel(control)) result = press(engine, control);
  else if (control == 4) { engine->phase = PF_IDLE; engine->count_remaining = 0; silence(engine); }
  else if (control == 5) {
    if (!std::isfinite(value)) result = fail(engine, PF_INVALID_KNOB);
    else if (engine->compiled && live_active(engine)) {
      int code = engine->compiled->rotate(value, engine->processed, engine->bpm);
      if (code != PF_OK) result = fail(engine, code);
    }
  } else if (control == 7) {
    if (value != 0 && value != 1) result = fail(engine, PF_INVALID_PROGRAM, "Cue button must be released or held");
    else {
      bool rising = value == 1 && !engine->cue_button_held;
      engine->cue_button_held = value == 1;
      if (value == 0 && engine->compiled) engine->compiled->release_current();
      if (rising && running(engine)) {
        if (engine->compiled) {
          int code = engine->compiled->press_current(engine->processed, engine->bpm, engine->microphone);
          if (code != PF_OK) result = fail(engine, code);
        } else {
          int first_error = PF_OK;
          for (int pass = 0; pass < 2; ++pass) for (int button = 0; button < PF_CHANNELS; ++button) {
            int kind = current_cue(engine, button).kind;
            if (kind == PF_NONE || ((kind == PF_COMMIT || kind == PF_COMMIT_ARM) != (pass == 0))) continue;
            int accepted = press(engine, button);
            emit(engine, PF_CONTROL, engine->processed, accepted >= 0, button, 0);
            if (accepted < 0 && first_error == PF_OK) first_error = engine->error_code;
          }
          if (first_error != PF_OK) result = fail(engine, first_error);
        }
      }
    }
  } else if (control >= 8 && control < 8 + PF_CHANNELS) { if (engine->compiled) engine->compiled->release(control - 8); } else if (control == 6) { int code = tempo_hit(engine, 0, 0); if (code != PF_OK) result = fail(engine, code); }
  else result = fail(engine, PF_INVALID_CHANNEL);
  if (result >= 0 && command_id) {
    Dedup& item = engine->dedup[engine->dedup_cursor++ % dedup_capacity];
    item.present = true; std::memcpy(item.id, command_id, command_length * sizeof(uint16_t)); item.length = command_length; item.control = control; item.value = value;
  }
  emit(engine, PF_CONTROL, (control == 5 || control == 7) ? engine->processed : -1, result >= 0, control, value);
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
        engine->bar = -1; engine->beat = engine->count_elapsed % engine->beats_per_bar + 1;
        engine->count_remaining = engine->count_beats - engine->count_elapsed++; downbeat = engine->beat == 1;
      } else {
        engine->phase = PF_PLAYING; engine->count_remaining = 0; ++engine->position;
        if (engine->position == (engine->end - engine->start + 1) * engine->beats_per_bar) {
          if (engine->loop) engine->position = 0; else { engine->phase = PF_ENDED; stopped = true; }
        }
        if (!stopped) {
          engine->bar = engine->start + engine->position / engine->beats_per_bar; engine->beat = engine->position % engine->beats_per_bar + 1; downbeat = engine->beat == 1;
          int absolute = ((engine->bar - 1) * engine->beats_per_bar + engine->beat - 1) % engine->song->length;
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
  if (engine->compiled && running && !stopped) {
    engine->compiled->beat(engine->phase, engine->bar, engine->beat, engine->count_remaining, when, engine->bpm);
    if (engine->compiled->error() != PF_OK) {
      int error = engine->compiled->error(); engine->compiled->clear_error();
      fail(engine, error); if (error != PF_LOOP_MISMATCH) stopped = true;
    }
  }
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
      if (execute(engine, channel, pending.cue, when) < 0 && engine->error_code != PF_CAPTURE_EFFECTS_UNAVAILABLE) stopped = true;
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
  if (running) emit(engine, engine->error_code && engine->error_code != PF_CAPTURE_EFFECTS_UNAVAILABLE ? PF_FAULT : PF_BEAT, when);
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
static int process_stems(pf_engine* engine, const float* input, float* left, float* right, float* live_left, float* live_right, uint32_t frames) {
  if (!engine || !frame(engine->processed) || engine->processed < 0 || engine->processed + frames > safe_frame) return fail(engine, PF_ACTION_FAILED, "Invalid audio block");
  pf_flush(engine);
  unsigned block = unsigned(std::max(1.0, std::min(1024.0, std::floor(engine->rate * 0.25))));
  for (unsigned offset = 0; offset < frames;) {
    unsigned length = std::min(block, frames - offset), cursor = 0;
    engine->tuning->process(input ? input + offset : nullptr, left ? left + offset : nullptr,
      right ? right + offset : nullptr, length, engine->microphone);
    double start = engine->processed;
    bt_process(engine->tracker, input ? input + offset : nullptr, length);
    double events[64 * BT_E_COUNT]; unsigned count;
    do {
      count = bt_drain_events(engine->tracker, events, 64);
      for (unsigned index = 0; index < count; ++index) {
        const double* event = events + index * BT_E_COUNT;
        if (event[BT_E_TYPE] == BT_CLOCK && event[BT_E_EPOCH] == engine->epoch) {
          unsigned end = unsigned(std::max(double(cursor), std::min(double(length), std::ceil(event[BT_E_FRAME] - start))));
          render_segment(engine, input ? input + offset + cursor : nullptr, left ? left + offset + cursor : nullptr, right ? right + offset + cursor : nullptr, live_left ? live_left + offset + cursor : nullptr, live_right ? live_right + offset + cursor : nullptr, end - cursor, start + cursor);
          cursor = end;
          pf_on_beat(engine, event[BT_E_ID], event[BT_E_FRAME], event[BT_E_EPOCH]);
        }
        queue_tracker(engine, event);
      }
    } while (count == 64);
    render_segment(engine, input ? input + offset + cursor : nullptr, left ? left + offset + cursor : nullptr, right ? right + offset + cursor : nullptr, live_left ? live_left + offset + cursor : nullptr, live_right ? live_right + offset + cursor : nullptr, length - cursor, start + cursor);
    offset += length;
  }
  return 0;
}
int pf_process(pf_engine* engine, const float* input, float* left, float* right, uint32_t frames) {
  return process_stems(engine, input, left, right, nullptr, nullptr, frames);
}
int pf_process_stems(pf_engine* engine, const float* input, float* left, float* right, float* live_left, float* live_right, uint32_t frames) {
  const float* spans[] = {input, left, right, live_left, live_right};
  if (!disjoint_audio(spans, 5, frames)) return -1;
  return process_stems(engine, input, left, right, live_left, live_right, frames);
}
int pf_set_jiggle_thresholds(pf_engine* engine, double travel, double reversal) {
  if (!engine) return -1;
  if (!integer(travel) || !integer(reversal) || travel < 1 || travel > 32767 || reversal < 1 || reversal > travel)
    return fail(engine, PF_INVALID_PROGRAM, "Jiggle thresholds require integer travel 1..32767 and reversal 1..travel");
  if (travel != engine->jiggle_travel || reversal != engine->jiggle_reversal) {
    if (running(engine)) return fail(engine, PF_INVALID_PROGRAM, "Stop transport before configuring jiggle thresholds");
    engine->jiggle_travel = int(travel); engine->jiggle_reversal = int(reversal);
    if (engine->compiled) engine->compiled->jiggle_thresholds(int(travel), int(reversal));
  }
  engine->error_code = PF_OK; engine->error = "";
  return 0;
}
void pf_light_output(pf_engine* engine, double* out) {
  if (!out) return;
  std::fill(out, out + PF_LIGHT_FIELDS, 0);
  if (!engine) return;
  if (engine->light_sequence == safe_frame) {
    std::copy(engine->light_image, engine->light_image + PF_LIGHT_FIELDS, out);
    out[PF_LIGHT_SEQUENCE] = safe_frame; return;
  }
  double clock[BT_S_COUNT]; bt_snapshot(engine->tracker, clock);
  double image[PF_LIGHT_FIELDS]{};
  image[PF_LIGHT_FORMAT] = PF_LIGHT_VERSION;
  image[PF_LIGHT_GENERATION] = engine->light_run + 1;
  image[PF_LIGHT_RUN] = engine->light_run;
  image[PF_LIGHT_EPOCH] = clock[BT_S_EPOCH];
  image[PF_LIGHT_TIMELINE] = clock[BT_S_REVISION];
  image[PF_LIGHT_FRAME] = clock[BT_S_FRAME];
  image[PF_LIGHT_RATE] = engine->rate;
  image[PF_LIGHT_COUNT_BEAT] = clock[BT_S_BEAT_ID] + clock[BT_S_PHASE];
  image[PF_LIGHT_RUNNING] = running(engine);
  image[PF_LIGHT_COUNT] = 1;
  image[PF_LIGHT_SAMPLES] = 1;
  double level = 0;
  bool capturing = engine->compiled && engine->compiled->recording(), playing = false;
  for (int id = 0; id < PF_CHANNELS; ++id) {
    double channel[PF_CHANNEL_FIELDS]; pf_channel_info(engine, id, channel);
    capturing = capturing || (!engine->compiled && recording(engine, id));
    playing = playing || channel[PF_CHANNEL_LOOPING] != 0;
  }
  if (!engine->compiled) for (int voice = 0; voice < ST_MAX_VOICES; ++voice) {
    double sample[ST_VOICE_FIELDS]; st_voice_info(engine->sampler, voice, sample);
    playing = playing || sample[ST_VOICE_CHANNEL] >= 0;
  }
  if (engine->cue_button_held) level = 1;
  else if (capturing || (engine->compiled && engine->compiled->cue_warning(engine->end))) {
    constexpr double tau = 6.2831853071795864769;
    level = .7 * (1 + std::cos(tau * clock[BT_S_PHASE])) / 2;
  } else if (playing) level = .7;
  image[PF_LIGHT_SAMPLES + PF_LIGHT_SAMPLE_LEVEL] = level;
  if (engine->light_sequence == 0 || std::memcmp(image, engine->light_image, sizeof(image))) {
    if (engine->light_sequence < safe_frame - 1) ++engine->light_sequence;
    else { engine->light_sequence = safe_frame; std::fill(image + PF_LIGHT_COUNT, image + PF_LIGHT_FIELDS, 0); }
    std::copy(image, image + PF_LIGHT_FIELDS, engine->light_image);
  }
  std::copy(engine->light_image, engine->light_image + PF_LIGHT_FIELDS, out);
  out[PF_LIGHT_SEQUENCE] = engine->light_sequence;
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
  if (engine->compiled) {
    const auto info = engine->compiled->channel_info(id, engine->bpm);
    out[PF_CHANNEL_GAIN] = info.gain; out[PF_CHANNEL_MUTED] = info.muted;
    out[PF_CHANNEL_LOOPING] = info.looping; out[PF_CHANNEL_READY] = info.ready; out[PF_CHANNEL_STATUS] = info.status;
    out[PF_CHANNEL_LIGHT] = info.light; out[PF_CHANNEL_RELEASE_MS] = info.release_ms; out[PF_CHANNEL_PENDING_KIND] = info.pending;
    return;
  }
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
