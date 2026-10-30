#include "tribulations_internal.h"
#include <algorithm>
#include <cmath>
#include <new>

namespace patches::tribulations {
double twang_saturation(double input) noexcept {
  if (input <= -1) return -1;
  if (input >= 1) return 1;
  return input * (1.5 - .5 * input * input);
}
double antialiased_twang_saturation(double current, double previous) noexcept {
  if (current == previous) return twang_saturation(current);
  if (current >= 1 && previous >= 1) return 1;
  if (current <= -1 && previous <= -1) return -1;
  if (std::abs(current) <= 1 && std::abs(previous) <= 1)
    return (current + previous) * (.75 - .125 * (current * current + previous * previous));
  double low = std::min(current, previous), high = std::max(current, previous);
  double a = std::max(low, -1.0), b = std::min(high, 1.0);
  double area = (b - a) * (a + b) * (.75 - .125 * (a * a + b * b));
  if (low < -1) area -= -1 - low;
  if (high > 1) area += high - 1;
  double width = high - low;
  if (std::isfinite(width)) return area / width;
  double scale = std::max(-low, high);
  return (area / scale) / (high / scale - low / scale);
}
namespace {
constexpr double tau = 6.283185307179586476925286766559;
constexpr ParameterDescriptor filter_parameters[] = {
  {"input_highpass_hz", 20, 500, 90}, {"drive_gain", .1, 32, 1.5},
  {"envelope_attack_ms", .1, 100, 2}, {"envelope_release_ms", 1, 1000, 180},
  {"envelope_sensitivity", .001, 2, .006}, {"resting_hz", 80, 8000, 350},
  {"sweep_octaves", 0, 4, 2.4}, {"q", .5, 2, 1.25}, {"bandpass_mix", 0, 1, .60},
  {"post_lowpass_hz", 200, 20000, 4600}, {"output_gain", 0, 2, 1.3}
};
struct FilterCoefficients { double a1, a2, a3, k; };
FilterCoefficients coefficients(double frequency, double q, double rate) noexcept {
  double g = std::tan(.5 * tau * frequency / rate), k = 1 / q;
  double a1 = 1 / (1 + g * (g + k));
  return {a1, g * a1, g * g * a1, k};
}
struct FilterOutput { double band, low; };
struct FilterState {
  double first = 0, second = 0;
  FilterOutput process(double input, const FilterCoefficients& c) noexcept {
    double difference = input - second;
    double band = c.a1 * first + c.a2 * difference;
    double low = second + c.a2 * first + c.a3 * difference;
    first = 2 * band - first; second = 2 * low - second;
    return {band, low};
  }
};
struct ChannelState {
  double pre_low = 0, previous_driven = 0;
  FilterState swept, post;
};
class MovingFilter final : public Effect {
 public:
  MovingFilter(double rate, FilterParameters parameters) noexcept:
    descriptor_{"tribulations_filter", 1, 0, uint64_t(std::ceil(rate)), filter_parameters, 11, true, true},
    parameters_(parameters), rate_(rate),
    highpass_coefficient_(1 - std::exp(-tau * parameters.input_highpass_hz / rate)),
    attack_(1 - std::exp(-1 / (.001 * parameters.envelope_attack_ms * rate))),
    release_(1 - std::exp(-1 / (.001 * parameters.envelope_release_ms * rate))),
    post_(coefficients(parameters.post_lowpass_hz, .7071067811865475244, rate)) {}
  const EffectDescriptor& descriptor() const noexcept override { return descriptor_; }
  Stereo process(Stereo input) noexcept override {
    if (input.left == 0 && input.right == 0) {
      if (zero_frames_ < descriptor_.maximum_tail_frames) ++zero_frames_;
      if (zero_frames_ == descriptor_.maximum_tail_frames) {
        clear_audio_state(); return {};
      }
    } else zero_frames_ = 0;
    double left = highpass(input.left, channels_[0]), right = highpass(input.right, channels_[1]);
    double magnitude = std::max(std::abs(left), std::abs(right));
    envelope_ += (magnitude > envelope_ ? attack_ : release_) * (magnitude - envelope_);
    double sweep = envelope_ / (envelope_ + parameters_.envelope_sensitivity);
    double cutoff = parameters_.resting_hz * std::exp2(parameters_.sweep_octaves * sweep);
    auto swept = coefficients(cutoff, parameters_.q, rate_);
    return {float(render(left, channels_[0], swept)), float(render(right, channels_[1], swept))};
  }
  void reset() noexcept override { clear_audio_state(); zero_frames_ = 0; }
  bool compatible(const Effect& other) const noexcept override {
    const auto* candidate = dynamic_cast<const MovingFilter*>(&other);
    if (!candidate || rate_ != candidate->rate_) return false;
    const auto& p = candidate->parameters_;
    return parameters_.input_highpass_hz == p.input_highpass_hz && parameters_.drive_gain == p.drive_gain
      && parameters_.envelope_attack_ms == p.envelope_attack_ms && parameters_.envelope_release_ms == p.envelope_release_ms
      && parameters_.envelope_sensitivity == p.envelope_sensitivity && parameters_.resting_hz == p.resting_hz
      && parameters_.sweep_octaves == p.sweep_octaves && parameters_.q == p.q
      && parameters_.bandpass_mix == p.bandpass_mix && parameters_.post_lowpass_hz == p.post_lowpass_hz
      && parameters_.output_gain == p.output_gain;
  }
  void copy_state(const Effect& other) noexcept override {
    const auto& source = static_cast<const MovingFilter&>(other);
    channels_[0] = source.channels_[0]; channels_[1] = source.channels_[1];
    envelope_ = source.envelope_; zero_frames_ = source.zero_frames_;
  }
  std::unique_ptr<Effect> snapshot() const noexcept override {
    auto result = make_filter(rate_, parameters_);
    if (result) static_cast<MovingFilter*>(result.get())->copy_state(*this);
    return result;
  }
  size_t memory_bytes() const noexcept override { return sizeof(*this); }
 private:
  void clear_audio_state() noexcept { channels_[0] = {}; channels_[1] = {}; envelope_ = 0; }
  double highpass(double input, ChannelState& state) noexcept {
    state.pre_low += highpass_coefficient_ * (input - state.pre_low);
    return input - state.pre_low;
  }
  double render(double input, ChannelState& state, const FilterCoefficients& swept) noexcept {
    double driven = input * parameters_.drive_gain;
    double shaped = antialiased_twang_saturation(driven, state.previous_driven);
    state.previous_driven = driven;
    auto filtered = state.swept.process(shaped, swept);
    double blended = parameters_.bandpass_mix * swept.k * filtered.band + (1 - parameters_.bandpass_mix) * filtered.low;
    return parameters_.output_gain * state.post.process(blended, post_).low;
  }
  EffectDescriptor descriptor_;
  FilterParameters parameters_;
  double rate_, highpass_coefficient_, attack_, release_;
  FilterCoefficients post_;
  ChannelState channels_[2];
  double envelope_ = 0;
  uint64_t zero_frames_ = 0;
};
bool bounded(double value, double low, double high) noexcept {
  return std::isfinite(value) && value >= low && value <= high;
}
}
std::unique_ptr<Effect> make_filter(double rate, FilterParameters p) noexcept {
  if (!bounded(rate, 8000, 192000) || !bounded(p.input_highpass_hz, 20, 500)
    || !bounded(p.drive_gain, .1, 32) || !bounded(p.envelope_attack_ms, .1, 100)
    || !bounded(p.envelope_release_ms, 1, 1000) || !bounded(p.envelope_sensitivity, .001, 2)
    || !bounded(p.resting_hz, 80, 8000) || !bounded(p.sweep_octaves, 0, 4)
    || !bounded(p.q, .5, 2) || !bounded(p.bandpass_mix, 0, 1)
    || !bounded(p.post_lowpass_hz, 200, 20000) || !bounded(p.output_gain, 0, 2)
    || p.resting_hz * std::exp2(p.sweep_octaves) > .2 * rate || p.post_lowpass_hz > .4 * rate) return nullptr;
  return std::unique_ptr<Effect>(new (std::nothrow) MovingFilter(rate, p));
}
}
