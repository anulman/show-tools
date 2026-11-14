#include "performance_engine.h"
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

namespace {
void require(bool condition, const char* message) {
  if (!condition) { std::fprintf(stderr, "%s\n", message); std::abort(); }
}
struct Engine {
  pf_engine* value;
  explicit Engine(int beats = 4) : value(pf_create(8000, PF_PRACTICE, 1, 1, beats)) { require(value, "create cue light engine"); }
  ~Engine() { pf_destroy(value); }
  operator pf_engine*() const { return value; }
};
void ok(pf_engine* engine, int code) { if (code < 0) { std::fprintf(stderr, "%s\n", pf_error(engine)); std::abort(); } }
std::array<double, PF_FIELDS> state(pf_engine* engine) {
  std::array<double, PF_FIELDS> out{}; pf_snapshot(engine, out.data()); return out;
}
double level(pf_engine* engine) {
  std::array<double, PF_LIGHT_FIELDS> out{}; pf_light_output(engine, out.data());
  return out[PF_LIGHT_SAMPLES + PF_LIGHT_SAMPLE_LEVEL];
}
void render(pf_engine* engine, unsigned frames) {
  for (unsigned index = 0; index < frames; ++index) ok(engine, pf_process(engine, nullptr, nullptr, nullptr, 1));
}
void until(pf_engine* engine, int bar, int beat) {
  for (int attempt = 0; attempt < 300000; ++attempt) {
    const auto now = state(engine);
    if (now[PF_PHASE] == PF_PLAYING && now[PF_BAR_NUMBER] == bar && now[PF_BEAT_NUMBER] == beat) return;
    render(engine, 1);
  }
  require(false, "reach cue light musical position");
}
std::vector<double> song(int beats, int bar, double cue, int timing = 0) {
  return {PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, double(beats), 5, 120, 5, 25, 25, 0, 1, 0, 0, 0, 1, 2, 3,
    0, 0, double(bar), cue, double(PF_STOP), double(timing), 0, -1, -1, -1, 0};
}
std::vector<double> capture_song() {
  return {PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, 4, 5, 120, 5, 25, 25, 1, 3, 1, 0, 0, 1, 2, 3,
    0, 2, 0, 3, 0, 1, 3, 0, 0,
    0, 0, 1, -1, PF_ARM, 1, 0, 0, -1, -1, 0,
    0, 0, 2, -1, PF_COMMIT, 1, 0, -1, 0, 0, 0,
    0, 0, 4, 2, PF_STOP, 0, 0, -1, -1, -1, 0,
    0, 0, 1};
}
void prepare(pf_engine* engine, const std::vector<double>& table, int start = 1, int end = 5, bool loop = false) {
  ok(engine, pf_configure_compiled(engine, table.data(), unsigned(table.size())));
  ok(engine, pf_start(engine, 120, 1, start, end, loop, 0));
}
void timed_warning_is_two_chart_counts() {
  for (int beats : {4, 6}) {
    Engine engine(beats); prepare(engine, song(beats, 2, 0));
    require(level(engine) == 0, "far-away timed cue is dark");
    until(engine, 1, beats - 2);
    render(engine, 3998);
    require(level(engine) == 0, "timed warning stays dark before two-count boundary");
    until(engine, 1, beats - 1);
    require(level(engine) > .699, "timed cue pulses from exactly two chart counts before the event");
    render(engine, 1000);
    require(std::abs(level(engine) - .35) < .002, "cue warning uses native seventy-percent beat cosine");
    until(engine, 2, 1);
    render(engine, 1);
    require(level(engine) == 0, "missed timed warning ends at authored cue without extending into late admission");
    ok(engine, pf_control(engine, 7, 1, nullptr, 0));
    ok(engine, pf_control(engine, 7, 0, nullptr, 0));
    require(level(engine) == 0, "late admission remains available after warning ends");
    require(state(engine)[PF_ERROR] == 0, "warning observation does not perform a missed cue");
  }
}
void full_bar_warning_ends_on_acceptance_or_bar_end() {
  Engine engine; prepare(engine, song(4, 2, -1, 1));
  until(engine, 1, 4); require(level(engine) == 0, "whole-bar cue does not warn in preceding bar");
  until(engine, 2, 1); require(level(engine) > .699, "whole-bar cue warns from bar start");
  ok(engine, pf_control(engine, 7, 1, nullptr, 0)); require(level(engine) == 1, "held button overrides cue warning at full brightness");
  ok(engine, pf_control(engine, 7, 0, nullptr, 0));
  require(level(engine) == 0, "accepted queued action clears warning before execution boundary");
  Engine missed; prepare(missed, song(4, 2, -1));
  until(missed, 2, 4); render(missed, 1000);
  require(std::abs(level(missed) - .35) < .002, "unpressed whole-bar cue continues pulsing through final count");
  until(missed, 3, 1); require(level(missed) == 0, "unpressed whole-bar warning ends at next bar");
  pf_stop(missed); require(level(missed) == 0, "stopped engine has no warning");
}
void count_in_range_and_failed_press() {
  Engine engine; prepare(engine, song(4, 1, 0));
  for (int attempt = 0; attempt < 30000 && state(engine)[PF_COUNT_IN_REMAINING] != 2; ++attempt) render(engine, 1);
  require(state(engine)[PF_PHASE] == PF_COUNT_IN && state(engine)[PF_COUNT_IN_REMAINING] == 2, "reach final two count-in counts");
  require(level(engine) > .699, "first-bar timed cue warns during last two count-in counts");
  until(engine, 1, 1); ok(engine, pf_control(engine, 7, 1, nullptr, 0)); ok(engine, pf_control(engine, 7, 0, nullptr, 0));
  require(level(engine) == 0, "accepted timed cue stops warning");
  Engine failed; prepare(failed, capture_song());
  until(failed, 1, 1); require(pf_control(failed, 7, 1, nullptr, 0) < 0, "microphone-unavailable arm rejects button cue");
  ok(failed, pf_control(failed, 7, 0, nullptr, 0));
  require(level(failed) > .699, "rejected press does not dismiss actionable cue warning");
  Engine bounded; prepare(bounded, song(4, 3, 0), 1, 2);
  until(bounded, 2, 3); require(level(bounded) == 0, "out-of-range future cue does not warn at practice end");
  Engine skipped; prepare(skipped, song(4, 1, 3), 2, 5);
  require(level(skipped) == 0, "skipped past cue does not warn during practice count-in");
}
void warning_overrides_playback_without_performing_stop() {
  Engine engine; ok(engine, pf_set_microphone(engine, 1)); prepare(engine, capture_song());
  until(engine, 1, 1); ok(engine, pf_control(engine, 7, 1, nullptr, 0)); ok(engine, pf_control(engine, 7, 0, nullptr, 0));
  until(engine, 2, 1); ok(engine, pf_control(engine, 7, 1, nullptr, 0)); ok(engine, pf_control(engine, 7, 0, nullptr, 0));
  until(engine, 3, 1); require(level(engine) == .7, "completed capture plays at steady seventy percent");
  until(engine, 4, 1); render(engine, 2000);
  require(level(engine) < .001, "actionable cue pulse overrides steady playback at its trough");
  until(engine, 4, 3); render(engine, 202);
  require(level(engine) == .7, "missed stop warning expires while actual playback remains running");
}
void warnings_rearm_after_loop_and_follow_tempo() {
  Engine engine; prepare(engine, song(4, 1, -1), 1, 1, true);
  until(engine, 1, 1); ok(engine, pf_control(engine, 7, 1, nullptr, 0)); ok(engine, pf_control(engine, 7, 0, nullptr, 0));
  require(level(engine) == 0, "accepted loop cue is quiet for rest of pass");
  until(engine, 1, 4); render(engine, 4000);
  require(state(engine)[PF_BAR_NUMBER] == 1 && state(engine)[PF_BEAT_NUMBER] == 1 && level(engine) > .699,
    "loop wrap rearms whole-bar cue warning");
  Engine tempo; prepare(tempo, song(4, 2, 0));
  until(tempo, 1, 1);
  ok(tempo, pf_control(tempo, 6, 0, nullptr, 0)); render(tempo, 6000);
  ok(tempo, pf_control(tempo, 6, 0, nullptr, 0));
  require(std::abs(state(tempo)[PF_BPM] - 80) < .001, "native tempo-hit intent changes warning tempo without rephasing");
  render(tempo, 2998); require(level(tempo) == 0, "tempo change moves warning boundary with chart counts");
  until(tempo, 1, 3); require(level(tempo) > .699, "warning begins at musical boundary after tempo change");
}
}
int main() {
  timed_warning_is_two_chart_counts(); full_bar_warning_ends_on_acceptance_or_bar_end();
  count_in_range_and_failed_press(); warning_overrides_playback_without_performing_stop(); warnings_rearm_after_loop_and_follow_tempo();
  std::puts("Native cue light tests passed.");
}
