#include "alsa_pcm.h"

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdint>
#include <limits>
#include <utility>
#include <vector>

#if defined(__linux__)
#include <alsa/asoundlib.h>
#endif

namespace native_alsa {

struct AlsaPcm::Impl {
  Config config;
  Parameters capture_parameters{};
  Parameters playback_parameters{};
#if defined(__linux__)
  snd_pcm_t* capture = nullptr;
  snd_pcm_t* playback = nullptr;
  std::vector<std::int32_t> capture_int;
  std::vector<std::int32_t> playback_int;
  std::vector<float> capture_float;
  ~Impl() {
    if (capture) snd_pcm_close(capture);
    if (playback) snd_pcm_close(playback);
  }
#endif
};

AlsaPcm::AlsaPcm(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}
AlsaPcm::~AlsaPcm() = default;

#if defined(__linux__)
namespace {
int configure(snd_pcm_t* pcm, const Config& config, unsigned channels, Parameters& actual) {
  snd_pcm_hw_params_t* params = nullptr;
  int rc = snd_pcm_hw_params_malloc(&params);
  if (rc < 0) return rc;
  if ((rc = snd_pcm_hw_params_any(pcm, params)) >= 0 &&
      (rc = snd_pcm_hw_params_set_rate_resample(pcm, params, 0)) >= 0 &&
      (rc = snd_pcm_hw_params_set_access(pcm, params, SND_PCM_ACCESS_RW_INTERLEAVED)) >= 0 &&
      (rc = snd_pcm_hw_params_set_format(pcm, params, config.format == SampleFormat::S32LE ? SND_PCM_FORMAT_S32_LE : SND_PCM_FORMAT_FLOAT_LE)) >= 0 &&
      (rc = snd_pcm_hw_params_set_channels(pcm, params, channels)) >= 0 &&
      (rc = snd_pcm_hw_params_set_rate(pcm, params, config.sample_rate, 0)) >= 0 &&
      (rc = snd_pcm_hw_params_set_period_size(pcm, params, config.period_frames, 0)) >= 0 &&
      (rc = snd_pcm_hw_params_set_buffer_size(pcm, params, config.buffer_frames)) >= 0) {
    rc = snd_pcm_hw_params(pcm, params);
  }
  snd_pcm_format_t format{};
  snd_pcm_uframes_t period = 0, buffer = 0;
  unsigned rate = 0, actual_channels = 0;
  int direction = 0;
  if (rc >= 0 && (rc = snd_pcm_hw_params_current(pcm, params)) >= 0 &&
      (rc = snd_pcm_hw_params_get_format(params, &format)) >= 0 &&
      (rc = snd_pcm_hw_params_get_channels(params, &actual_channels)) >= 0 &&
      (rc = snd_pcm_hw_params_get_rate(params, &rate, &direction)) >= 0 &&
      (rc = snd_pcm_hw_params_get_period_size(params, &period, &direction)) >= 0 &&
      (rc = snd_pcm_hw_params_get_buffer_size(params, &buffer)) >= 0) {
    const auto expected_format = config.format == SampleFormat::S32LE ? SND_PCM_FORMAT_S32_LE : SND_PCM_FORMAT_FLOAT_LE;
    if (format != expected_format || rate != config.sample_rate || actual_channels != channels ||
        period != config.period_frames || buffer != config.buffer_frames) rc = -EINVAL;
    else actual = {rate, actual_channels, period, buffer, config.format};
  }
  snd_pcm_hw_params_free(params);
  return rc;
}
std::int32_t to_s32(float sample) {
  if (!std::isfinite(sample)) return 0;
  const double scaled = std::clamp(static_cast<double>(sample), -1.0, 1.0) * 2147483648.0;
  return static_cast<std::int32_t>(std::clamp(scaled, -2147483648.0, 2147483647.0));
}
}  // namespace
#endif

std::unique_ptr<AlsaPcm> AlsaPcm::open(const Config& config, std::string& error) {
  error.clear();
  if (config.capture_device.empty() || config.playback_device.empty() || !config.sample_rate ||
      !config.capture_channels || config.capture_channels > 32 || config.input_channel >= config.capture_channels ||
      !config.period_frames || config.buffer_frames < config.period_frames || !config.max_block_frames ||
      config.max_block_frames > 1048576 || (config.format != SampleFormat::S32LE && config.format != SampleFormat::FloatLE)) {
    error = "Invalid explicit ALSA configuration";
    return nullptr;
  }
#if defined(__linux__)
  auto impl = std::make_unique<Impl>();
  impl->config = config;
  int rc = snd_pcm_open(&impl->capture, config.capture_device.c_str(), SND_PCM_STREAM_CAPTURE, 0);
  if (rc >= 0) rc = configure(impl->capture, config, config.capture_channels, impl->capture_parameters);
  if (rc >= 0) rc = snd_pcm_open(&impl->playback, config.playback_device.c_str(), SND_PCM_STREAM_PLAYBACK, 0);
  if (rc >= 0) rc = configure(impl->playback, config, 2, impl->playback_parameters);
  if (rc < 0) { error = snd_strerror(rc); return nullptr; }
  if (config.format == SampleFormat::S32LE) {
    impl->capture_int.resize(static_cast<std::size_t>(config.max_block_frames) * config.capture_channels);
    impl->playback_int.resize(static_cast<std::size_t>(config.max_block_frames) * 2);
  } else {
    impl->capture_float.resize(static_cast<std::size_t>(config.max_block_frames) * config.capture_channels);
  }
  return std::unique_ptr<AlsaPcm>(new AlsaPcm(std::move(impl)));
#else
  error = "ALSA is only available on Linux";
  return nullptr;
#endif
}

long AlsaPcm::read(float* mono, std::size_t frames) {
#if defined(__linux__)
  if (!mono || frames > impl_->config.max_block_frames) return -EINVAL;
  const Config& config = impl_->config;
  void* buffer = config.format == SampleFormat::S32LE ? static_cast<void*>(impl_->capture_int.data()) : static_cast<void*>(impl_->capture_float.data());
  const auto count = snd_pcm_readi(impl_->capture, buffer, frames);
  if (count < 0) return count;
  for (long i = 0; i < count; ++i) {
    const auto index = static_cast<std::size_t>(i) * config.capture_channels + config.input_channel;
    mono[i] = config.format == SampleFormat::S32LE ? static_cast<float>(impl_->capture_int[index] / 2147483648.0) : impl_->capture_float[index];
  }
  return count;
#else
  (void)mono; (void)frames; return -ENOSYS;
#endif
}

long AlsaPcm::write(const float* stereo, std::size_t frames) {
#if defined(__linux__)
  if (!stereo || frames > impl_->config.max_block_frames) return -EINVAL;
  if (impl_->config.format == SampleFormat::FloatLE) return snd_pcm_writei(impl_->playback, stereo, frames);
  for (std::size_t i = 0; i < frames * 2; ++i) impl_->playback_int[i] = to_s32(stereo[i]);
  return snd_pcm_writei(impl_->playback, impl_->playback_int.data(), frames);
#else
  (void)stereo; (void)frames; return -ENOSYS;
#endif
}

int AlsaPcm::recover(Direction direction, int error) {
#if defined(__linux__)
  return snd_pcm_recover(direction == Direction::Capture ? impl_->capture : impl_->playback, error, 1);
#else
  (void)direction; (void)error; return -ENOSYS;
#endif
}
int AlsaPcm::drop() {
#if defined(__linux__)
  const int capture = snd_pcm_drop(impl_->capture);
  const int playback = snd_pcm_drop(impl_->playback);
  return capture < 0 ? capture : playback;
#else
  return -ENOSYS;
#endif
}
int AlsaPcm::prepare() {
#if defined(__linux__)
  const int capture = snd_pcm_prepare(impl_->capture);
  const int playback = snd_pcm_prepare(impl_->playback);
  return capture < 0 ? capture : playback;
#else
  return -ENOSYS;
#endif
}

const Parameters& AlsaPcm::capture_parameters() const { return impl_->capture_parameters; }
const Parameters& AlsaPcm::playback_parameters() const { return impl_->playback_parameters; }

}  // namespace native_alsa
