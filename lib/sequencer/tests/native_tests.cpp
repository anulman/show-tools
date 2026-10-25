#include "audio_sequence_engine.h"
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>

namespace {
void require(bool value) { if (!value) { std::fputs("Native sequencer assertion failed\n", stderr); std::abort(); } }
struct Runtime {
  st_engine* sampler = st_create(8, 32, 8, 30);
  sq_engine* sequence = sq_create(sampler, 4);
  Runtime() {
    require(sampler && sequence);
    const float kick[] = {1, 0.5f, 0}, snare[] = {0.25f, 0.25f, 0};
    require(st_load(sampler, 0, kick, nullptr, 3, 8) == 0);
    require(st_load(sampler, 1, snare, nullptr, 3, 8) == 0);
  }
  ~Runtime() { sq_destroy(sequence); st_destroy(sampler); }
  void ok(int result) { if (result < 0) { std::fprintf(stderr, "%s\n", sq_error(sequence)); std::abort(); } }
  std::array<double, SQ_FIELDS> state() { std::array<double, SQ_FIELDS> out{}; sq_snapshot(sequence, out.data()); return out; }
  double triggers() { double stats[ST_STATS_FIELDS]; st_stats(sampler, stats); return stats[ST_STATS_TRIGGERED]; }
};
void crossings_and_validation() {
  Runtime r;
  double events[] = {0, 0, 1, 2, 1, .5};
  r.ok(sq_define(r.sequence, 0, 3, events, 2));
  events[1] = 31;
  r.ok(sq_queue(r.sequence, 0, SQ_BEAT));
  r.ok(sq_on_beat(r.sequence, 1, 100.25, 1));
  r.ok(sq_on_beat(r.sequence, 1, 100.25, 1));
  require(r.triggers() == 1);
  double voice[ST_VOICE_FIELDS]; st_voice_info(r.sampler, 0, voice);
  require(voice[ST_VOICE_CHANNEL] == 0 && voice[ST_VOICE_FRAME] == 100.25);
  r.ok(sq_on_beat(r.sequence, 2, 400.75, 1));
  r.ok(sq_on_beat(r.sequence, 3, 800.125, 1));
  require(r.triggers() == 2 && r.state()[SQ_POSITION] == 2);
  r.ok(sq_on_beat(r.sequence, 4, 900, 1));
  require(r.state()[SQ_STATUS] == SQ_READY);
  const double invalid[] = {0, 31, 1};
  require(sq_define(r.sequence, 0, 1, invalid, 1) == -1);
  double pattern[SQ_PATTERN_FIELDS]; sq_pattern_info(r.sequence, 0, pattern);
  require(pattern[SQ_PATTERN_LENGTH] == 3);
  const double fractional[] = {.5, 0, 1};
  require(sq_define(r.sequence, 1, 2, fractional, 1) == -1);
  require(sq_define(r.sequence, 1, 0, nullptr, 0) == -1);
}
void queue_reanchor_and_epoch() {
  Runtime r;
  const double a[] = {0, 0, 1, 2, 1, .5}, b[] = {0, 1, 1};
  r.ok(sq_define(r.sequence, 0, 3, a, 2)); r.ok(sq_define(r.sequence, 1, 1, b, 1));
  r.ok(sq_on_beat(r.sequence, 20, 0, 1));
  r.ok(sq_queue(r.sequence, 0, SQ_BAR)); require(r.state()[SQ_PENDING_TARGET] == 24);
  r.ok(sq_queue(r.sequence, 1, SQ_BAR)); sq_cancel_queue(r.sequence);
  r.ok(sq_on_beat(r.sequence, 21, 100, 1)); require(r.triggers() == 0);
  r.ok(sq_queue(r.sequence, 0, SQ_BEAT)); r.ok(sq_on_beat(r.sequence, 22, 200, 1));
  r.ok(sq_queue(r.sequence, 1, SQ_BAR)); sq_mark_one(r.sequence);
  require(r.state()[SQ_PENDING_TARGET] == 23);
  r.ok(sq_on_beat(r.sequence, 23, 300, 1));
  require(r.triggers() == 2 && r.state()[SQ_BEAT_NUMBER] == 1 && r.state()[SQ_BAR_NUMBER] == 1);
  r.ok(sq_queue(r.sequence, 0, SQ_BAR)); require(r.state()[SQ_PENDING_TARGET] == 27);
  r.ok(sq_on_beat(r.sequence, 24, 400, 2));
  require(r.state()[SQ_ACTIVE_ID] == -1 && r.state()[SQ_PENDING_ID] == -1);
  require(r.triggers() == 2);
}
void immutable_versions() {
  Runtime r;
  const double old_events[] = {0, 0, 1, 3, 0, 1}, replacement[] = {0, 1, 1};
  r.ok(sq_define(r.sequence, 0, 4, old_events, 2)); r.ok(sq_queue(r.sequence, 0, SQ_BEAT));
  const double version = r.state()[SQ_PENDING_VERSION];
  r.ok(sq_define(r.sequence, 0, 1, replacement, 1));
  require(r.state()[SQ_PENDING_LENGTH] == 4 && r.state()[SQ_PENDING_VERSION] == version);
  double current[SQ_PATTERN_FIELDS]; sq_pattern_info(r.sequence, 0, current);
  require(current[SQ_PATTERN_VERSION] > version);
  r.ok(sq_on_beat(r.sequence, 1, 0, 1)); require(r.state()[SQ_ACTIVE_LENGTH] == 4 && r.state()[SQ_ACTIVE_VERSION] == version);
  r.ok(sq_on_beat(r.sequence, 2, 4, 1)); r.ok(sq_on_beat(r.sequence, 3, 8, 1)); r.ok(sq_on_beat(r.sequence, 4, 12, 1));
  double voice[ST_VOICE_FIELDS]; st_voice_info(r.sampler, 1, voice);
  require(voice[ST_VOICE_CHANNEL] == 0 && r.triggers() == 2);
  r.ok(sq_queue(r.sequence, 0, SQ_BEAT)); r.ok(sq_on_beat(r.sequence, 5, 16, 1));
  require(r.state()[SQ_ACTIVE_LENGTH] == 1);
}
void capture_before_cues_and_patterns() {
  Runtime r;
  r.ok(sq_on_beat(r.sequence, 1, 0, 1));
  require(st_prepare(r.sampler, 0, 0, 30, -1, nullptr, 0, 0) == 0);
  require(st_start(r.sampler, 0, 0, 0) == 0);
  const float input[] = {.5f, .25f}; st_capture(r.sampler, input, 2, 0);
  r.ok(sq_arm_recording(r.sequence, 0, SQ_STOP, SQ_BAR, 30, 0));
  r.ok(sq_arm_recording(r.sequence, 1, SQ_START, SQ_BAR, 30, 1));
  r.ok(sq_cue(r.sequence, 0, SQ_PLAY, SQ_BAR, 1));
  r.ok(sq_cue(r.sequence, 1, SQ_PLAY, SQ_BAR, .25));
  const double pattern[] = {0, 0, .5}; r.ok(sq_define(r.sequence, 0, 1, pattern, 1)); r.ok(sq_queue(r.sequence, 0, SQ_BAR));
  sq_mark_one(r.sequence);
  double arm[SQ_RECORD_FIELDS]; sq_record_info(r.sequence, 0, arm); require(arm[SQ_RECORD_TARGET] == 2);
  r.ok(sq_on_beat(r.sequence, 2, 2.5, 1));
  require(r.triggers() == 2 && r.state()[SQ_SKIPPED] == 1);
  double slot[ST_SLOT_FIELDS]; st_slot_info(r.sampler, 0, 0, slot); require(!slot[ST_SLOT_RECORDING]);
  st_slot_info(r.sampler, 1, 0, slot); require(slot[ST_SLOT_RECORDING]);
  require(sq_cue(r.sequence, 1, SQ_PLAY, SQ_BEAT, 1) == -1);
  r.ok(sq_arm_recording(r.sequence, 1, SQ_STOP, SQ_BEAT, 30, 1));
  sq_silence(r.sequence, 1); sq_record_info(r.sequence, 1, arm); require(!arm[SQ_RECORD_LOOP]);
  sq_cancel_recording(r.sequence, 1); sq_cancel_cue(r.sequence, 0);
  st_slot_info(r.sampler, 1, 0, slot); require(slot[ST_SLOT_RECORDING]);
}
void stop_cancel_and_bounds() {
  Runtime r;
  const double event[] = {0, 0, 1}; r.ok(sq_define(r.sequence, 0, 1, event, 1));
  r.ok(sq_queue(r.sequence, 0, SQ_BEAT)); sq_stop(r.sequence);
  r.ok(sq_on_beat(r.sequence, 1, 0, 1)); require(r.triggers() == 0);
  const auto before = r.state();
  require(sq_on_beat(r.sequence, 2, std::numeric_limits<double>::infinity(), 1) == -1);
  require(r.state() == before);
  require(sq_queue(r.sequence, 0, 9) == -1);
  require(sq_arm_recording(r.sequence, 0, SQ_START, SQ_BAR, 30, 7) == -1);
  require(sq_reset(r.sequence, -.5) == -1);
}
}
int main() {
  crossings_and_validation(); queue_reanchor_and_epoch(); immutable_versions(); capture_before_cues_and_patterns(); stop_cancel_and_bounds();
  return 0;
}
