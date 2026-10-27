#include "performance_engine.h"
#include <algorithm>
#include <array>
#include <new>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <vector>

namespace {
bool watch_heap = false;
uint64_t heap_allocations = 0, heap_frees = 0;
}
#ifndef __EMSCRIPTEN__
void* operator new(std::size_t bytes) {
  if (watch_heap) ++heap_allocations;
  void* result = std::malloc(bytes ? bytes : 1);
  if (!result) std::abort();
  return result;
}
void* operator new[](std::size_t bytes) { return ::operator new(bytes); }
void operator delete(void* pointer) noexcept { if (watch_heap && pointer) ++heap_frees; std::free(pointer); }
void operator delete[](void* pointer) noexcept { ::operator delete(pointer); }
void operator delete(void* pointer, std::size_t) noexcept { ::operator delete(pointer); }
void operator delete[](void* pointer, std::size_t) noexcept { ::operator delete(pointer); }
#endif
namespace {
void require(bool condition, const char* message) { if (!condition) { std::fprintf(stderr, "%s\n", message); std::abort(); } }
void ok(pf_engine* engine, int result) { if (result < 0) { std::fprintf(stderr, "%s\n", pf_error(engine)); std::abort(); } }
int control(pf_engine* engine, int id, double value, const char* identifier) {
  std::array<uint16_t, 200> units{};
  if (!identifier) return pf_control(engine, id, value, nullptr, 0);
  unsigned length = 0;
  while (identifier[length] && length < units.size()) { units[length] = uint8_t(identifier[length]); ++length; }
  return pf_control(engine, id, value, units.data(), length);
}
struct Engine {
  pf_engine* value;
  explicit Engine(int mode = PF_PRACTICE, double rate = 8000): value(pf_create(rate, mode, 32, 30, 4)) { require(value, "create engine"); }
  ~Engine() { pf_destroy(value); }
  operator pf_engine*() { return value; }
};
std::array<double, PF_FIELDS> state(pf_engine* engine) { std::array<double, PF_FIELDS> out{}; pf_snapshot(engine, out.data()); return out; }
std::array<double, PF_CUE_FIELDS> cue(int bar, int channel, int kind, int timing = PF_BAR, int capture = PF_CONTINUOUS, int variant = -1) {
  std::array<double, PF_CUE_FIELDS> out{};
  out[PF_CUE_BAR] = bar; out[PF_CUE_CHANNEL] = channel; out[PF_CUE_KIND] = kind; out[PF_CUE_TIMING] = timing;
  out[PF_CUE_CAPTURE] = capture; out[PF_CUE_VARIANT] = variant;
  return out;
}
std::vector<float> process(pf_engine* engine, unsigned length, float input = 0, unsigned chunk = 128) {
  std::vector<float> output(length, 0), source(length, input);
  for (unsigned offset = 0; offset < length;) {
    unsigned count = std::min(chunk, length - offset);
    ok(engine, pf_process(engine, source.data() + offset, output.data() + offset, nullptr, count));
    offset += count;
  }
  return output;
}
void until_bar(pf_engine* engine, int bar, float input = 0) {
  for (int count = 0; count < 2000; ++count) {
    auto snapshot = state(engine);
    if (snapshot[PF_BAR_NUMBER] == bar && snapshot[PF_BEAT_NUMBER] == 1) return;
    process(engine, 128, input);
  }
  require(false, "reach requested bar");
}
void configure(pf_engine* engine, int bars, const double* cues = nullptr, int count = 0, const double* playback = nullptr, int playback_count = 0) {
  ok(engine, pf_configure(engine, 120, 4, bars, bars, 4, nullptr, 0, cues, count, playback, playback_count));
}
void owned_clock_capture_and_commit() {
  Engine engine;
  auto arm = cue(0, 2, PF_ARM), commit = cue(2, 2, PF_COMMIT);
  std::array<double, PF_CUE_FIELDS * 2> cues;
  std::copy(arm.begin(), arm.end(), cues.begin()); std::copy(commit.begin(), commit.end(), cues.begin() + PF_CUE_FIELDS);
  configure(engine, 8, cues.data(), 2);
  ok(engine, pf_set_click_gain(engine, 0));
  ok(engine, pf_set_microphone(engine, 1));
  ok(engine, pf_start(engine, 120, 1, 1, 8, 1, 0));
  ok(engine, control(engine, 2, 0, "arm"));
  until_bar(engine, 2, .25f);
  ok(engine, control(engine, 2, 0, "commit"));
  until_bar(engine, 3, .25f);
  double sample[ST_SAMPLE_FIELDS]; st_sample_info(pf_sampler(engine), 2, -1, sample);
  require(sample[ST_SAMPLE_LENGTH] == 32000, "capture commits exactly two bars");
  require(st_is_looping(pf_sampler(engine), 2), "commit auto-plays native loop");
  auto output = process(engine, 256);
  for (float value : output) require(std::abs(value - .25f) < 1e-6, "native loop output");
  pf_stop(engine);
  output = process(engine, 256);
  for (float value : output) require(value == 0, "stop silences sample output");
}
void mandatory_click_and_song_preference() {
  Engine engine;
  configure(engine, 2);
  ok(engine, pf_set_click(engine, 0));
  ok(engine, pf_start(engine, 120, 1, 1, 2, 0, 0));
  auto output = process(engine, 16001, 0, 16001);
  double energy = 0; for (float value : output) energy += std::abs(value);
  require(energy > 0.1, "count-in clicks even with song click disabled");
  until_bar(engine, 1);
  output = process(engine, 1000);
  for (float value : output) require(value == 0, "song click stays off");
  require(state(engine)[PF_CLICK] == 0, "mandatory click does not alter preference");
  ok(engine, pf_set_click(engine, 1));
  output = process(engine, 5000);
  energy = 0; for (float value : output) energy += std::abs(value);
  require(energy > 0.1, "song click can be enabled");
}
void count_in_range_and_faults() {
  Engine engine;
  configure(engine, 8);
  ok(engine, pf_start(engine, 120, 2, 3, 4, 1, 0));
  for (int id = 1; id <= 8; ++id) {
    require(pf_on_beat(engine, id, id * 100, 1) == 1, "count-in accepted");
    require(state(engine)[PF_BAR_NUMBER] == -1, "count-in no numbered bar");
  }
  require(pf_on_beat(engine, 9, 900, 1) == 1, "first song beat");
  require(state(engine)[PF_BAR_NUMBER] == 3, "start requested bar");
  require(pf_on_beat(engine, 9, 900, 1) == 0, "duplicate ignored");
  for (int id = 10; id <= 17; ++id) pf_on_beat(engine, id, id * 100, 1);
  require(state(engine)[PF_BAR_NUMBER] == 3 && state(engine)[PF_BEAT_NUMBER] == 1, "range loops without count-in");
  require(pf_on_beat(engine, 19, 1900, 1) == -1, "gap faults natively");
  require(state(engine)[PF_PHASE] == PF_IDLE && state(engine)[PF_ERROR] == PF_MISSED_BEAT, "gap stops transport");
  pf_stop(engine);
  ok(engine, pf_start(engine, 120, 0, 1, 1, 0, 0));
  pf_on_beat(engine, 20, 2000, 1);
  require(pf_on_beat(engine, 21, 2100, 2) == -1 && state(engine)[PF_ERROR] == PF_CLOCK_RESTARTED, "epoch change faults");
}
void whole_bar_variants_and_suppression() {
  Engine engine;
  auto arm = cue(2, 3, PF_ARM, PF_BAR, PF_WHOLE_BAR, 0);
  auto replace = cue(3, 3, PF_COMMIT_ARM, PF_BAR, PF_WHOLE_BAR, 1);
  auto commit = cue(4, 3, PF_COMMIT), stop = cue(6, 3, PF_STOP, PF_NOW);
  std::array<double, PF_CUE_FIELDS * 4> cues;
  std::copy(arm.begin(), arm.end(), cues.begin()); std::copy(replace.begin(), replace.end(), cues.begin() + PF_CUE_FIELDS);
  std::copy(commit.begin(), commit.end(), cues.begin() + PF_CUE_FIELDS * 2); std::copy(stop.begin(), stop.end(), cues.begin() + PF_CUE_FIELDS * 3);
  double playback[] = {5, 3, 0, 6, 3, 1, 7, 3, 0};
  configure(engine, 8, cues.data(), 4, playback, 3);
  ok(engine, pf_set_click_gain(engine, 0)); ok(engine, pf_set_microphone(engine, 1));
  ok(engine, pf_start(engine, 240, 0, 1, 8, 1, 0));
  until_bar(engine, 2); ok(engine, control(engine, 3, 0, nullptr));
  until_bar(engine, 3, .001f); ok(engine, control(engine, 3, 0, nullptr));
  until_bar(engine, 4, .001f); ok(engine, control(engine, 3, 0, nullptr));
  until_bar(engine, 5, .003f);
  require(st_has(pf_sampler(engine), 3, 0) && st_has(pf_sampler(engine), 3, 1), "both whole-bar takes retained");
  double pair[ST_SAMPLE_FIELDS], single[ST_SAMPLE_FIELDS];
  st_sample_info(pf_sampler(engine), 3, 0, pair); st_sample_info(pf_sampler(engine), 3, 1, single);
  require(pair[ST_SAMPLE_LENGTH] == 8000 && single[ST_SAMPLE_LENGTH] == 8000 && pair[ST_SAMPLE_SLICES] == 0, "quiet captures retain entire bars");
  until_bar(engine, 6); ok(engine, control(engine, 3, 0, nullptr));
  until_bar(engine, 7);
  require(!st_is_looping(pf_sampler(engine), 3), "automatic variant does not resurrect stopped channel");
}
void state_events_are_immutable_and_bounded() {
  Engine engine;
  configure(engine, 4);
  ok(engine, pf_start(engine, 240, 1, 1, 4, 0, 0));
  process(engine, 32000, 0, 32000);
  std::vector<double> events(PF_EVENT_CAPACITY * PF_EVENT_FIELDS);
  unsigned count = pf_drain_events(engine, events.data(), PF_EVENT_CAPACITY);
  int count_in = 0, song = 0;
  double sequence = 0;
  for (unsigned index = 0; index < count; ++index) {
    const double* event = events.data() + index * PF_EVENT_FIELDS;
    require(event[PF_EVENT_SEQUENCE] > sequence, "native event ordering"); sequence = event[PF_EVENT_SEQUENCE];
    if (event[PF_EVENT_TYPE] != PF_BEAT) continue;
    if (event[PF_EVENT_STATE + PF_PHASE] == PF_COUNT_IN) ++count_in;
    if (event[PF_EVENT_STATE + PF_BAR_NUMBER] == 1) ++song;
  }
  require(count_in == 4 && song == 4, "event snapshots retain position from each crossing");
}
void commands_and_configuration_are_atomic() {
  Engine engine;
  auto arm = cue(0, 2, PF_ARM);
  configure(engine, 8, arm.data(), 1);
  require(pf_configure(engine, 120, 4, 9, 9, 4, nullptr, 1, nullptr, 0, nullptr, 0) < 0, "invalid config rejected");
  require(state(engine)[PF_BAR_COUNT] == 8, "prior config retained");
  ok(engine, pf_set_microphone(engine, 1)); ok(engine, pf_start(engine, 120, 2, 1, 8, 1, 0));
  ok(engine, control(engine, 2, 0, "once"));
  ok(engine, control(engine, 2, 0, "once"));
  require(control(engine, 3, 0, "once") < 0, "changed duplicate control rejected");
  require(state(engine)[PF_ERROR] == PF_COMMAND_CONFLICT, "native duplicate conflict");
  until_bar(engine, 1, .5f);
  double slot[ST_SLOT_FIELDS]; st_slot_info(pf_sampler(engine), 2, 0, slot);
  require(slot[ST_SLOT_RECORDING] && slot[ST_SLOT_START] == std::ceil(state(engine)[PF_CLOCK_BEAT_FRAME]), "multi-bar count-in arms first song bar");
}
void bounded_events_and_invalid_programs() {
  Engine engine;
  configure(engine, 1);
  double invalid_event[] = {0, 1099511627776.0, 1};
  require(pf_configure(engine, 120, 4, 1, 1, 4, invalid_event, 1, nullptr, 0, nullptr, 0) < 0, "large channel ID rejected before integer conversion");
  auto invalid_cue = cue(0, 0, PF_ARM); invalid_cue[PF_CUE_CHANNEL] = 1099511627776.0;
  require(pf_configure(engine, 120, 4, 1, 1, 4, nullptr, 0, invalid_cue.data(), 1, nullptr, 0) < 0, "large cue channel rejected");
  ok(engine, pf_start(engine, 120, 0, 1, 1, 1, 0));
  require(control(engine, 0, 0, "   ") < 0, "blank command ID rejected");
  for (int id = 1; id <= 600; ++id) pf_on_beat(engine, id, id * 100, 1);
  require(state(engine)[PF_EVENT_DROPS] > 0, "event queue overflow counted");
  std::vector<double> events(PF_EVENT_CAPACITY * PF_EVENT_FIELDS);
  require(pf_drain_events(engine, events.data(), PF_EVENT_CAPACITY) == PF_EVENT_CAPACITY, "event queue remains bounded");
  require(events[(PF_EVENT_CAPACITY - 1) * PF_EVENT_FIELDS + PF_EVENT_STATE + PF_LAST_BEAT_ID] == 600, "newest event retained");
}
void utf16_command_identity() {
  Engine engine;
  std::array<uint16_t, 101> unicode{}; unicode.fill(0x00e9);
  ok(engine, pf_control(engine, 0, 0, unicode.data(), unicode.size()));
  ok(engine, pf_control(engine, 0, 0, unicode.data(), unicode.size()));
  require(pf_control(engine, 1, 0, unicode.data(), unicode.size()) < 0, "unicode duplicate retains identity");
  uint16_t first[] = {'x', 0, 'a'}, second[] = {'x', 0, 'b'};
  ok(engine, pf_control(engine, 0, 0, first, 3));
  ok(engine, pf_control(engine, 1, 0, second, 3));
  ok(engine, pf_control(engine, 0, 0, first, 3));
  require(pf_control(engine, 1, 0, first, 3) < 0, "NUL suffix participates in identity");
  uint16_t spaces[] = {0x2000, 0x00a0, 0xfeff};
  require(pf_control(engine, 0, 0, spaces, 3) < 0, "JavaScript trim whitespace rejected");
  require(pf_control(engine, 0, 0, nullptr, 1) < 0, "null nonempty ID rejected");
  require(pf_control(engine, 0, 0, first, 0) < 0, "explicit empty ID rejected");
  std::array<uint16_t, 200> maximum{}; maximum.fill(0xd800);
  ok(engine, pf_control(engine, 0, 0, maximum.data(), maximum.size()));
  require(pf_control(engine, 0, 0, maximum.data(), 201) < 0, "overlong ID rejected before reading units");
}
void generic_click_and_clock_retries() {
  Engine engine(PF_TRACKER);
  require(pf_clock_command(engine, BT_SELECT_MANUAL, 0, 0, 1, 1) == BT_OK, "manual command");
  require(pf_clock_command(engine, BT_APPLY_BPM, 120, 0, 2, 1) == BT_OK, "tempo command");
  require(pf_clock_command(engine, BT_APPLY_BPM, 120, 0, 2, 1) == BT_OK, "clock retry");
  ok(engine, pf_set_click(engine, 1));
  auto output = process(engine, 5000);
  double energy = 0; for (float value : output) energy += std::abs(value);
  require(energy > 0.1, "generic native click output");
}
std::array<double, PF_LIVE_FIELDS> live_state(pf_engine* engine) {
  std::array<double, PF_LIVE_FIELDS> result{}; pf_live_info(engine, result.data()); return result;
}
pf_effect_definition slapback(double delay = 100, double feedback = 0, double wet = .25) {
  pf_effect_definition result{}; result.type = PF_EFFECT_SLAPBACK; result.version = 1;
  result.parameters.slapback = {delay, feedback, wet}; return result;
}
void near(float actual, float expected, const char* message) { require(std::isfinite(actual) && std::abs(actual - expected) < 1e-6f, message); }
void live_preparation_and_revisions() {
  Engine engine;
  configure(engine, 2);
  require(pf_abi_version() == 2 && !live_state(engine)[PF_LIVE_PREPARED], "live API begins unprepared");
  auto effect = slapback();
  ok(engine, pf_prepare_live_effects(engine, &effect, 1, 1));
  auto prepared = live_state(engine);
  require(prepared[PF_LIVE_PREPARED] == 1 && prepared[PF_LIVE_ACTIVE] == 0
    && prepared[PF_LIVE_REVISION] == 1 && prepared[PF_LIVE_STAGE_COUNT] == 1, "prepared native live state");
  ok(engine, pf_prepare_live_effects(engine, &effect, 1, 1));
  require(live_state(engine) == prepared, "same revision and definitions idempotent");
  auto invalid = effect; invalid.parameters.slapback.wet = std::numeric_limits<double>::quiet_NaN();
  require(pf_prepare_live_effects(engine, &invalid, 1, 2) < 0 && live_state(engine) == prepared, "failed parameter preparation preserves prior configuration");
  invalid = effect; invalid.type = 999;
  require(pf_prepare_live_effects(engine, &invalid, 1, 2) < 0 && live_state(engine) == prepared, "unsupported type rejects atomically");
  invalid = effect; invalid.version = 2;
  require(pf_prepare_live_effects(engine, &invalid, 1, 2) < 0 && live_state(engine) == prepared, "unsupported effect version");
  invalid = effect; invalid.parameters.slapback.wet = .5;
  require(pf_prepare_live_effects(engine, &invalid, 1, 1) < 0 && live_state(engine) == prepared, "same revision with changed config rejected");
  require(pf_prepare_live_effects(engine, &effect, 1, 0) < 0 && live_state(engine) == prepared, "zero revision rejected");
  require(pf_prepare_live_effects(engine, nullptr, PF_MAX_LIVE_EFFECTS + 1, 2) < 0 && live_state(engine) == prepared, "stage admission validated before definitions read");
  ok(engine, pf_prepare_live_effects(engine, nullptr, 0, 2));
  require(live_state(engine)[PF_LIVE_PREPARED] == 1 && live_state(engine)[PF_LIVE_STAGE_COUNT] == 0, "count zero explicitly prepares identity");
  require(pf_prepare_live_effects(engine, &effect, 1, 1) < 0 && live_state(engine)[PF_LIVE_REVISION] == 2, "lower revision rejected");
  ok(engine, st_prepare(pf_sampler(engine), 1, 0, 1, -1, nullptr, 0, 0));
  ok(engine, st_start(pf_sampler(engine), 1, 0, 0));
  require(pf_prepare_live_effects(engine, &effect, 1, 3) < 0 && live_state(engine)[PF_LIVE_REVISION] == 2, "active raw capture blocks replacement while idle");
  st_stop_all_recordings(pf_sampler(engine), 3);
  ok(engine, sq_arm_recording(pf_sequencer(engine), 1, SQ_START, SQ_BAR, 1, 0));
  require(pf_prepare_live_effects(engine, &effect, 1, 3) < 0 && live_state(engine)[PF_LIVE_REVISION] == 2, "pending raw capture blocks replacement while idle");
  sq_cancel_recording(pf_sequencer(engine), 1);
  ok(engine, pf_prepare_live_effects(engine, &effect, 1, 3));
}
void live_stereo_and_legacy_parity() {
  Engine engine;
  configure(engine, 2); ok(engine, pf_set_click_gain(engine, 0));
  auto effect = slapback(); ok(engine, pf_prepare_live_effects(engine, &effect, 1, 1));
  ok(engine, pf_set_microphone(engine, 1)); ok(engine, pf_start(engine, 120, 0, 1, 2, 1, 0));
  require(live_state(engine)[PF_LIVE_ACTIVE] == 1, "valid start authorizes live effects");
  std::array<float, 1001> input{}, mix_l{}, mix_r{}, live_l{}, live_r{}; input[0] = 1;
  mix_l.fill(.5f); mix_r.fill(-.5f); live_l.fill(.125f); live_r.fill(-.125f);
  ok(engine, pf_process_stems(engine, input.data(), mix_l.data(), mix_r.data(), live_l.data(), live_r.data(), input.size()));
  for (unsigned index = 0; index < input.size(); ++index) {
    float expected = index == 0 ? 1 : index == 800 ? .25f : 0;
    near(live_l[index], .125f + expected, "live left exact impulse and additive output");
    near(live_r[index], -.125f + expected, "mono centered on right with same effect");
    require(mix_l[index] == .5f && mix_r[index] == -.5f, "live not included in sample/click stem");
  }
  Engine legacy, stems;
  for (pf_engine* current : {legacy.value, stems.value}) {
    configure(current, 2); ok(current, pf_prepare_live_effects(current, &effect, 1, 1));
    ok(current, pf_set_microphone(current, 1)); ok(current, pf_start(current, 120, 1, 1, 2, 1, 0));
  }
  std::array<float, 1001> old_l{}, old_r{}, new_l{}, new_r{}, additional_l{}, additional_r{};
  ok(legacy, pf_process(legacy, input.data(), old_l.data(), old_r.data(), input.size()));
  ok(stems, pf_process_stems(stems, input.data(), new_l.data(), new_r.data(), additional_l.data(), additional_r.data(), input.size()));
  require(old_l == new_l && old_r == new_r, "legacy API preserves exact sample/click output including countin click");
  near(additional_l[800], .25f, "countin live effect independent from click");
  Engine discarded;
  configure(discarded, 2); ok(discarded, pf_prepare_live_effects(discarded, &effect, 1, 1));
  ok(discarded, pf_set_microphone(discarded, 1)); ok(discarded, pf_start(discarded, 120, 0, 1, 2, 1, 0));
  ok(discarded, pf_process(discarded, input.data(), nullptr, nullptr, 800));
  float out = 0;
  ok(discarded, pf_process_stems(discarded, nullptr, nullptr, nullptr, &out, nullptr, 1));
  near(out, .25f, "legacy discard still advances live DSP exactly once");
}
void live_null_outputs_alias_and_nonfinite() {
  Engine engine;
  configure(engine, 2); auto effect = slapback();
  ok(engine, pf_prepare_live_effects(engine, &effect, 1, 1)); ok(engine, pf_set_microphone(engine, 1));
  ok(engine, pf_start(engine, 120, 0, 1, 2, 1, 0));
  std::array<float, 16> input{}, left{}, right{}, live_l{}, live_r{}; input.fill(.2f); left.fill(.5f);
  auto snapshot = state(engine); auto info = live_state(engine); auto before = input; auto output = left;
  require(pf_process_stems(engine, input.data(), left.data(), right.data(), left.data(), live_r.data(), 8) < 0, "alias between output stems rejected");
  require(state(engine) == snapshot && live_state(engine) == info && left == output && input == before, "alias rejection leaves every engine field and output intact");
  require(pf_process_stems(engine, input.data(), left.data(), right.data(), input.data() + 1, live_r.data(), 8) < 0 && state(engine) == snapshot && input == before, "partial input/output overlap rejected before processing");
  std::array<float, 800> impulse{}; impulse[0] = 1;
  ok(engine, pf_process_stems(engine, impulse.data(), nullptr, nullptr, nullptr, nullptr, impulse.size()));
  float echo = 0; ok(engine, pf_process_stems(engine, nullptr, nullptr, nullptr, nullptr, &echo, 1));
  near(echo, .25f, "all-null live buses advance both channels once");
  input[0] = std::numeric_limits<float>::quiet_NaN(); input[1] = std::numeric_limits<float>::infinity();
  ok(engine, pf_process_stems(engine, input.data(), nullptr, nullptr, live_l.data(), live_r.data(), input.size()));
  for (unsigned index = 0; index < input.size(); ++index) { require(std::isfinite(live_l[index]) && live_l[index] == live_r[index], "nonfinite input sanitized before live ring"); }
  near(live_l[0], 0, "NaN source becomes silence"); near(live_l[1], 0, "infinite source becomes silence");
}
void live_lifecycle_and_capture_rejection() {
  Engine engine;
  auto arm = cue(0, 2, PF_ARM), replacement = cue(1, 2, PF_COMMIT_ARM);
  std::array<double, PF_CUE_FIELDS * 2> cues{};
  std::copy(arm.begin(), arm.end(), cues.begin()); std::copy(replacement.begin(), replacement.end(), cues.begin() + PF_CUE_FIELDS);
  configure(engine, 2, cues.data(), 2); ok(engine, pf_set_click_gain(engine, 0));
  auto effect = slapback(); ok(engine, pf_prepare_live_effects(engine, &effect, 1, 1));
  ok(engine, pf_set_microphone(engine, 1)); ok(engine, pf_start(engine, 120, 1, 1, 2, 1, 0));
  double before[ST_STATS_FIELDS], after[ST_STATS_FIELDS]; st_stats(pf_sampler(engine), before);
  require(control(engine, 2, 0, "effects-arm") < 0 && state(engine)[PF_ERROR] == PF_CAPTURE_EFFECTS_UNAVAILABLE, "effected capture rejects as explicit command result");
  st_stats(pf_sampler(engine), after);
  require(before[ST_STATS_MEMORY_BYTES] == after[ST_STATS_MEMORY_BYTES] && live_state(engine)[PF_LIVE_ACTIVE] == 1, "unsupported capture allocates nothing and does not gate live");
  double slot[ST_SLOT_FIELDS], channel[PF_CHANNEL_FIELDS]; st_slot_info(pf_sampler(engine), 2, 0, slot); pf_channel_info(engine, 2, channel);
  require(!slot[ST_SLOT_PRESENT] && channel[PF_CHANNEL_PENDING_KIND] == PF_NONE, "unsupported capture cannot prepare or queue a raw take");
  std::array<float, 1001> input{}, left{}, right{}; input[0] = 1;
  ok(engine, pf_process_stems(engine, input.data(), nullptr, nullptr, left.data(), right.data(), input.size()));
  near(left[800], .25f, "nonfatal command error does not mute live effect");
  require(pf_prepare_live_effects(engine, nullptr, 0, 2) < 0 && live_state(engine)[PF_LIVE_REVISION] == 1 && live_state(engine)[PF_LIVE_ACTIVE], "running preparation rejected without disrupting effect");
  ok(engine, pf_set_microphone(engine, 0)); ok(engine, pf_set_microphone(engine, 1));
  require(!live_state(engine)[PF_LIVE_ACTIVE], "stale microphone-ready does not reauthorize live");
  left.fill(0); right.fill(0); input.fill(.2f);
  ok(engine, pf_process_stems(engine, input.data(), nullptr, nullptr, left.data(), right.data(), input.size()));
  for (float value : left) require(value == 0, "mic loss clears tails and keeps later mic readiness gated");
  pf_stop(engine); ok(engine, pf_start(engine, 120, 0, 1, 2, 1, 0));
  require(live_state(engine)[PF_LIVE_ACTIVE] == 1, "new valid Start rearms live");
  left.fill(0); right.fill(0); input.fill(0);
  ok(engine, pf_process_stems(engine, input.data(), nullptr, nullptr, left.data(), right.data(), input.size()));
  for (float value : left) require(value == 0, "restart does not reveal old effect tail");
  ok(engine, control(engine, 4, 0, "panic-live"));
  require(!live_state(engine)[PF_LIVE_ACTIVE] && state(engine)[PF_PHASE] == PF_IDLE, "Panic clears live authorization");
  ok(engine, pf_start(engine, 120, 0, 1, 2, 1, 0));
  pf_on_beat(engine, 1, state(engine)[PF_FRAME], 1);
  require(pf_on_beat(engine, 3, state(engine)[PF_FRAME], 1) < 0 && !live_state(engine)[PF_LIVE_ACTIVE], "fatal beat gap clears live authorization");
}
void live_end_boundary_and_identity_capture() {
  Engine ended;
  configure(ended, 1); auto effect = slapback();
  ok(ended, pf_prepare_live_effects(ended, &effect, 1, 1)); ok(ended, pf_set_microphone(ended, 1));
  ok(ended, pf_start(ended, 120, 0, 1, 1, 0, 0));
  std::vector<float> input(21000, .2f), left(input.size()), right(input.size());
  ok(ended, pf_process_stems(ended, input.data(), nullptr, nullptr, left.data(), right.data(), input.size()));
  require(state(ended)[PF_PHASE] == PF_ENDED && !live_state(ended)[PF_LIVE_ACTIVE], "nonloop end clears native live latch");
  std::vector<double> events(PF_EVENT_CAPACITY * PF_EVENT_FIELDS);
  unsigned count = pf_drain_events(ended, events.data(), PF_EVENT_CAPACITY);
  double end_frame = -1;
  for (unsigned index = 0; index < count; ++index) {
    const double* event = events.data() + index * PF_EVENT_FIELDS;
    if (event[PF_EVENT_STATE + PF_PHASE] == PF_ENDED) end_frame = event[PF_EVENT_FRAME];
  }
  require(std::abs(end_frame - 20000) < 1e-6, "native end event retains the musical frame boundary");
  unsigned first_silent = unsigned(std::ceil(end_frame));
  require(first_silent && first_silent < left.size() && left[first_silent - 1] != 0, "live reaches sample immediately before declared end crossing");
  for (unsigned index = first_silent; index < left.size(); ++index) require(left[index] == 0 && right[index] == 0, "no live audio in remainder after in-block end");
  Engine identity;
  auto arm = cue(0, 2, PF_ARM);
  configure(identity, 2, arm.data(), 1); ok(identity, pf_prepare_live_effects(identity, nullptr, 0, 1));
  ok(identity, pf_set_microphone(identity, 1)); ok(identity, pf_start(identity, 120, 1, 1, 2, 1, 0));
  ok(identity, control(identity, 2, 0, "identity-arm"));
  until_bar(identity, 1, .2f);
  double slot[ST_SLOT_FIELDS]; st_slot_info(pf_sampler(identity), 2, 0, slot);
  require(slot[ST_SLOT_RECORDING], "explicit identity retains current capture path");
}
void live_processing_has_no_heap_work() {
#ifndef __EMSCRIPTEN__
  Engine engine;
  configure(engine, 2); auto effect = slapback();
  ok(engine, pf_prepare_live_effects(engine, &effect, 1, 1)); ok(engine, pf_set_microphone(engine, 1));
  ok(engine, pf_start(engine, 120, 0, 1, 2, 1, 0));
  std::array<float, 1024> input{}, left{}, right{}; input[0] = 1;
  heap_allocations = heap_frees = 0; watch_heap = true;
  int result = pf_process_stems(engine, input.data(), nullptr, nullptr, left.data(), right.data(), input.size());
  pf_set_microphone(engine, 0); pf_set_microphone(engine, 1); pf_stop(engine);
  watch_heap = false;
  require(result == 0 && !heap_allocations && !heap_frees, "prepared live processing and safety gates never allocate/free");
#endif
}

}
int main() {
  owned_clock_capture_and_commit(); mandatory_click_and_song_preference(); count_in_range_and_faults();
  whole_bar_variants_and_suppression(); state_events_are_immutable_and_bounded(); commands_and_configuration_are_atomic(); bounded_events_and_invalid_programs(); utf16_command_identity(); generic_click_and_clock_retries();
  live_preparation_and_revisions(); live_stereo_and_legacy_parity(); live_null_outputs_alias_and_nonfinite();
  live_lifecycle_and_capture_rejection(); live_end_boundary_and_identity_capture(); live_processing_has_no_heap_work();
  std::puts("Native performance tests passed.");
}
