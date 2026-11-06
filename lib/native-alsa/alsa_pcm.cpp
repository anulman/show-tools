#include "alsa_pcm.h"
#include "usb_identity.h"

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdint>
#include <limits>
#include <regex>
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
  bool draining = false;
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
bool matches(const UsbIdentity& expected, const detail::UsbDeviceFacts& facts, std::string& error) {
  if (facts.card_id == expected.card_id && facts.serial == expected.serial && facts.vendor == expected.vendor && facts.product == expected.product) return true;
  error = "Selected USB audio identity does not match configured serial, vendor, product and ALSA ID";
  return false;
}
bool pcm_matches(snd_pcm_t* pcm, const detail::UsbDeviceFacts& facts, unsigned device, int stream, std::string& error) {
  snd_pcm_info_t* raw = nullptr;
  int rc = snd_pcm_info_malloc(&raw);
  if (rc < 0) { error = snd_strerror(rc); return false; }
  std::unique_ptr<snd_pcm_info_t, decltype(&snd_pcm_info_free)> info(raw, snd_pcm_info_free);
  rc = snd_pcm_info(pcm, info.get());
  if (rc < 0 || snd_pcm_type(pcm) != SND_PCM_TYPE_HW || snd_pcm_state(pcm) == SND_PCM_STATE_DISCONNECTED || snd_pcm_info_get_card(info.get()) != int(facts.card) || snd_pcm_info_get_device(info.get()) != device || snd_pcm_info_get_stream(info.get()) != stream) {
    error = "Acquired PCM handle is disconnected or does not match selected USB card/device";
    return false;
  }
  return true;
}
bool monitor_off(const UsbIdentity& expected, unsigned card, std::string& error) {
  snd_ctl_t* raw_control = nullptr;
  int rc = snd_ctl_open(&raw_control, ("hw:" + std::to_string(card)).c_str(), SND_CTL_READONLY | SND_CTL_NONBLOCK);
  if (rc < 0) { error = "Cannot read Direct Monitor control: " + std::string(snd_strerror(rc)); return false; }
  std::unique_ptr<snd_ctl_t, decltype(&snd_ctl_close)> control(raw_control, snd_ctl_close);
  snd_ctl_card_info_t* raw_card = nullptr;
  rc = snd_ctl_card_info_malloc(&raw_card);
  if (rc < 0) { error = snd_strerror(rc); return false; }
  std::unique_ptr<snd_ctl_card_info_t, decltype(&snd_ctl_card_info_free)> card_info(raw_card, snd_ctl_card_info_free);
  rc = snd_ctl_card_info(control.get(), card_info.get());
  if (rc < 0 || snd_ctl_type(control.get()) != SND_CTL_TYPE_HW || snd_ctl_card_info_get_card(card_info.get()) != int(card) || expected.card_id != snd_ctl_card_info_get_id(card_info.get())) {
    error = "Direct Monitor control does not belong to the selected hardware card";
    return false;
  }
  snd_ctl_elem_info_t* raw_info = nullptr;
  rc = snd_ctl_elem_info_malloc(&raw_info);
  if (rc < 0) { error = snd_strerror(rc); return false; }
  std::unique_ptr<snd_ctl_elem_info_t, decltype(&snd_ctl_elem_info_free)> info(raw_info, snd_ctl_elem_info_free);
  snd_ctl_elem_info_set_interface(info.get(), SND_CTL_ELEM_IFACE_MIXER);
  snd_ctl_elem_info_set_name(info.get(), expected.monitor_off.c_str());
  snd_ctl_elem_info_set_index(info.get(), 0);
  rc = snd_ctl_elem_info(control.get(), info.get());
  if (rc < 0 || snd_ctl_elem_info_get_type(info.get()) != SND_CTL_ELEM_TYPE_BOOLEAN || snd_ctl_elem_info_get_count(info.get()) != 1) {
    error = "Direct Monitor must be a readable named MIXER BOOLEAN with one value";
    return false;
  }
  snd_ctl_elem_value_t* raw_value = nullptr;
  rc = snd_ctl_elem_value_malloc(&raw_value);
  if (rc < 0) { error = snd_strerror(rc); return false; }
  std::unique_ptr<snd_ctl_elem_value_t, decltype(&snd_ctl_elem_value_free)> value(raw_value, snd_ctl_elem_value_free);
  snd_ctl_elem_value_set_interface(value.get(), SND_CTL_ELEM_IFACE_MIXER);
  snd_ctl_elem_value_set_name(value.get(), expected.monitor_off.c_str());
  snd_ctl_elem_value_set_index(value.get(), 0);
  rc = snd_ctl_elem_read(control.get(), value.get());
  if (rc < 0 || snd_ctl_elem_value_get_boolean(value.get(), 0) != 0) {
    error = "Direct Monitor must be off before enabling application audio";
    return false;
  }
  return true;
}
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
  std::optional<detail::UsbDeviceFacts> identity;
  std::string capture = config.capture_device, playback = config.playback_device;
  if (config.identity) {
    const auto& expected = *config.identity;
    const auto logical = "hw:CARD=" + expected.card_id + ",DEV=" + std::to_string(expected.pcm_device);
    if (!std::regex_match(expected.by_id, std::regex("/dev/snd/by-id/[A-Za-z0-9_.:-]+")) ||
        expected.serial.empty() || expected.serial.size() > 256 ||
        !std::regex_match(expected.vendor, std::regex("[0-9a-f]{4}")) || !std::regex_match(expected.product, std::regex("[0-9a-f]{4}")) ||
        !std::regex_match(expected.card_id, std::regex("[A-Za-z0-9_]{1,32}")) || expected.pcm_device > 31 ||
        expected.monitor_off.empty() || expected.monitor_off.size() > 43 || capture != logical || playback != logical) {
      error = "Invalid explicit USB audio identity configuration"; return nullptr;
    }
    identity = detail::inspect_usb_device(expected, error);
    if (!identity || !matches(expected, *identity, error) || !monitor_off(expected, identity->card, error)) return nullptr;
    capture = playback = "hw:" + std::to_string(identity->card) + "," + std::to_string(expected.pcm_device);
  }
  int rc = snd_pcm_open(&impl->capture, capture.c_str(), SND_PCM_STREAM_CAPTURE, SND_PCM_NONBLOCK);
  if (rc >= 0) rc = snd_pcm_open(&impl->playback, playback.c_str(), SND_PCM_STREAM_PLAYBACK, SND_PCM_NONBLOCK);
  if (rc < 0) { error = snd_strerror(rc); return nullptr; }
  auto verify_handles = [&]() {
    return !identity || (pcm_matches(impl->capture, *identity, config.identity->pcm_device, SND_PCM_STREAM_CAPTURE, error) &&
      pcm_matches(impl->playback, *identity, config.identity->pcm_device, SND_PCM_STREAM_PLAYBACK, error));
  };
  if (!verify_handles()) return nullptr;
  if (identity) {
    const auto observed = detail::inspect_usb_device(*config.identity, error);
    if (!observed || !(*observed == *identity)) { if (observed) error = "USB audio identity changed during acquisition"; return nullptr; }
    if (!monitor_off(*config.identity, identity->card, error) || !verify_handles()) return nullptr;
  }
  rc = configure(impl->capture, config, config.capture_channels, impl->capture_parameters);
  if (rc >= 0) rc = configure(impl->playback, config, 2, impl->playback_parameters);
  if (rc >= 0) rc = snd_pcm_nonblock(impl->capture, 0);
  if (rc >= 0) rc = snd_pcm_nonblock(impl->playback, 0);
  if (rc < 0) { error = snd_strerror(rc); return nullptr; }
  if (!verify_handles()) return nullptr;
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
  const int mode = impl_->draining ? snd_pcm_nonblock(impl_->playback, 0) : 0;
  impl_->draining = false;
  return capture < 0 ? capture : playback < 0 ? playback : mode;
#else
  return -ENOSYS;
#endif
}
int AlsaPcm::finish() {
#if defined(__linux__)
  if (!impl_->draining) {
    int rc = snd_pcm_drop(impl_->capture);
    if (rc < 0) return rc;
    rc = snd_pcm_nonblock(impl_->playback, 1);
    if (rc < 0) return rc;
    impl_->draining = true;
    rc = snd_pcm_drain(impl_->playback);
    if (rc < 0 && rc != -EAGAIN) return rc;
    if (rc == -EAGAIN) return 1;
  } else {
    const auto state = snd_pcm_state(impl_->playback);
    if (state == SND_PCM_STATE_DRAINING || state == SND_PCM_STATE_RUNNING) return 1;
    if (state != SND_PCM_STATE_SETUP) return state == SND_PCM_STATE_XRUN ? -EPIPE : -EIO;
  }
  const int rc = snd_pcm_nonblock(impl_->playback, 0);
  if (rc < 0) return rc;
  impl_->draining = false;
  return 0;
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
