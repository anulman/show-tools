#include "control_stream.h"
#include <cstdlib>
#include <iostream>
#include <sstream>
#include <vector>

void require(bool valid) { if (!valid) std::abort(); }
void map_checks() {
  using namespace peripheral_host;
  auto parse = [](std::vector<std::string> args, Platform platform, HostConfig& out) {
    std::vector<const char*> pointers;
    for (const auto& arg : args) pointers.push_back(arg.c_str());
    std::string error;
    const bool accepted = parse_host_config(int(pointers.size()), pointers.data(), platform, out, error);
    require(accepted == error.empty());
    return accepted;
  };
  // Synthetic capabilities and usages; these are not a device wiring assignment.
  const std::vector<std::string> linux{"host", "7", "--map-version", "2",
    "--linux-source", "keys", "2", "0,1", "41,42", "-",
    "--linux-source", "motion", "3", "0,2", "-", "1",
    "--switch", "yellow", "keys", "1", "42", "--switch", "blue", "keys", "1", "41",
    "--axis", "knob", "motion", "2", "1"};
  HostConfig map;
  require(parse(linux, Platform::Linux, map));
  require(map.session == 7 && map.map.sources.size() == 2 && map.map.switches.size() == 2);
  require(map.map.switches[0].control == PhysicalControl::Blue && map.map.axis->source == 1);
  require(map.map.leds.empty() && light_bindings(map.map).empty());
  auto add = [&](std::initializer_list<const char*> extra) {
    auto args = linux; for (auto value : extra) args.emplace_back(value); return args;
  };
  require(!parse(linux, Platform::MacOS, map));
  require(!parse(add({"--led", "blue", "0"}), Platform::Linux, map));
  require(parse(add({"--led", "yellow", "1", "--led", "blue", "0", "--confirm-wiring"}), Platform::Linux, map));
  auto lights = light_bindings(map.map);
  require(lights.size() == 2 && lights[0].led_id == 257 && lights[0].sdk_channel == 0
    && lights[1].led_id == 258 && lights[1].sdk_channel == 1);
  require(!parse(add({"--led", "blue", "0", "--led", "yellow", "0", "--confirm-wiring"}), Platform::Linux, map));
  require(!parse(add({"--switch", "blue", "keys", "1", "42"}), Platform::Linux, map));
  require(!parse(add({"--switch", "red", "keys", "1", "41"}), Platform::Linux, map));
  require(!parse(add({"--switch", "red", "missing", "1", "99"}), Platform::Linux, map));
  require(!parse(add({"--switch", "red", "keys", "1", "99"}), Platform::Linux, map));
  require(!parse(add({"--axis", "knob", "motion", "2", "1"}), Platform::Linux, map));
  require(!parse(add({"--map-version", "2"}), Platform::Linux, map));
  require(!parse(add({"--button-key", "tab"}), Platform::Linux, map));
  require(!parse(add({"--linux-source", "unused", "4", "0,1", "41", "-"}), Platform::Linux, map));
  require(!parse(add({"--linux-source", "alias", "2", "0,1", "41,42", "-", "--switch", "red", "alias", "1", "41"}), Platform::Linux, map));
  for (auto invalid : {"42,41", "41,41", "41,", "-1", "65536", ""}) {
    auto args = linux; args[9] = invalid;
    require(!parse(args, Platform::Linux, map));
  }
  const std::vector<std::string> hid{"host", "8", "--map-version", "2", "--hid-source", "keys", "2", "1", "6",
    "--switch", "blue", "keys", "7", "41"};
  require(parse(hid, Platform::MacOS, map));
  require(std::get<HidSelector>(map.map.sources[0].selector).usage == 6);
  const auto previous_session = map.session;
  require(!parse({"host", "8", "0", "--confirm-wiring"}, Platform::MacOS, map));
  require(map.session == previous_session && map.map.switches.size() == 1);
  require(!parse(hid, Platform::Linux, map));
  InitialStates states{}; states[0] = InitialState::Released;
  std::ostringstream ready, button, motion, detached;
  require(emit_ready(ready, 8, map.map, states));
  require(ready.str() == "{\"type\":\"ready\",\"version\":2,\"session\":8,\"switches\":[{\"controlId\":\"blue\",\"state\":\"released\"}]}\n");
  require(emit_button(button, 8, 100, PhysicalControl::Blue, true));
  require(button.str() == "{\"type\":\"button\",\"session\":8,\"sequence\":100,\"controlId\":\"blue\",\"down\":true}\n");
  require(emit_motion(motion, 8, 101, -.125) && motion.str().find("\"deltaY\":-0.125") != std::string::npos);
  require(emit_detached(detached, 8) && detached.str() == "{\"type\":\"detached\",\"session\":8}\n");
  require(!emit_button(button, 8, 0, PhysicalControl::Blue, false));
  require(parse({"host", "--inspect"}, Platform::Linux, map) && map.inspect && map.map.sources.empty());
}
int main() {
  map_checks();
  using namespace peripheral_host;
  Command command;
  require(parse_command("bind 1 2 3 4", command));
  require(command.operation == Operation::Bind && command.connection.device_session == 2);
  require(!parse_command("bind 0 2 3 4", command));
  require(!parse_command("bind 1 2 3 4 extra", command));
  require(!parse_command("bind 1 2 3 nan", command));
  require(!parse_command("bind 1 2 3 9007199254740992", command));
  std::ostringstream light; light << "light 1 2 3 4";
  for (int index = 0; index < PF_LIGHT_FIELDS; ++index) light << " " << index;
  require(parse_command(light.str(), command));
  require(command.operation == Operation::Light && command.image.back() == PF_LIGHT_FIELDS - 1);
  require(!parse_command(light.str() + " 0", command));
  require(!parse_command("light 1 2 3 4 1", command));
  require(parse_command("clear", command));
  require(parse_command("quit", command));
  require(!parse_command("clear 1", command));
  require(!parse_command(std::string(16385, ' '), command));
  std::cout << "Peripheral host command checks passed.\n";
}
