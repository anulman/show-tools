#pragma once
#include <algorithm>
#include <cstdint>
#include <vector>

namespace peripheral_host {
enum class LinuxInputKind { Button, Motion };
struct LinuxObservation {
  unsigned source;
  int64_t nanoseconds;
  LinuxInputKind kind;
  int value;
};
struct LinuxInputOrder {
  int64_t nanoseconds = -1;
  unsigned source = 0;
};
inline bool order_linux_input(std::vector<LinuxObservation>& batch, const LinuxInputOrder& last) {
  std::stable_sort(batch.begin(), batch.end(), [](const auto& a, const auto& b) { return a.nanoseconds < b.nanoseconds; });
  auto previous = last;
  for (const auto& value : batch) {
    if (value.nanoseconds < 0 || value.nanoseconds < previous.nanoseconds
      || (value.nanoseconds == previous.nanoseconds && value.source != previous.source)) return false;
    previous = {value.nanoseconds, value.source};
  }
  return true;
}
}
