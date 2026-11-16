#pragma once
#include "control_stream.h"
#include <algorithm>
#include <vector>

namespace peripheral_host {
inline bool same_linux_source(const LinuxSelector& expected, const LinuxSelector& observed) {
  return expected.interface_number == observed.interface_number
    && expected.event_types == observed.event_types && expected.key_codes == observed.key_codes
    && expected.relative_axes == observed.relative_axes;
}
// Runtime paths and USB ports are deliberately absent from a persisted selector.
inline bool qualify_linux_sources(const InputMap& map, const std::vector<LinuxSelector>& observed,
    std::vector<size_t>& selected) {
  if (map.sources.empty() || map.sources.size() > 8 || observed.size() > 64) return false;
  std::vector<size_t> candidate;
  for (const auto& source : map.sources) {
    const auto* expected = std::get_if<LinuxSelector>(&source.selector);
    if (!expected) return false;
    size_t found = observed.size();
    for (size_t index = 0; index < observed.size(); ++index) {
      if (!same_linux_source(*expected, observed[index])) continue;
      if (found != observed.size()) return false;
      found = index;
    }
    if (found == observed.size() || std::find(candidate.begin(), candidate.end(), found) != candidate.end()) return false;
    candidate.push_back(found);
  }
  selected = std::move(candidate);
  return true;
}
inline const SwitchBinding* linux_switch(const InputMap& map, unsigned source, unsigned type, unsigned code) {
  for (const auto& binding : map.switches)
    if (binding.source == source && binding.type == type && binding.code == code) return &binding;
  return nullptr;
}
inline bool linux_axis(const InputMap& map, unsigned source, unsigned type, unsigned code) {
  return map.axis && map.axis->source == source && map.axis->type == type && map.axis->code == code;
}
}
