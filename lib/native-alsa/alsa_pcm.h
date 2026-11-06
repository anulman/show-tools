#pragma once

#include <cstddef>
#include <memory>
#include <string>

namespace native_alsa {

enum class SampleFormat { S32LE, FloatLE };
enum class Direction { Capture, Playback };

struct Config {
  std::string capture_device;
  std::string playback_device;
  unsigned sample_rate;
  unsigned capture_channels;
  unsigned input_channel;
  unsigned period_frames;
  unsigned buffer_frames;
  unsigned max_block_frames;
  SampleFormat format;
};

class AlsaPcm {
 public:
  static std::unique_ptr<AlsaPcm> open(const Config& config, std::string& error);
  ~AlsaPcm();
  AlsaPcm(const AlsaPcm&) = delete;
  AlsaPcm& operator=(const AlsaPcm&) = delete;

  // Returns frames transferred or a negative device error. Buffers are caller-owned.
  long read(float* mono, std::size_t frames);
  long write(const float* stereo, std::size_t frames);
  int recover(Direction direction, int error);
  int drop();
  int prepare();

 private:
  struct Impl;
  explicit AlsaPcm(std::unique_ptr<Impl> impl);
  std::unique_ptr<Impl> impl_;
};

}  // namespace native_alsa
