#pragma once
#include "peripheral_light_delivery.h"
#include "performance_light_output.h"
#include <array>
#include <string>

namespace peripheral_host {
enum class Operation { Bind, Light, Clear, Quit };
struct Command {
  Operation operation = Operation::Clear;
  pp_light_connection connection{};
  std::array<double, PF_LIGHT_FIELDS> image{};
};
bool parse_command(const std::string& line, Command& out);
}
