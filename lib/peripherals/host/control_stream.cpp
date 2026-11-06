#include "control_stream.h"
#include <cmath>
#include <sstream>

namespace peripheral_host {
namespace {
bool identity(double value) {
  return std::isfinite(value) && value >= 1 && value <= 9007199254740991. && std::floor(value) == value;
}
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
