#include "peripheral_controls.h"
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>

namespace {
std::array<double, 256> trace{};
uint32_t count = 0;
void check(bool value, const char* message) {
  if (!value) { std::fprintf(stderr, "%s\n", message); std::abort(); }
}
void observe(double value) { check(count < trace.size(), "trace capacity"); trace[count++] = value; }
void result(int actual, int expected, const char* message) { check(actual == expected, message); observe(actual); }
}

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
