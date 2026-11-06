#ifndef SHOW_TOOLS_NATIVE_SPSC_QUEUE_H
#define SHOW_TOOLS_NATIVE_SPSC_QUEUE_H

#include <array>
#include <atomic>
#include <cstddef>

namespace native_host {
template<class T, size_t Capacity> class SpscQueue {
  static_assert(Capacity > 0, "queue capacity must be positive");
public:
  bool push(const T& value) {
    const auto head = head_.load(std::memory_order_relaxed);
    const auto next = (head + 1) % (Capacity + 1);
    if (next == tail_.load(std::memory_order_acquire)) return false;
    items_[head] = value;
    head_.store(next, std::memory_order_release);
    return true;
  }
  bool pop(T& value) {
    const auto tail = tail_.load(std::memory_order_relaxed);
    if (tail == head_.load(std::memory_order_acquire)) return false;
    value = items_[tail];
    tail_.store((tail + 1) % (Capacity + 1), std::memory_order_release);
    return true;
  }
private:
  std::array<T, Capacity + 1> items_{};
  std::atomic<size_t> head_{0}, tail_{0};
};
}
#endif
