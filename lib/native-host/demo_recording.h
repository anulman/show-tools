#ifndef SHOW_TOOLS_NATIVE_DEMO_RECORDING_H
#define SHOW_TOOLS_NATIVE_DEMO_RECORDING_H

#include "spsc_queue.h"
#include <cstdint>
#include <string>
#include <thread>

namespace native_host {
class DemoRecording {
public:
  enum class State : uint32_t { Idle, Armed, Recording, Finishing, Saved, Failed };
  DemoRecording(std::string draft, std::string output, uint32_t sample_rate, std::string archive_root = {});
  ~DemoRecording();
  bool available() const { return writer_.joinable(); }
  State state() const { return state_.load(std::memory_order_acquire); }

  // The engine owner calls these. Only the writer touches the filesystem.
  bool arm();
  void submit(const float* stereo, uint32_t frames);
  void finish();
private:
  static constexpr uint32_t block_frames = 1024;
  struct Block { uint32_t frames = 0; std::array<float, block_frames * 2> stereo{}; };
  void write();
  const std::string draft_, output_, archive_root_;
  const uint32_t sample_rate_;
  SpscQueue<Block, 96> queue_;
  std::atomic<State> state_{State::Idle};
  std::atomic<bool> closing_{false}, io_failed_{false};
  bool failed_ = false; // Set by the producer, read by the writer after Finishing.
  uint32_t submitted_ = 0;
  std::thread writer_;
};
}
#endif
