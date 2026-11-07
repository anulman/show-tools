#pragma once
#include <cstdint>

namespace peripheral_host {
struct LinuxHandles { int keyboard, mouse, output, commands; };
int run_linux_host(LinuxHandles handles, double session, uint32_t channel, bool initially_held, bool bench, int64_t startup_cutoff_ns);
}
