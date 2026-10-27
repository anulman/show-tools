#include "probe.h"
#include <charconv>
#include <chrono>
#include <iostream>
#include <system_error>

namespace peripheral_probe {
std::string quote(std::string_view text) {
  std::string out = "\"";
  const char* hex = "0123456789abcdef";
  for (unsigned char byte : text) {
    if (byte == '\\' || byte == '"') { out += '\\'; out += char(byte); }
    else if (byte < 32) { out += "\\u00"; out += hex[byte >> 4]; out += hex[byte & 15]; }
    else out += char(byte);
  }
  return out + '"';
}
uint64_t host_time_ns() {
  return uint64_t(std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now().time_since_epoch()).count());
}
}

namespace {
bool number(std::string_view value, uint32_t& out) {
  auto result = std::from_chars(value.data(), value.data() + value.size(), out);
  return result.ec == std::errc{} && result.ptr == value.data() + value.size();
}
void usage() {
  std::cout << "peripheral-probe list\n"
    "peripheral-probe listen <device-id|all-on-macOS>\n"
    "peripheral-probe led <device-id> <SDK-channel-0..95> <level-0..255> --confirm-wiring\n"
    "\nHelp and invalid commands never open hardware. list/listen are read-only.\n"
    "LED writes affect one brightness value only; they do not change firmware/maps.\n"
    "On macOS, device IDs come from list. On Linux, select the listed event/hidraw path.\n";
}
}
int main(int argc, char** argv) {
  using namespace peripheral_probe;
  if (argc == 1 || (argc == 2 && std::string_view(argv[1]) == "--help")) { usage(); return 0; }
  if (argc == 2 && std::string_view(argv[1]) == "list") return run({Mode::list, ""});
  if (argc == 3 && std::string_view(argv[1]) == "listen") return run({Mode::listen, argv[2]});
  if (argc == 6 && std::string_view(argv[1]) == "led" && std::string_view(argv[5]) == "--confirm-wiring") {
    Request request{Mode::led, argv[2]};
    if (number(argv[3], request.channel) && number(argv[4], request.level) && request.channel < 96 && request.level <= 255)
      return run(request);
  }
  std::cerr << "Invalid command. No device opened. Use --help.\n";
  return 2;
}
