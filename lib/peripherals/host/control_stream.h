#pragma once
#include "peripheral_light_delivery.h"
#include "performance_light_output.h"
#include <array>
#include <string>

namespace peripheral_host {
enum class ButtonKey { Tab, Escape };
constexpr unsigned button_usage(ButtonKey key) { return key == ButtonKey::Tab ? 43 : 41; }
constexpr unsigned linux_button_code(ButtonKey key) { return key == ButtonKey::Tab ? 15 : 1; }
constexpr const char* button_name(ButtonKey key) { return key == ButtonKey::Tab ? "tab" : "escape"; }
bool parse_button_key_option(int& argc, const char* const* argv, ButtonKey& key);

enum class Operation { Bind, Light, Clear, Quit };
struct Command {
  Operation operation = Operation::Clear;
  pp_light_connection connection{};
  std::array<double, PF_LIGHT_FIELDS> image{};
};
bool parse_command(const std::string& line, Command& out);
}
