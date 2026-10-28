#include "led_output.h"
#include "peripheral_controls.h"
#include <chrono>
#include <cmath>
#include <iostream>
#include <thread>

namespace peripheral_probe {
uint32_t bench_pulse_level(unsigned step) {
  constexpr double tau = 6.2831853071795864769;
  return uint32_t(std::lround(255 * (1 + std::cos(tau * (step % 100) / 100.0)) / 2));
}

int write_led_output(const Request& request, const LedWriter& write) {
  if (!led_mode(request.mode) || request.channel >= 96 || request.level > 255) return 2;
  uint32_t reports = 0;
  auto send = [&](const uint8_t* bytes) {
    if (!write(bytes, PP_LED_REPORT_BYTES)) return false;
    ++reports;
    return true;
  };
  auto brightness = [&](uint32_t level) {
    uint8_t bytes[PP_LED_REPORT_BYTES];
    pp_ipac_led_report(request.channel, level, bytes);
    return send(bytes);
  };
  if (request.mode != Mode::led) {
    const uint32_t group = request.channel / 8 + 1;
    uint8_t enable[] = {3, uint8_t(0x80 | (group > 8 ? group + 8 : group)), uint8_t(1u << (request.channel % 8)), 0, 0};
    std::cerr << "Enable SDK channel " << request.channel << "; other outputs in SDK group "
      << request.channel / 8 * 8 << ".." << request.channel / 8 * 8 + 7 << " are disabled.\n";
    if (!send(enable)) return 1;
  }
  if (request.mode == Mode::led_pulse) {
    const auto start = std::chrono::steady_clock::now();
    for (unsigned step = 0; step <= 400; ++step) {
      std::this_thread::sleep_until(start + std::chrono::milliseconds(step * 24));
      if (!brightness(bench_pulse_level(step))) return 1;
    }
  } else if (!brightness(request.mode == Mode::led_on ? 255 : request.level)) return 1;
  std::cout << "{\"type\":\"led-write\",\"channel\":" << request.channel
    << ",\"level\":" << (request.mode == Mode::led ? request.level : 255)
    << ",\"operation\":\"" << (request.mode == Mode::led ? "brightness" : request.mode == Mode::led_on ? "on" : "pulse")
    << "\",\"reports\":" << reports << "}\n";
  return 0;
}
}
