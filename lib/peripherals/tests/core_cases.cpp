#include "peripheral_controls.h"
#include "peripheral_lights.h"
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>

namespace {
std::array<double, 2048> trace{};
uint32_t count = 0;
void check(bool value, const char* message) {
  if (!value) { std::fprintf(stderr, "%s\n", message); std::abort(); }
}
void observe(double value) { check(count < trace.size(), "trace capacity"); trace[count++] = value; }
void result(int actual, int expected, const char* message) { check(actual == expected, message); observe(actual); }
}

void pp_run_delivery_cases(void (*observe)(double));

extern "C" int pp_run_cases() {
  count = 0;
  auto* input = pp_create();
  check(input, "input preparation");
  result(pp_begin(input, 1, 1, 2), 0, "explicit initial states");
  result(pp_key(input, 1, 0, 0, 1), PP_PRESS, "known released first press");
  result(pp_key(input, 1, 1, 0, 1), PP_IGNORED, "held repeat ignored");
  result(pp_key(input, 1, 2, 0, 0), PP_RELEASE, "release retained");
  result(pp_key(input, 1, 3, 0, 1), PP_PRESS, "second press");
  result(pp_key(input, 1, 4, 1, 1), PP_IGNORED, "initial held disarmed");
  result(pp_key(input, 1, 5, 1, 0), PP_IGNORED, "initial held release rearms");
  result(pp_key(input, 1, 6, 1, 1), PP_PRESS, "held reconnect accepts fresh press");
  result(pp_key(input, 1, 7, 2, 1), PP_IGNORED, "unknown initial down disarmed");
  result(pp_key(input, 1, 8, 2, 0), PP_IGNORED, "unknown release rearms");
  result(pp_key(input, 1, 9, 2, 1), PP_PRESS, "unknown fresh press");
  result(pp_rotate(input, 1, 10, 12), PP_MOVEMENT, "positive rotation");
  observe(12);
  result(pp_rotate(input, 1, 11, -8.5), PP_MOVEMENT, "signed distance retained");
  observe(-8.5);
  result(pp_rotate(input, 1, 12, 0), PP_IGNORED, "zero consumes sequence");
  result(pp_rotate(input, 1, 12, 2), PP_STALE, "same sequence not replayed");
  result(pp_rotate(input, 1, 9, 2), PP_STALE, "older sequence rejected");
  result(pp_key(input, 1, 13, 32, 1), PP_INVALID, "invalid slot leaves sequence unchanged");
  result(pp_rotate(input, 1, 13, std::numeric_limits<double>::infinity()), PP_INVALID, "invalid rotation leaves sequence unchanged");
  result(pp_key(input, 1, 13, 0, 0), PP_RELEASE, "valid observation retains rejected sequence");
  result(pp_begin(input, 1, 7, 0), PP_STALE, "duplicate session cannot clear latches");
  result(pp_begin(input, 2, 1, 2), 0, "explicit reconnect");
  result(pp_key(input, 1, 99, 0, 1), PP_STALE, "old session rejected");
  result(pp_key(input, 2, 0, 0, 1), PP_PRESS, "new session first press");
  result(pp_key(input, 2, 1, 0, 1), PP_IGNORED, "binding change never implies key release");
  result(pp_begin(input, 3, 1, 1), PP_INVALID, "contradictory initial state rejected");
  result(pp_key(input, 2, 2, 0, 0), PP_RELEASE, "invalid reconnect preserves active session");
  pp_destroy(input);

  for (int pattern : {PP_PULSE, PP_BLINK}) {
    for (double time : {-1., 0., 1., 2., 3., 4., 8.}) {
      double value = pp_pattern_value(pattern, time, 4, .1, .9, .5);
      check(value >= .1 && value <= .9, "explicit pattern range");
      observe(value);
    }
  }
  check(pp_pattern_value(PP_BLINK, 1, 4, 0, 1, .5) == 1, "blink on interval");
  check(pp_pattern_value(PP_BLINK, 2, 4, 0, 1, .5) == 0, "blink boundary");
  check(pp_pattern_value(PP_PULSE, 2, 4, 0, 1, .5) == 1, "pulse peak");
  check(pp_pattern_value(PP_PULSE, 0, 0, 0, 1, .5) < 0, "missing period rejected");
  check(pp_pattern_value(PP_BLINK, 0, 4, 0, 1, 1) < 0, "invalid duty rejected");
  check(pp_pattern_value(PP_OFF, 0, 0, 0, 1, 0) == 0, "inactive exact off");
  check(pp_pattern_value(PP_SOLID, 0, 0, 0, 1, 0) == 1, "playing exact solid");
  for (double baseline : {0., .5, 1.}) {
    for (double time : {-1., 0., 1., 2., 3., 4., 6., 8.}) observe(pp_trigger_value(time, 2, 2, 4, 1, baseline));
    check(pp_trigger_value(8, 2, 2, 4, 1, baseline) == baseline, "expiry reveals CURRENT baseline");
  }
  check(pp_trigger_value(1, 2, 2, 4, 1, 0) == .5, "trigger attack");
  check(pp_trigger_value(6, 2, 2, 4, 1, 1) == .5, "baseline changed during active replace envelope");
  check(pp_trigger_value(8, 2, 2, 4, 1, 1) == 1, "new playing baseline exposed at expiry");
  check(pp_trigger_value(8, 2, 2, 4, 1, 0) == 0, "new inactive baseline exposed at same expiry");
  check(pp_trigger_value(3, 2, 2, 4, 1, 0) == 1, "trigger hold");
  check(pp_trigger_value(6, 2, 2, 4, 1, 0) == .5, "trigger decay");
  check(pp_trigger_value(0, 0, 0, 2, 1, 0) == 1, "zero attack and hold supported");
  check(pp_trigger_value(0, 0, 0, 0, 1, 0) < 0, "empty envelope rejected");
  for (double time : {0., .3, 1.7, 8.}) {
    double first = pp_trigger_value(time, 2, 2, 4, 1, .5);
    check(first == pp_trigger_value(time, 2, 2, 4, 1, .5), "duplicate snapshot and consumer cadence cannot restart time");
  }
  const pp_light_levels fixture_levels{.125, .45, .9};
  pp_light_recipe recipe{};
  pp_light_sample sample{99, .3};
  auto evaluate = [&](double position) {
    check(pp_light_evaluate(&recipe, position, &sample) == 0, "light recipe samples successfully");
    check(sample.led_id == recipe.led_id && std::isfinite(sample.level) && sample.level >= 0 && sample.level <= 1,
      "opaque identity and normalized output preserved");
    return sample.level;
  };
  for (int strength : {PP_LIGHT_LOW, PP_LIGHT_MID, PP_LIGHT_MAX}) {
    check(pp_light_on(UINT32_MAX, strength, &fixture_levels, &recipe) == 0, "named level constructor");
    const double expected = strength == PP_LIGHT_LOW ? .125 : strength == PP_LIGHT_MID ? .45 : .9;
    check(evaluate(-200) == expected && evaluate(200) == expected, "steady output ignores elapsed time");
    observe(sample.level);
  }
  check(pp_light_off(17, &recipe) == 0 && evaluate(100) == 0, "off keeps its logical ID and extinguishes output");
  check(pp_light_pulse(17, PP_LIGHT_MAX, &fixture_levels, -4.25, 2, &recipe) == 0, "explicit fractional origin retained");
  check(recipe.origin_beat == -4.25 && recipe.period_beats == 2, "constructor neither quantizes nor rephases");
  for (int cycle : {-2, -1, 0, 1, 2}) {
    double start = recipe.origin_beat + cycle * recipe.period_beats;
    check(evaluate(start) == .9, "pulse period boundary is peak, including pre-origin periods");
    check(std::abs(evaluate(start + .5) - .45) < 1e-12, "cosine quarter-period midpoint");
    check(evaluate(start + 1) == 0, "smooth pulse trough at half period");
    observe(evaluate(start + 1.5));
    check(std::abs(sample.level - .45) < 1e-12, "cosine three-quarter-period midpoint");
  }
  const double repeated = evaluate(-3.87);
  check(evaluate(-3.87) == repeated, "duplicate observations cannot restart phase");
  evaluate(900);
  check(evaluate(-3.87) == repeated, "skipped, reordered, and differently paced samples retain absolute phase");
  const double epsilon = 1e-5;
  check(std::abs(evaluate(recipe.origin_beat + epsilon) - evaluate(recipe.origin_beat)) / epsilon < 1e-4,
    "pulse has a smooth peak rather than a triangular corner");
  check(std::abs(evaluate(recipe.origin_beat + 1 + epsilon) - evaluate(recipe.origin_beat + 1)) / epsilon < 1e-4,
    "pulse has a smooth trough");
  check(pp_light_blink(8, PP_LIGHT_MID, &fixture_levels, 12, .5, .25, &recipe) == 0, "fractional-beat blink period");
  check(evaluate(12) == .45 && evaluate(12.124) == .45, "blink begins on");
  check(evaluate(12.125) == 0 && evaluate(12.499) == 0, "duty boundary is off");
  check(evaluate(12.5) == .45 && evaluate(11.5) == .45, "blink period endpoint and pre-origin wrap");
  observe(evaluate(12.25));
  const pp_light_recipe saved = recipe;
  auto unchanged = [&] {
    check(recipe.led_id == saved.led_id && recipe.kind == saved.kind && recipe.level == saved.level &&
      recipe.origin_beat == saved.origin_beat && recipe.period_beats == saved.period_beats && recipe.duty == saved.duty,
      "invalid constructor leaves recipe unchanged");
  };
  for (double period : {0., -1., std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN()}) {
    check(pp_light_pulse(9, PP_LIGHT_MAX, &fixture_levels, 0, period, &recipe) == PP_INVALID, "invalid pulse period rejected");
    unchanged();
  }
  for (double duty : {0., 1., -1., std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN()}) {
    check(pp_light_blink(9, PP_LIGHT_MAX, &fixture_levels, 0, 1, duty, &recipe) == PP_INVALID, "duty endpoints require off or steady instead");
    unchanged();
  }
  for (const auto levels : {pp_light_levels{.6, .3, 1}, pp_light_levels{0, .3, 1.1},
      pp_light_levels{-1, .3, 1}, pp_light_levels{0, std::numeric_limits<double>::quiet_NaN(), 1}}) {
    check(pp_light_on(9, PP_LIGHT_LOW, &levels, &recipe) == PP_INVALID, "invalid level table rejected");
    unchanged();
  }
  check(pp_light_on(9, 3, &fixture_levels, &recipe) == PP_INVALID, "unknown named level rejected"); unchanged();
  check(pp_light_on(9, PP_LIGHT_LOW, nullptr, &recipe) == PP_INVALID, "missing level table rejected"); unchanged();
  check(pp_light_pulse(9, PP_LIGHT_LOW, &fixture_levels, std::numeric_limits<double>::infinity(), 1, &recipe) == PP_INVALID,
    "nonfinite origin rejected"); unchanged();
  check(pp_light_off(9, nullptr) == PP_INVALID && pp_light_on(9, PP_LIGHT_LOW, &fixture_levels, nullptr) == PP_INVALID,
    "missing constructor output rejected");
  auto rejected_sample = [&](const pp_light_recipe* input, double position) {
    sample = {42, .25};
    check(pp_light_evaluate(input, position, &sample) == PP_INVALID, "invalid recipe or sample time rejected");
    check(sample.led_id == 42 && sample.level == .25, "invalid sampling leaves output unchanged");
  };
  rejected_sample(nullptr, 0);
  rejected_sample(&recipe, std::numeric_limits<double>::quiet_NaN());
  rejected_sample(&recipe, std::numeric_limits<double>::infinity());
  recipe.kind = 99; rejected_sample(&recipe, 12); recipe = saved;
  recipe.level = -1; rejected_sample(&recipe, 12); recipe = saved;
  recipe.period_beats = 0; rejected_sample(&recipe, 12); recipe = saved;
  recipe.duty = 1; rejected_sample(&recipe, 12); recipe = saved;
  recipe.origin_beat = -std::numeric_limits<double>::max();
  rejected_sample(&recipe, std::numeric_limits<double>::max());
  check(pp_light_evaluate(&saved, 12, nullptr) == PP_INVALID, "missing sample output rejected");
  check(pp_light_pulse(17, PP_LIGHT_MAX, &fixture_levels, 100, 2, &recipe) == 0 && evaluate(100) == .9,
    "caller can create a new origin explicitly on restart");
  const double restarted = evaluate(100.5);
  check(std::abs(restarted - .45) < 1e-12, "new recipe samples from caller-supplied restart origin");
  observe(restarted);
  std::array<uint8_t, 5> report{};
  result(pp_ipac_led_report(0, 128, report.data()), 5, "SDK report encoding");
  for (auto byte : report) observe(byte);
  check(report == std::array<uint8_t, 5>{3, 0, 128, 0, 0}, "exact manufacturer report layout");
  result(pp_ipac_led_report(95, 255, report.data()), 5, "last supported LED");
  result(pp_ipac_led_report(96, 0, report.data()), PP_INVALID, "PCB labels cannot bypass SDK channel bounds");
  result(pp_ipac_led_report(0, 256, report.data()), PP_INVALID, "brightness bounds");
  std::array<uint8_t, 15> descriptor{0x05, 1, 0x09, 0, 0xa1, 1, 0x85, 3, 0x75, 8, 0x95, 4, 0x91, 2, 0xc0};
  result(pp_ipac_led_descriptor(descriptor.data(), descriptor.size()), 1, "observed Output report 3 has four data bytes");
  result(pp_ipac_led_descriptor(descriptor.data(), descriptor.size() - 1), PP_INVALID, "unclosed collection rejected");
  descriptor[7] = 4;
  result(pp_ipac_led_descriptor(descriptor.data(), descriptor.size()), 0, "different report ID unsupported");
  descriptor[7] = 3; descriptor[11] = 96;
  result(pp_ipac_led_descriptor(descriptor.data(), descriptor.size()), 0, "different output length unsupported");
  descriptor[11] = 4; descriptor[0] = 0xfe;
  result(pp_ipac_led_descriptor(descriptor.data(), descriptor.size()), PP_INVALID, "unsupported long item cannot authorize output");
  result(pp_ipac_led_descriptor(nullptr, 15), PP_INVALID, "missing descriptor rejected");
  descriptor = {0x05, 1, 0x09, 0, 0xa1, 1, 0x85, 3, 0x75, 8, 0x95, 4, 0x91, 3, 0xc0};
  result(pp_ipac_led_descriptor(descriptor.data(), descriptor.size()), 0, "constant output cannot authorize a command");
  std::array<uint8_t, 14> empty_output{0x05, 1, 0x09, 0, 0xa1, 1, 0x85, 3, 0x75, 8, 0x95, 4, 0x90, 0xc0};
  result(pp_ipac_led_descriptor(empty_output.data(), empty_output.size()), PP_INVALID, "empty Main Output rejected");
  std::array<uint8_t, 14> empty_collection{0x05, 1, 0x09, 0, 0xa0, 0x85, 3, 0x75, 8, 0x95, 4, 0x91, 2, 0xc0};
  result(pp_ipac_led_descriptor(empty_collection.data(), empty_collection.size()), PP_INVALID, "empty Main Collection rejected");
  pp_run_delivery_cases(observe);
  return int(count);
}
extern "C" double pp_case_value(uint32_t index) { return index < count ? trace[index] : -999; }
#ifndef PP_WASM_CASES
int main() {
  pp_run_cases();
  std::puts("[");
  for (uint32_t index = 0; index < count; ++index) std::printf("%.17g%s\n", trace[index], index + 1 == count ? "" : ",");
  std::puts("]");
}
#endif
