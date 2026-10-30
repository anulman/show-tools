#include "tribulations_internal.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <new>

namespace patches::tribulations {
namespace {
constexpr double tau = 6.283185307179586476925286766559;
constexpr ParameterDescriptor amp_parameters[] = {
  {"drive_gain", 1, 40, 36}, {"grit", 0, 1, 1}, {"bias", 0, .4, .18},
  {"tone_hz", 800, 6000, 4000}, {"output_gain", 0, 1, .06}
};
struct AmpChannel {
  double pre_low = 0, previous = 0, dc_low = 0, first = 0, second = 0;
};
class GarageAmp final : public Effect {
 public:
  GarageAmp(double rate, GarageAmpParameters parameters) noexcept:
    descriptor_{"tribulations_amp", 1, 0, uint64_t(std::ceil(rate)), amp_parameters, 5, true, true},
    parameters_(parameters), rate_(rate), highpass_(1 - std::exp(-tau * 90 / rate)),
    dc_(1 - std::exp(-tau * 30 / rate)), baseline_(twang_saturation(parameters.bias)) {
    double g = std::tan(.5 * tau * parameters.tone_hz / rate);
    a1_ = 1 / (1 + g * (g + 1.4142135623730950488)); a2_ = g * a1_; a3_ = g * a2_;
  }
  const EffectDescriptor& descriptor() const noexcept override { return descriptor_; }
  Stereo process(Stereo input) noexcept override {
    if (input.left == 0 && input.right == 0) {
      if (zero_frames_ == descriptor_.maximum_tail_frames) return {};
      if (++zero_frames_ == descriptor_.maximum_tail_frames) {
        reset(); zero_frames_ = descriptor_.maximum_tail_frames; return {};
      }
    } else zero_frames_ = 0;
    return {render(input.left, channels_[0]), render(input.right, channels_[1])};
  }
  void reset() noexcept override { channels_[0] = {}; channels_[1] = {}; zero_frames_ = 0; }
  bool compatible(const Effect& other) const noexcept override {
    const auto* candidate = dynamic_cast<const GarageAmp*>(&other);
    return candidate && rate_ == candidate->rate_ && parameters_.drive_gain == candidate->parameters_.drive_gain
      && parameters_.grit == candidate->parameters_.grit && parameters_.bias == candidate->parameters_.bias
      && parameters_.tone_hz == candidate->parameters_.tone_hz && parameters_.output_gain == candidate->parameters_.output_gain;
  }
  void copy_state(const Effect& other) noexcept override {
    const auto& source = static_cast<const GarageAmp&>(other);
    channels_[0] = source.channels_[0]; channels_[1] = source.channels_[1]; zero_frames_ = source.zero_frames_;
  }
  std::unique_ptr<Effect> snapshot() const noexcept override {
    auto result = make_amp(rate_, parameters_);
    if (result) static_cast<GarageAmp*>(result.get())->copy_state(*this);
    return result;
  }
  size_t memory_bytes() const noexcept override { return sizeof(*this); }
 private:
  float render(double input, AmpChannel& state) noexcept {
    state.pre_low += highpass_ * (input - state.pre_low);
    double current = input - state.pre_low;
    double clean = .5 * (current + state.previous);
    double driven = antialiased_twang_saturation(parameters_.drive_gain * current + parameters_.bias,
      parameters_.drive_gain * state.previous + parameters_.bias) - baseline_;
    state.previous = current;
    double blend = (1 - parameters_.grit) * clean + parameters_.grit * driven;
    state.dc_low += dc_ * (blend - state.dc_low);
    double difference = blend - state.dc_low - state.second;
    double band = a1_ * state.first + a2_ * difference;
    double low = state.second + a2_ * state.first + a3_ * difference;
    state.first = 2 * band - state.first; state.second = 2 * low - state.second;
    double output = parameters_.output_gain * low, limit = std::numeric_limits<float>::max();
    return float(std::clamp(output, -limit, limit));
  }
  EffectDescriptor descriptor_;
  GarageAmpParameters parameters_;
  double rate_, highpass_, dc_, baseline_, a1_, a2_, a3_;
  AmpChannel channels_[2];
  uint64_t zero_frames_ = 0;
};
bool bounded(double value, double minimum, double maximum) noexcept {
  return std::isfinite(value) && value >= minimum && value <= maximum;
}
}
std::unique_ptr<Effect> make_amp(double rate, GarageAmpParameters p) noexcept {
  if (!bounded(rate, 16000, 192000) || !bounded(p.drive_gain, 1, 40) || !bounded(p.grit, 0, 1)
    || !bounded(p.bias, 0, .4) || !bounded(p.tone_hz, 800, 6000) || p.tone_hz > .4 * rate
    || !bounded(p.output_gain, 0, 1)) return nullptr;
  return std::unique_ptr<Effect>(new (std::nothrow) GarageAmp(rate, p));
}
}
