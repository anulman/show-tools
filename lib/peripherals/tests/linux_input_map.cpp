#include "linux_input_map.h"
#include <cstdio>
#include <cstdlib>
using namespace peripheral_host;
void require(bool condition, const char* message) { if (!condition) { std::fprintf(stderr, "%s\n", message); std::abort(); } }
int main() {
  // Synthetic selectors only: none describe accepted operator wiring.
  const LinuxSelector first{2, {0, 1}, {30, 48}, {}};
  const LinuxSelector second{7, {0, 1}, {30, 48}, {}};
  InputMap map;
  map.sources = {{"sourceA", first}, {"sourceB", second}};
  map.switches = {{PhysicalControl::Blue, 0, 1, 30}, {PhysicalControl::Yellow, 1, 1, 30}};
  std::vector<size_t> selected{99};
  require(qualify_linux_sources(map, {second, first}, selected) && selected == std::vector<size_t>{1, 0},
    "discovery order and runtime paths do not change stable interface selection");
  require(linux_switch(map, 0, 1, 30)->control == PhysicalControl::Blue
    && linux_switch(map, 1, 1, 30)->control == PhysicalControl::Yellow,
    "identical raw codes on different qualified interfaces retain independent physical identity");
  require(!linux_switch(map, 0, 1, 48) && !linux_switch(map, 2, 1, 30), "unmapped code/interface never aliases a control");
  const auto retained = selected;
  require(!qualify_linux_sources(map, {first}, selected) && selected == retained, "absent selector preserves previous result on refusal");
  require(!qualify_linux_sources(map, {first, second, first}, selected), "ambiguous duplicate interface refuses arbitrary first match");
  auto changed = first; changed.key_codes.push_back(49);
  require(!qualify_linux_sources(map, {changed, second}, selected), "changed capabilities require explicit map review");
  changed = first; changed.interface_number = 9;
  require(!qualify_linux_sources(map, {changed, second}, selected), "matching key capabilities on a different interface cannot substitute");
  map.sources.push_back({"duplicate", first});
  require(!qualify_linux_sources(map, {first, second}, selected), "two declared sources cannot own one interface");
  map.sources = {{"foreign", HidSelector{2, 7, 6}}};
  require(!qualify_linux_sources(map, {first}, selected), "another platform selector is rejected");
  map.sources.clear();
  require(!qualify_linux_sources(map, {first}, selected), "empty source map has no guessed keyboard fallback");
  std::puts("Linux source qualification passed with synthetic metadata only.");
}
