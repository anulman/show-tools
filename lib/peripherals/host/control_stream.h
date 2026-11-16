#pragma once
#include "peripheral_light_delivery.h"
#include "performance_light_output.h"
#include <array>
#include <cstdint>
#include <optional>
#include <ostream>
#include <string>
#include <variant>
#include <vector>

namespace peripheral_host {
enum class PhysicalControl : uint8_t { Blue, Yellow, Red, Green, Pedal, Mushroom };
constexpr size_t physical_control_count = 6;
constexpr uint32_t physical_light_id(PhysicalControl control) { return 257 + uint32_t(control); }
const char* control_name(PhysicalControl control);
enum class Platform { Linux, MacOS };
struct LinuxSelector {
  uint32_t interface_number = 0;
  std::vector<uint16_t> event_types, key_codes, relative_axes;
};
struct HidSelector { uint32_t interface_number = 0, usage_page = 0, usage = 0; };
struct SourceSelector {
  std::string id;
  std::variant<LinuxSelector, HidSelector> selector;
};
struct SwitchBinding { PhysicalControl control; uint32_t source, type, code; };
struct AxisBinding { uint32_t source, type, code; };
struct LedBinding { PhysicalControl control; uint32_t sdk_channel; };
struct InputMap {
  std::vector<SourceSelector> sources;
  std::vector<SwitchBinding> switches;
  std::optional<AxisBinding> axis;
  std::vector<LedBinding> leds;
};
struct HostConfig { double session = 0; InputMap map; bool confirm_wiring = false, inspect = false; };
enum class InitialState { Unknown, Released, Held };
using InitialStates = std::array<InitialState, physical_control_count>;
// Parses all installation data before any adapter opens a device. Failure leaves out unchanged.
bool parse_host_config(int argc, const char* const* argv, Platform platform, HostConfig& out, std::string& error);
std::vector<pp_light_binding> light_bindings(const InputMap& map);
class PhysicalFeedback {
  const InitialStates& states_;
  std::array<uint8_t, physical_control_count> baseline_{};
public:
  explicit PhysicalFeedback(InitialStates& states) : states_(states) {}
  void clear_baseline();
  void commit_baseline(const std::vector<LedBinding>& leds, const pp_light_delivery_frame& frame);
  uint8_t level(PhysicalControl control) const;
  uint8_t level(PhysicalControl control, uint8_t candidate_baseline) const;
};
bool emit_ready(std::ostream& out, double session, const InputMap& map, const InitialStates& states);
bool emit_button(std::ostream& out, double session, double sequence, PhysicalControl control, bool down);
bool emit_motion(std::ostream& out, double session, double sequence, double delta_y);
bool emit_detached(std::ostream& out, double session);

enum class Operation { Bind, Light, Clear, Quit };
struct Command {
  Operation operation = Operation::Clear;
  pp_light_connection connection{};
  bool scoped = false;
  std::array<double, PF_LIGHT_FIELDS> image{};
};
bool same_connection(const pp_light_connection& first, const pp_light_connection& second);
bool parse_command(const std::string& line, Command& out);
}
