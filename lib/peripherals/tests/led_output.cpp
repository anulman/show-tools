#include "led_output.h"
#include <array>
#include <cstdio>
#include <cstdlib>
#include <vector>

namespace {
void check(bool value, const char* reason) {
  if (!value) { std::fprintf(stderr, "%s\n", reason); std::abort(); }
}
}
int main() {
  using namespace peripheral_probe;
  std::vector<std::array<uint8_t, 5>> reports;
  auto record = [&](const uint8_t* bytes, size_t size) {
    check(size == 5, "Every command is report ID plus four data bytes");
    reports.push_back({bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]});
    return true;
  };
  struct Case { uint32_t channel; uint8_t opcode, mask; };
  for (auto c : {Case{0, 0x81, 1}, Case{7, 0x81, 128}, Case{8, 0x82, 1}, Case{63, 0x88, 128}, Case{64, 0x91, 1}, Case{95, 0x94, 128}}) {
    reports.clear();
    check(write_led_output({Mode::led_on, "unused", c.channel}, record) == 0, "Enable sequence succeeds");
    check(reports.size() == 2, "Enable precedes exactly one brightness command");
    check(reports[0] == std::array<uint8_t, 5>{3, c.opcode, c.mask, 0, 0}, "SDK group opcode and single-bit mask");
    check(reports[1] == std::array<uint8_t, 5>{3, uint8_t(c.channel), 255, 0, 0}, "Brightness targets selected channel");
  }
  reports.clear();
  check(write_led_output({Mode::led, "unused", 0, 0}, record) == 0, "Explicit off succeeds");
  check(reports == std::vector<std::array<uint8_t, 5>>{{3, 0, 0, 0, 0}}, "Brightness-only off does not change the enable mask");
  reports.clear();
  for (auto request : {Request{Mode::list, "unused"}, Request{Mode::led_on, "unused", 96}, Request{Mode::led, "unused", 0, 256}})
    check(write_led_output(request, record) == 2 && reports.empty(), "Invalid request writes nothing");
  unsigned calls = 0;
  check(write_led_output({Mode::led_pulse, "unused", 0}, [&](const uint8_t*, size_t) { return ++calls != 1; }) == 1 && calls == 1,
    "Failed enable prevents brightness writes");
  calls = 0;
  reports.clear();
  check(write_led_output({Mode::led_pulse, "unused", 0}, [&](const uint8_t* bytes, size_t size) {
    record(bytes, size); return ++calls != 2;
  }) == 1 && calls == 3, "Failed brightness stops the pulse and attempts off once");
  check(reports.back() == std::array<uint8_t, 5>{3, 0, 0, 0, 0}, "Failed pulse leaves an off request as its final write");
  for (unsigned cycle = 0; cycle < 4; ++cycle) {
    const unsigned origin = cycle * 100;
    check(bench_pulse_level(origin) == 255 && bench_pulse_level(origin + 50) == 0 && bench_pulse_level(origin + 100) == 255,
      "Each cycle starts fully on, fades to off, and returns fully on");
    for (unsigned step = 1; step <= 50; ++step) {
      check(bench_pulse_level(origin + step) <= bench_pulse_level(origin + step - 1), "Fade down never rises");
      check(bench_pulse_level(origin + 50 + step) >= bench_pulse_level(origin + 49 + step), "Fade up never falls");
    }
  }
  reports.clear();
  check(write_led_output({Mode::led_pulse, "unused", 0}, record) == 0, "Complete pulse sequence succeeds through fake transport");
  check(reports.size() == 403, "One enable, 401 brightness samples and an off request cover four cycles");
  check(reports.front() == std::array<uint8_t, 5>{3, 0x81, 1, 0, 0}, "Pulse begins by enabling only the selected group bit");
  for (unsigned cycle = 0; cycle < 4; ++cycle) {
    check(reports[1 + cycle * 100][2] == 255 && reports[51 + cycle * 100][2] == 0,
      "Transport receives each full-brightness peak and off trough");
  }
  check(reports.back() == std::array<uint8_t, 5>{3, 0, 0, 0, 0}, "Complete pulse leaves the selected channel off");
  std::puts("LED sequencing, transport failure, group boundaries, and four smooth cycles passed. No devices opened.");
}
