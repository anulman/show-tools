#include "linux_order.h"
#include <cstdio>
#include <cstdlib>

void require(bool condition, const char* message) { if (!condition) { std::fprintf(stderr, "%s\n", message); std::abort(); } }
int main() {
  using namespace peripheral_host;
  std::vector<LinuxObservation> batch{{0, 200, LinuxInputKind::Button, 1}, {1, 100, LinuxInputKind::Motion, -5}, {0, 200, LinuxInputKind::Button, 0}};
  require(order_linux_input(batch, {}), "merge ordered kernel timestamps and preserve same-interface ties");
  require(batch[0].value == -5 && batch[1].value == 1 && batch[2].value == 0, "ordered motion retains sign and button edge order");
  require(!order_linux_input(batch, {201, 0}), "late older input cannot be relabeled as new");
  batch = {{0, 200, LinuxInputKind::Button, 1}, {1, 200, LinuxInputKind::Motion, 4}};
  require(!order_linux_input(batch, {}), "cross-interface simultaneous timestamps do not invent an input order");
  batch = {{1, 200, LinuxInputKind::Motion, 4}};
  require(!order_linux_input(batch, {200, 0}), "cross-batch simultaneous input is also ambiguous");
  batch = {{1, -1, LinuxInputKind::Motion, 4}};
  require(!order_linux_input(batch, {}), "negative timestamps fail closed");
  std::puts("Linux input ordering tests passed without opening devices.");
}
