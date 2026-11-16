#pragma once
#include <cstdint>
#include "control_stream.h"

namespace peripheral_host {
struct LinuxHandles { std::vector<int> inputs; int output = -1, commands = -1; };
int run_linux_host(const LinuxHandles& handles, const HostConfig& config,
  const InitialStates& initial, int64_t startup_cutoff_ns);
}
