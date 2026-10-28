#ifndef SHOW_TOOLS_PERIPHERAL_PROBE_H
#define SHOW_TOOLS_PERIPHERAL_PROBE_H
#include <cstdint>
#include <string>
#include <string_view>

namespace peripheral_probe {
enum class Mode { list, listen, led, led_on, led_pulse };
inline bool led_mode(Mode mode) { return mode == Mode::led || mode == Mode::led_on || mode == Mode::led_pulse; }
struct Request { Mode mode; std::string device; uint32_t channel = 0, level = 0; };
std::string quote(std::string_view text);
uint64_t host_time_ns();
int run(const Request& request);
}
#endif
