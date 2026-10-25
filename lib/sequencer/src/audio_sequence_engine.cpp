#include "audio_sequence_engine.h"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <new>

namespace {
constexpr double kSafe = 9007199254740991.0;
struct Event { double at = 0; int channel = 0; double gain = 1; };
struct Pattern {
  Pattern* next = nullptr;
  unsigned refs = 0;
  int id = 0, count = 0;
  double length = 0, version = 0;
  Event* events = nullptr;
};
struct Arm { bool present = false; int action = SQ_START, quantize = SQ_BAR; double target = 0, order = 0; bool loop = true; };
struct Cue { bool present = false; int action = SQ_PLAY, quantize = SQ_BAR; double target = 0, gain = 1, order = 0; };
bool channel_ok(int channel) { return channel >= 0 && channel < ST_CHANNELS; }
bool pattern_ok(int id) { return id >= 0 && id < SQ_PATTERNS; }
bool quantize_ok(int quantize) { return quantize == SQ_BEAT || quantize == SQ_BAR; }
bool integer(double value) { return std::isfinite(value) && std::floor(value) == value && std::abs(value) <= kSafe; }
bool frame_ok(double value) { return std::isfinite(value) && std::abs(value) <= kSafe; }
void replace(Pattern*& destination, Pattern* value) {
  if (value) ++value->refs;
  if (destination) --destination->refs;
  destination = value;
}
}

struct sq_engine {
  st_engine* sampler = nullptr;
  int beats_per_bar = 4;
  const char* error = "";
  Pattern* versions = nullptr;
  Pattern* patterns[SQ_PATTERNS]{};
  Pattern* active = nullptr;
  Pattern* pending = nullptr;
  double active_start = 0, position = 0, pending_target = 0;
  int pending_quantize = SQ_BAR;
  Arm arms[ST_CHANNELS];
  Cue cues[ST_CHANNELS];
  double epoch = -1, last_beat = 0, last_frame = -1, bar_origin = -1;
  bool mark_next = false;
  double launches = 0, played = 0, skipped = 0, order = 0, version = 0;
};

namespace {
int fail(sq_engine* engine, const char* message) { if (engine) engine->error = message; return -1; }
int sampler_result(sq_engine* engine, int result) {
  if (result < 0) return fail(engine, st_error(engine->sampler));
  return result;
}
bool recording(const sq_engine* engine, int channel) {
  double slot[ST_SLOT_FIELDS]; st_slot_info(engine->sampler, channel, 0, slot);
  return slot[ST_SLOT_RECORDING] != 0;
}
void collect(sq_engine* engine) {
  Pattern** current = &engine->versions;
  while (*current) {
    Pattern* pattern = *current;
    if (pattern->refs) { current = &pattern->next; continue; }
    *current = pattern->next;
    delete[] pattern->events;
    delete pattern;
  }
}
void reanchor(sq_engine* engine, double beat) {
  if (engine->pending && engine->pending_quantize == SQ_BAR) engine->pending_target = beat;
  for (auto& arm : engine->arms) if (arm.present && arm.quantize == SQ_BAR) arm.target = beat;
  for (auto& cue : engine->cues) if (cue.present && cue.quantize == SQ_BAR) cue.target = beat;
}
double target(const sq_engine* engine, int quantize) {
  return quantize == SQ_BAR ? sq_next_bar(engine) : engine->last_beat + 1;
}
int trigger(sq_engine* engine, int channel, double frame, double gain, int flags = 0) {
  return sampler_result(engine, st_trigger(engine->sampler, channel, frame, gain, flags, -1, -1));
}
}

