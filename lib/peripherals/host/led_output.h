#ifndef SHOW_TOOLS_PERIPHERAL_LED_OUTPUT_H
#define SHOW_TOOLS_PERIPHERAL_LED_OUTPUT_H
#include "probe.h"
#include <cstddef>
#include <functional>

namespace peripheral_probe {
using LedWriter = std::function<bool(const uint8_t*, size_t)>;
uint32_t bench_pulse_level(unsigned step);
int write_led_output(const Request& request, const LedWriter& write);
}
#endif
