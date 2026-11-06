#ifndef SHOW_TOOLS_NATIVE_AUDIO_PUMP_H
#define SHOW_TOOLS_NATIVE_AUDIO_PUMP_H

#include "performance_engine.h"
#include <cstddef>
#include <cstdint>
#include <vector>

namespace native_host {
// All calls, including device writes, belong to the engine owner thread.
class AudioPump {
public:
  using Write = int64_t (*)(void*, const float*, uint32_t);
  AudioPump(pf_engine* engine, uint32_t capacity);
  // The input and all output storage must cover frames. A partial device write
  // retains the unwritten interleaved stereo suffix for the next call.
  int render(const float* input, uint32_t frames);
  int64_t write(Write sink, void* context);
  void discard();
  uint32_t pending() const;
  uint32_t capacity() const;
private:
  pf_engine* engine_;
  uint32_t capacity_, offset_ = 0, length_ = 0;
  std::vector<float> sample_left_, sample_right_, live_left_, live_right_, stereo_;
};
}
#endif