extern "C" {
sq_engine* sq_create(st_engine* sampler, int beats_per_bar) {
  if (!sampler || beats_per_bar < 1 || beats_per_bar > 1024) return nullptr;
  sq_engine* engine = new (std::nothrow) sq_engine;
  if (engine) { engine->sampler = sampler; engine->beats_per_bar = beats_per_bar; }
  return engine;
}
void sq_destroy(sq_engine* engine) {
  if (!engine) return;
  Pattern* pattern = engine->versions;
  while (pattern) { Pattern* next = pattern->next; delete[] pattern->events; delete pattern; pattern = next; }
  delete engine;
}
const char* sq_error(const sq_engine* engine) { return engine ? engine->error : "Could not allocate sequencer"; }
int sq_define(sq_engine* engine, int id, double length, const double* events, int count) {
  if (!engine) return -1;
  if (!pattern_ok(id)) return fail(engine, "Pattern limit reached");
  if (!integer(length) || length < 1) return fail(engine, "lengthBeats must be a positive integer");
  if (count < 0 || count > SQ_EVENTS || (count && !events)) return fail(engine, "Invalid pattern events");
  for (int index = 0; index < count; ++index) {
    const double* event = events + index * 3;
    if (!integer(event[0]) || event[0] < 0 || event[0] >= length) return fail(engine, "Event atBeat must be a whole beat within the pattern");
    if (!integer(event[1]) || event[1] < 0 || event[1] >= ST_CHANNELS || !st_has(engine->sampler, int(event[1]), -1)) return fail(engine, "Unknown sample");
    if (!std::isfinite(event[2]) || event[2] < 0) return fail(engine, "Event gain must be finite and nonnegative");
  }
  collect(engine);
  Pattern* pattern = new (std::nothrow) Pattern;
  if (!pattern) return fail(engine, "Could not allocate pattern metadata");
  if (count) {
    pattern->events = new (std::nothrow) Event[size_t(count)];
    if (!pattern->events) { delete pattern; return fail(engine, "Could not allocate pattern events"); }
  }
  pattern->id = id; pattern->length = length; pattern->count = count; pattern->version = ++engine->version;
  for (int index = 0; index < count; ++index) pattern->events[index] = Event{events[index * 3], int(events[index * 3 + 1]), events[index * 3 + 2]};
  pattern->next = engine->versions; engine->versions = pattern;
  replace(engine->patterns[id], pattern);
  return 0;
}
double sq_next_bar(const sq_engine* engine) {
  if (!engine) return -1;
  const double next = engine->last_beat + 1;
  if (engine->mark_next || engine->bar_origin < 0) return next;
  return engine->bar_origin + std::ceil((next - engine->bar_origin) / engine->beats_per_bar) * engine->beats_per_bar;
}
int sq_queue(sq_engine* engine, int id, int quantize) {
  if (!engine) return -1;
  if (!pattern_ok(id) || !engine->patterns[id]) return fail(engine, "Unknown pattern");
  if (!quantize_ok(quantize)) return fail(engine, "Quantize must be beat or bar");
  const double next = target(engine, quantize);
  if (!integer(next)) return fail(engine, "Sequencer timeline limit reached");
  replace(engine->pending, engine->patterns[id]);
  engine->pending_target = next; engine->pending_quantize = quantize;
  return 0;
}
void sq_cancel_queue(sq_engine* engine) { if (engine) replace(engine->pending, nullptr); }
int sq_arm_recording(sq_engine* engine, int channel, int action, int quantize, double seconds, int loop) {
  if (!engine) return -1;
  if (!channel_ok(channel)) return fail(engine, "Invalid channel ID");
  if (action != SQ_START && action != SQ_STOP) return fail(engine, "Recording action must be start or stop");
  if (!quantize_ok(quantize)) return fail(engine, "Quantize must be beat or bar");
  if (loop != 0 && loop != 1) return fail(engine, "Loop must be boolean");
  const double next = target(engine, quantize);
  if (!integer(next)) return fail(engine, "Sequencer timeline limit reached");
  if (action == SQ_START) {
    if (recording(engine, channel)) return fail(engine, "Sample is already recording");
    if (sampler_result(engine, st_prepare(engine->sampler, channel, 0, seconds, -1, nullptr, 0, 0)) < 0) return -1;
  }
  Arm& arm = engine->arms[channel];
  const double order = arm.present ? arm.order : ++engine->order;
  arm = Arm{true, action, quantize, next, order, loop != 0};
  return 0;
}
void sq_cancel_recording(sq_engine* engine, int channel) { if (engine && channel_ok(channel)) engine->arms[channel].present = false; }
int sq_cue(sq_engine* engine, int channel, int action, int quantize, double gain) {
  if (!engine) return -1;
  if (!channel_ok(channel)) return fail(engine, "Invalid channel ID");
  if (action != SQ_PLAY && action != SQ_STOP) return fail(engine, "Cue action must be play or stop");
  if (!quantize_ok(quantize)) return fail(engine, "Quantize must be beat or bar");
  const double next = target(engine, quantize);
  if (!integer(next)) return fail(engine, "Sequencer timeline limit reached");
  if (action == SQ_PLAY) {
    if (!st_has(engine->sampler, channel, -1)) return fail(engine, "Unknown sample");
    if (!std::isfinite(gain) || gain < 0) return fail(engine, "Cue gain must be finite and nonnegative");
    const Arm& arm = engine->arms[channel];
    if (recording(engine, channel) && !(arm.present && arm.action == SQ_STOP && arm.target <= next)) return fail(engine, "Stop recording before cueing playback");
  }
  Cue& cue = engine->cues[channel];
  const double order = cue.present ? cue.order : ++engine->order;
  cue = Cue{true, action, quantize, next, gain, order};
  return 0;
}
void sq_cancel_cue(sq_engine* engine, int channel) { if (engine && channel_ok(channel)) engine->cues[channel].present = false; }
void sq_silence(sq_engine* engine, int channel) {
  if (!engine || !channel_ok(channel)) return;
  engine->cues[channel].present = false;
  Arm& arm = engine->arms[channel];
  if (arm.present && arm.action == SQ_STOP) arm.loop = false;
  st_stop_voices(engine->sampler, channel);
}
void sq_mark_one(sq_engine* engine) {
  if (!engine) return;
  engine->mark_next = true; reanchor(engine, engine->last_beat + 1);
}
void sq_stop(sq_engine* engine) {
  if (!engine) return;
  replace(engine->active, nullptr); replace(engine->pending, nullptr);
  for (auto& arm : engine->arms) arm.present = false;
  for (auto& cue : engine->cues) cue.present = false;
}
int sq_reset(sq_engine* engine, double beat) {
  if (!engine) return -1;
  if (!integer(beat) || beat < -1) return fail(engine, "Invalid sequencer beat ID");
  sq_stop(engine);
  engine->last_beat = beat; engine->last_frame = -1; engine->bar_origin = -1; engine->mark_next = false; engine->epoch = -1;
  return 0;
}
int sq_on_beat(sq_engine* engine, double id, double frame, double epoch) {
  if (!engine) return -1;
  if (!integer(id) || id < 0 || id > kSafe - engine->beats_per_bar || !frame_ok(frame) || !integer(epoch) || epoch < 0) return fail(engine, "Invalid sequencer clock crossing");
  if (engine->epoch >= 0 && epoch != engine->epoch) sq_reset(engine, id - 1);
  engine->epoch = epoch;
  if (id <= engine->last_beat) return 0;
  engine->last_beat = id; engine->last_frame = frame;
  if (engine->bar_origin < 0 || engine->mark_next) {
    engine->bar_origin = id; engine->mark_next = false; reanchor(engine, id);
  }
  for (int applied = 0; applied < ST_CHANNELS; ++applied) {
    int selected = -1;
    for (int channel = 0; channel < ST_CHANNELS; ++channel) {
      const Arm& arm = engine->arms[channel];
      if (arm.present && id >= arm.target && (selected < 0 || arm.order < engine->arms[selected].order)) selected = channel;
    }
    if (selected < 0) break;
    const Arm arm = engine->arms[selected]; engine->arms[selected].present = false;
    if (arm.action == SQ_START) {
      st_stop_voices(engine->sampler, selected);
      if (sampler_result(engine, st_start(engine->sampler, selected, frame, 0)) < 0) return -1;
    } else {
      const int committed = sampler_result(engine, st_stop(engine->sampler, selected, frame, 3));
      if (committed < 0) return -1;
      if (committed && arm.loop && trigger(engine, selected, std::ceil(frame), 1, ST_LOOP) < 0) return -1;
    }
  }
  for (int applied = 0; applied < ST_CHANNELS; ++applied) {
    int selected = -1;
    for (int channel = 0; channel < ST_CHANNELS; ++channel) {
      const Cue& cue = engine->cues[channel];
      if (cue.present && id >= cue.target && (selected < 0 || cue.order < engine->cues[selected].order)) selected = channel;
    }
    if (selected < 0) break;
    const Cue cue = engine->cues[selected]; engine->cues[selected].present = false;
    if (cue.action == SQ_STOP) sq_silence(engine, selected);
    else if (recording(engine, selected)) ++engine->skipped;
    else { if (trigger(engine, selected, frame, cue.gain) < 0) return -1; ++engine->played; }
  }
  if (engine->pending && id >= engine->pending_target) {
    replace(engine->active, engine->pending); replace(engine->pending, nullptr);
    engine->active_start = id; engine->position = 0; ++engine->launches;
  }
  if (!engine->active) return 0;
  const double position = id - engine->active_start;
  if (position >= engine->active->length) { replace(engine->active, nullptr); return 0; }
  engine->position = position;
  for (int index = 0; index < engine->active->count; ++index) {
    const Event& event = engine->active->events[index];
    if (event.at != position) continue;
    if (recording(engine, event.channel)) ++engine->skipped;
    else { if (trigger(engine, event.channel, frame, event.gain) < 0) return -1; ++engine->played; }
  }
  return 0;
}
void sq_snapshot(const sq_engine* engine, double* out) {
  if (!out) return;
  std::fill(out, out + SQ_FIELDS, 0);
  if (!engine) return;
  bool queued = engine->pending != nullptr;
  for (const auto& arm : engine->arms) queued = queued || arm.present;
  for (const auto& cue : engine->cues) queued = queued || cue.present;
  out[SQ_STATUS] = queued ? SQ_QUEUED : engine->active ? SQ_PLAYING : SQ_READY;
  out[SQ_ACTIVE_ID] = engine->active ? engine->active->id : -1;
  out[SQ_ACTIVE_LENGTH] = engine->active ? engine->active->length : 0;
  out[SQ_POSITION] = engine->active ? engine->position : 0;
  out[SQ_PENDING_ID] = engine->pending ? engine->pending->id : -1;
  out[SQ_PENDING_LENGTH] = engine->pending ? engine->pending->length : 0;
  out[SQ_PENDING_QUANTIZE] = engine->pending_quantize; out[SQ_PENDING_TARGET] = engine->pending ? engine->pending_target : -1;
  const double distance = engine->bar_origin < 0 ? 0 : engine->last_beat - engine->bar_origin;
  out[SQ_BAR_NUMBER] = std::floor(distance / engine->beats_per_bar) + 1;
  out[SQ_BEAT_NUMBER] = std::fmod(distance, engine->beats_per_bar) + 1;
  out[SQ_BEATS_PER_BAR] = engine->beats_per_bar;
  out[SQ_EPOCH] = engine->epoch; out[SQ_BEAT_ID] = engine->last_beat; out[SQ_FRAME] = engine->last_frame;
  out[SQ_BAR_ORIGIN] = engine->bar_origin; out[SQ_MARK_NEXT_ONE] = engine->mark_next;
  out[SQ_LAUNCHES] = engine->launches; out[SQ_PLAYED] = engine->played; out[SQ_SKIPPED] = engine->skipped;
  out[SQ_ACTIVE_VERSION] = engine->active ? engine->active->version : -1;
  out[SQ_PENDING_VERSION] = engine->pending ? engine->pending->version : -1;
}
void sq_pattern_info(const sq_engine* engine, int id, double* out) {
  if (!out) return;
  std::fill(out, out + SQ_PATTERN_FIELDS, 0);
  if (!engine || !pattern_ok(id) || !engine->patterns[id]) return;
  const Pattern& pattern = *engine->patterns[id];
  out[SQ_PATTERN_PRESENT] = 1; out[SQ_PATTERN_ID] = pattern.id; out[SQ_PATTERN_LENGTH] = pattern.length; out[SQ_PATTERN_EVENTS] = pattern.count;
  out[SQ_PATTERN_VERSION] = pattern.version;
}
void sq_record_info(const sq_engine* engine, int channel, double* out) {
  if (!out) return;
  std::fill(out, out + SQ_RECORD_FIELDS, 0);
  if (!engine || !channel_ok(channel)) return;
  const Arm& arm = engine->arms[channel];
  out[SQ_RECORD_PRESENT] = arm.present; out[SQ_RECORD_ACTION] = arm.action; out[SQ_RECORD_QUANTIZE] = arm.quantize;
  out[SQ_RECORD_TARGET] = arm.target; out[SQ_RECORD_LOOP] = arm.loop;
  out[SQ_RECORD_ORDER] = arm.order;
}
void sq_cue_info(const sq_engine* engine, int channel, double* out) {
  if (!out) return;
  std::fill(out, out + SQ_CUE_FIELDS, 0);
  if (!engine || !channel_ok(channel)) return;
  const Cue& cue = engine->cues[channel];
  out[SQ_CUE_PRESENT] = cue.present; out[SQ_CUE_ACTION] = cue.action; out[SQ_CUE_QUANTIZE] = cue.quantize;
  out[SQ_CUE_TARGET] = cue.target; out[SQ_CUE_GAIN] = cue.gain;
  out[SQ_CUE_ORDER] = cue.order;
}
}
