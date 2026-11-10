#include "control_stream.h"
#include <cstdlib>
#include <iostream>
#include <sstream>

void require(bool valid) { if (!valid) std::abort(); }
int main() {
  using namespace peripheral_host;
  ButtonKey selected = ButtonKey::Tab;
  const char* defaults[]{"host", "7", "0", "--confirm-wiring"}; int count = 4;
  require(parse_button_key_option(count, defaults, selected) && count == 4 && selected == ButtonKey::Tab);
  const char* escape[]{"host", "--inspect", "--button-key", "escape"}; count = 4;
  require(parse_button_key_option(count, escape, selected) && count == 2 && selected == ButtonKey::Escape);
  require(button_usage(selected) == 41 && linux_button_code(selected) == 1);
  const char* tab[]{"host", "--bench-held", "0", "--confirm-wiring", "--button-key", "tab"}; count = 6;
  require(parse_button_key_option(count, tab, selected) && count == 4 && selected == ButtonKey::Tab);
  require(button_usage(selected) == 43 && linux_button_code(selected) == 15);
  const char* invalid[]{"host", "--inspect", "--button-key", "enter"}; count = 4;
  require(!parse_button_key_option(count, invalid, selected));
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
