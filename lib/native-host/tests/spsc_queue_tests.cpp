#include "spsc_queue.h"
#include <cstdlib>
#include <thread>

using native_host::SpscQueue;
void require(bool condition) { if (!condition) std::abort(); }
int main() {
  SpscQueue<int, 256> queue;
  for (int i = 0; i < 256; ++i) require(queue.push(i));
  require(!queue.push(256));
  for (int i = 0, value; i < 256; ++i) { require(queue.pop(value)); require(value == i); }
  int value; require(!queue.pop(value));
  constexpr int count = 100000;
  std::thread producer([&] { for (int i = 0; i < count; ++i) while (!queue.push(i)) std::this_thread::yield(); });
  for (int i = 0; i < count; ++i) {
    while (!queue.pop(value)) std::this_thread::yield();
    require(value == i);
  }
  producer.join();
}
