#include "audio_pump.h"
#include <algorithm>

namespace native_host {
AudioPump::AudioPump(pf_engine* engine, uint32_t capacity)
  : engine_(engine), capacity_(capacity), sample_left_(capacity), sample_right_(capacity),
    live_left_(capacity), live_right_(capacity), stereo_(size_t(capacity) * 2) {}

int AudioPump::render(const float* input, uint32_t frames, bool monitor) {
  if (!engine_ || !frames || frames > capacity_ || pending()) return -1;
  std::fill_n(sample_left_.data(), frames, 0);
  std::fill_n(sample_right_.data(), frames, 0);
  std::fill_n(live_left_.data(), frames, 0);
  std::fill_n(live_right_.data(), frames, 0);
  if ((!monitor || pf_audio_needed(engine_)) &&
      pf_process_stems(engine_, input, sample_left_.data(), sample_right_.data(),
                       live_left_.data(), live_right_.data(), frames) < 0) return -1;
  if (monitor && pf_render_idle_monitor(engine_, input, live_left_.data(), live_right_.data(), frames) < 0) return -1;
  for (uint32_t i = 0; i < frames; ++i) {
    stereo_[i * 2] = sample_left_[i] + live_left_[i];
    stereo_[i * 2 + 1] = sample_right_[i] + live_right_[i];
  }
  offset_ = 0;
  length_ = frames;
  return 0;
}
int64_t AudioPump::write(Write sink, void* context) {
  if (!sink || !pending()) return -1;
  int64_t written = sink(context, stereo_.data() + size_t(offset_) * 2, pending());
  if (written < 0 || uint64_t(written) > pending()) return -1;
  offset_ += uint32_t(written);
  return written;
}
void AudioPump::discard() { offset_ = length_ = 0; }
uint32_t AudioPump::pending() const { return length_ - offset_; }
uint32_t AudioPump::capacity() const { return capacity_; }
}
