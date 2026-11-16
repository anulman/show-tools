#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <vector>

namespace peripheral_host {
enum class LinuxInputKind { Button, Motion, Ignored };
struct LinuxObservation {
  unsigned source;
  int64_t nanoseconds;
  LinuxInputKind kind;
  int value;
  uint32_t control = 0;
};
struct LinuxInputOrder {
  int64_t nanoseconds = -1;
  unsigned source = 0;
};
inline bool order_linux_input(std::vector<LinuxObservation>& batch, const LinuxInputOrder& last, size_t sources = 8) {
  if (!sources || sources > 8) return false;
  std::array<int64_t, 8> source_time;
  source_time.fill(-1);
  for (const auto& value : batch) {
    if (value.source >= sources || value.nanoseconds < 0 || value.nanoseconds < source_time[value.source]) return false;
    source_time[value.source] = value.nanoseconds;
  }
  std::stable_sort(batch.begin(), batch.end(), [](const auto& a, const auto& b) { return a.nanoseconds < b.nanoseconds; });
  auto previous = last;
  for (const auto& value : batch) {
    if (value.nanoseconds < previous.nanoseconds
      || (value.nanoseconds == previous.nanoseconds && value.source != previous.source)) return false;
    previous = {value.nanoseconds, value.source};
  }
  return true;
}
}
