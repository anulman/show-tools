#include "control_stream.h"
#include <algorithm>
#include <charconv>
#include <cmath>
#include <iomanip>
#include <set>
#include <sstream>
#include <tuple>

namespace peripheral_host {
namespace {
bool identity(double value) {
  return std::isfinite(value) && value >= 1 && value <= 9007199254740991. && std::floor(value) == value;
}
constexpr const char* names[]{"blue", "yellow", "red", "green", "pedal", "mushroom"};
bool natural(const std::string& text, uint32_t maximum, uint32_t& value) {
  if (text.empty()) return false;
  auto parsed = std::from_chars(text.data(), text.data() + text.size(), value);
  return parsed.ec == std::errc{} && parsed.ptr == text.data() + text.size() && value <= maximum;
}
bool capabilities(const std::string& text, std::vector<uint16_t>& values) {
  if (text == "-") return true;
  size_t begin = 0;
  while (begin < text.size()) {
    auto end = text.find(',', begin);
    uint32_t value = 0;
    if (!natural(text.substr(begin, end - begin), 65535, value)
      || (!values.empty() && value <= values.back()) || values.size() >= 1024) return false;
    values.push_back(uint16_t(value));
    if (end == std::string::npos) return true;
    begin = end + 1;
  }
  return false;
}
bool source_id(const std::string& text) {
  return !text.empty() && text.size() <= 32 && std::all_of(text.begin(), text.end(), [](char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
  });
}
std::optional<PhysicalControl> control(const std::string& text) {
  for (size_t index = 0; index < physical_control_count; ++index)
    if (text == names[index]) return PhysicalControl(index);
  return std::nullopt;
}
}
const char* control_name(PhysicalControl control) {
  return uint32_t(control) < physical_control_count ? names[uint32_t(control)] : "invalid";
}

bool parse_host_config(int argc, const char* const* argv, Platform platform, HostConfig& out, std::string& error) {
  HostConfig parsed;
  auto fail = [&](const char* message) { error = message; return false; };
  if (argc == 2 && std::string(argv[1]) == "--inspect") {
    parsed.inspect = true; out = parsed; error.clear(); return true;
  }
  if (argc < 4) return fail("Use SESSION --map-version 2 and explicit source/control mappings.");
  const std::string session(argv[1]);
  uint64_t session_number = 0;
  auto number = std::from_chars(session.data(), session.data() + session.size(), session_number);
  if (number.ec != std::errc{} || number.ptr != session.data() + session.size()
    || !session_number || session_number > 9007199254740991ULL) return fail("Invalid session identity.");
  parsed.session = double(session_number);
  struct PendingInput { std::optional<PhysicalControl> control; std::string source; uint32_t type, code; };
  std::vector<PendingInput> pending;
  bool version = false;
  for (int index = 2; index < argc;) {
    const std::string option(argv[index++]);
    auto available = [&](int count) { return count <= argc - index; };
    if (option == "--map-version") {
      if (!available(1) || version || std::string(argv[index++]) != "2") return fail("Require one --map-version 2.");
      version = true;
    } else if (option == "--confirm-wiring") {
      if (parsed.confirm_wiring) return fail("Duplicate wiring confirmation.");
      parsed.confirm_wiring = true;
    } else if (option == "--linux-source" || option == "--hid-source") {
      const bool linux_source = option == "--linux-source";
      if ((platform == Platform::Linux) != linux_source || !available(linux_source ? 5 : 4)) return fail("Invalid source selector for this platform.");
      SourceSelector source; source.id = argv[index++];
      uint32_t interface_number = 0;
      if (!source_id(source.id) || parsed.map.sources.size() >= 8
        || !natural(argv[index++], 255, interface_number)) return fail("Invalid source ID or USB interface number.");
      for (const auto& prior : parsed.map.sources) if (source.id == prior.id) return fail("Duplicate source ID.");
      if (linux_source) {
        LinuxSelector selector; selector.interface_number = interface_number;
        if (!capabilities(argv[index++], selector.event_types) || !capabilities(argv[index++], selector.key_codes)
          || !capabilities(argv[index++], selector.relative_axes)) return fail("Capability sets must be sorted unique decimal lists or '-'.");
        if (selector.event_types.empty()) return fail("A Linux source requires event capabilities.");
        source.selector = std::move(selector);
      } else {
        HidSelector selector; selector.interface_number = interface_number;
        if (!natural(argv[index++], 65535, selector.usage_page) || !selector.usage_page
          || !natural(argv[index++], 65535, selector.usage) || !selector.usage) return fail("Invalid HID collection usage.");
        source.selector = selector;
      }
      for (const auto& prior : parsed.map.sources) {
        if (auto selector = std::get_if<LinuxSelector>(&source.selector)) {
          const auto& other = std::get<LinuxSelector>(prior.selector);
          if (selector->interface_number == other.interface_number && selector->event_types == other.event_types
            && selector->key_codes == other.key_codes && selector->relative_axes == other.relative_axes)
            return fail("Duplicate Linux source selector.");
        } else {
          const auto& hid = std::get<HidSelector>(source.selector);
          const auto& other = std::get<HidSelector>(prior.selector);
          if (hid.interface_number == other.interface_number && hid.usage_page == other.usage_page
            && hid.usage == other.usage) return fail("Duplicate HID source selector.");
        }
      }
      parsed.map.sources.push_back(std::move(source));
    } else if (option == "--switch" || option == "--axis") {
      if (!available(4) || pending.size() >= physical_control_count + 1) return fail("Incomplete or excessive input mapping.");
      const std::string name(argv[index++]);
      const auto id = control(name);
      if ((option == "--switch" && !id) || (option == "--axis" && name != "knob")) return fail("Unknown physical control.");
      PendingInput input{id, argv[index++], 0, 0};
      if (!natural(argv[index++], 65535, input.type) || !natural(argv[index++], 65535, input.code)) return fail("Invalid raw input type or code.");
      pending.push_back(std::move(input));
    } else if (option == "--led") {
      if (!available(2) || parsed.map.leds.size() >= physical_control_count) return fail("Incomplete or excessive LED mapping.");
      auto id = control(argv[index++]); uint32_t channel = 0;
      if (!id || !natural(argv[index++], 95, channel)) return fail("Invalid physical LED or SDK channel.");
      parsed.map.leds.push_back({*id, channel});
    } else return fail("Unknown map option; anonymous button-key defaults are not supported.");
  }
  if (!version || pending.empty() || parsed.map.sources.empty()) return fail("Require version 2, a source and an explicit input mapping.");
  if (!parsed.map.leds.empty() && !parsed.confirm_wiring) return fail("LED mapping requires explicit --confirm-wiring.");
  std::set<PhysicalControl> switches, leds;
  std::set<uint32_t> channels, used_sources;
  std::set<std::tuple<uint32_t, uint32_t, uint32_t>> raw;
  for (const auto& input : pending) {
    auto source = std::find_if(parsed.map.sources.begin(), parsed.map.sources.end(), [&](const SourceSelector& value) { return value.id == input.source; });
    if (source == parsed.map.sources.end()) return fail("Input refers to an undeclared source.");
    const uint32_t source_index = uint32_t(source - parsed.map.sources.begin());
    if (!raw.emplace(source_index, input.type, input.code).second) return fail("A raw input can identify only one physical control.");
    if (auto linux_selector = std::get_if<LinuxSelector>(&source->selector)) {
      const auto& codes = input.control ? linux_selector->key_codes : linux_selector->relative_axes;
      if (input.type != (input.control ? 1u : 2u)
        || !std::binary_search(linux_selector->event_types.begin(), linux_selector->event_types.end(), input.type)
        || !std::binary_search(codes.begin(), codes.end(), input.code)) return fail("Input is absent from the declared Linux capabilities.");
    } else if (!input.type || !input.code) return fail("HID element usage page and usage must be positive.");
    used_sources.insert(source_index);
    if (input.control) {
      if (!switches.insert(*input.control).second) return fail("Duplicate physical switch.");
      parsed.map.switches.push_back({*input.control, source_index, input.type, input.code});
    } else {
      if (parsed.map.axis) return fail("Duplicate knob axis.");
      parsed.map.axis = AxisBinding{source_index, input.type, input.code};
    }
  }
  if (used_sources.size() != parsed.map.sources.size()) return fail("Every declared source must supply an input.");
  for (const auto& led : parsed.map.leds)
    if (!leds.insert(led.control).second || !channels.insert(led.sdk_channel).second) return fail("Duplicate LED identity or SDK channel.");
  std::sort(parsed.map.switches.begin(), parsed.map.switches.end(), [](const SwitchBinding& a, const SwitchBinding& b) { return a.control < b.control; });
  std::sort(parsed.map.leds.begin(), parsed.map.leds.end(), [](const LedBinding& a, const LedBinding& b) { return a.control < b.control; });
  out = std::move(parsed); error.clear(); return true;
}

std::vector<pp_light_binding> light_bindings(const InputMap& map) {
  std::vector<pp_light_binding> bindings;
  for (const auto& led : map.leds) bindings.push_back({physical_light_id(led.control), led.sdk_channel});
  return bindings;
}
bool emit_ready(std::ostream& out, double session, const InputMap& map, const InitialStates& states) {
  if (!identity(session)) return false;
  out << std::setprecision(17) << "{\"type\":\"ready\",\"version\":2,\"session\":" << session << ",\"switches\":[";
  bool first = true;
  for (const auto& binding : map.switches) {
    if (!first) out << ',';
    first = false;
    const auto state = states[size_t(binding.control)];
    out << "{\"controlId\":\"" << control_name(binding.control) << "\",\"state\":\""
      << (state == InitialState::Released ? "released" : state == InitialState::Held ? "held" : "unknown") << "\"}";
  }
  out << "]}" << std::endl; return out.good();
}
bool emit_button(std::ostream& out, double session, double sequence, PhysicalControl control, bool down) {
  if (!identity(session) || !identity(sequence) || uint32_t(control) >= physical_control_count) return false;
  out << std::setprecision(17) << "{\"type\":\"button\",\"session\":" << session << ",\"sequence\":" << sequence
    << ",\"controlId\":\"" << control_name(control) << "\",\"down\":" << (down ? "true" : "false") << "}" << std::endl;
  return out.good();
}
bool emit_motion(std::ostream& out, double session, double sequence, double delta_y) {
  if (!identity(session) || !identity(sequence) || !std::isfinite(delta_y)) return false;
  out << std::setprecision(17) << "{\"type\":\"motion\",\"session\":" << session << ",\"sequence\":" << sequence
    << ",\"deltaY\":" << delta_y << "}" << std::endl; return out.good();
}
bool emit_detached(std::ostream& out, double session) {
  if (!identity(session)) return false;
  out << std::setprecision(17) << "{\"type\":\"detached\",\"session\":" << session << "}" << std::endl; return out.good();
}
bool parse_button_key_option(int& argc, const char* const* argv, ButtonKey& key) {
  if (argc < 3 || std::string(argv[argc - 2]) != "--button-key") return true;
  const std::string name(argv[argc - 1]);
  if (name == "tab") key = ButtonKey::Tab;
  else if (name == "escape") key = ButtonKey::Escape;
  else return false;
  argc -= 2;
  return true;
}

bool parse_command(const std::string& line, Command& out) {
  if (line.size() > 16384) return false;
  std::istringstream input(line);
  std::string name, extra;
  if (!(input >> name)) return false;
  Command parsed;
  if (name == "clear") parsed.operation = Operation::Clear;
  else if (name == "quit") parsed.operation = Operation::Quit;
  else if (name == "bind" || name == "light") {
    parsed.operation = name == "bind" ? Operation::Bind : Operation::Light;
    auto& c = parsed.connection;
    if (!(input >> c.engine_incarnation >> c.device_session >> c.binding_revision >> c.request_fence)
      || !identity(c.engine_incarnation) || !identity(c.device_session)
      || !identity(c.binding_revision) || !identity(c.request_fence)) return false;
    if (parsed.operation == Operation::Light)
      for (auto& value : parsed.image) if (!(input >> value) || !std::isfinite(value)) return false;
  } else return false;
  if (input >> extra) return false;
  out = parsed;
  return true;
}
}
