#include "tribulations_internal.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <new>

namespace patches::tribulations {
namespace {
constexpr double pi = 3.1415926535897932384626433832795;
constexpr uint32_t pitch_size = 256, window = 128, maximum_lag = 100, hop_size = 32;
constexpr ParameterDescriptor resynth_parameters[] = {
  {"decay_seconds", .05, 3, 2.2}, {"brightness", 0, 1, .62},
  {"pick_strength", 0, 2, .95}, {"output_gain", 0, 2, 1.8}
};
struct ResynthState {
  std::array<double, pitch_size> pitch{};
  uint32_t fir_cursor = 0, pitch_cursor = 0, pitch_valid = 0, hop = 0, string_cursor = 0;
  uint32_t rng = 0x5a17c9e3;
  double resample_phase = 0, fast = 0, slow = 0, pending_peak = 0;
  double frequency = 0, confidence = 0, target_delay = 0, delay = 0, previous_read = 0;
  uint64_t zero_frames = 0, pending_age = 0, refractory = 0;
  bool pending = false, attack_latched = false, string_active = false;
};
class GuitarResynth final : public Effect {
 public:
  GuitarResynth(double rate, StringParameters parameters, double* coefficients, double* input,
    double* string, uint32_t taps, uint32_t string_capacity) noexcept:
    descriptor_{"tribulations_string", 1, 0, uint64_t(std::ceil(2 * rate)), resynth_parameters, 4, true, true},
    parameters_(parameters), rate_(rate), coefficients_(coefficients), input_(input), string_(string),
    taps_(taps), string_capacity_(string_capacity), increment_(8000 / rate),
    fast_attack_(1 - std::exp(-1 / (.001 * rate))), fast_release_(1 - std::exp(-1 / (.020 * rate))),
    slow_attack_(1 - std::exp(-1 / (.030 * rate))), slow_release_(1 - std::exp(-1 / (.080 * rate))),
    glide_(1 - std::exp(-1 / (.006 * rate))), minimum_wait_(uint64_t(std::ceil(.028 * rate))),
    maximum_wait_(uint64_t(std::ceil(.080 * rate))), refractory_frames_(uint64_t(std::ceil(.050 * rate))) {}
  ~GuitarResynth() override { delete[] coefficients_; delete[] input_; delete[] string_; }
  const EffectDescriptor& descriptor() const noexcept override { return descriptor_; }
  Stereo process(Stereo input) noexcept override {
    double left = std::isfinite(input.left) ? input.left : 0, right = std::isfinite(input.right) ? input.right : 0;
    if (left == 0 && right == 0) {
      if (state_.zero_frames == descriptor_.maximum_tail_frames) return {};
      if (++state_.zero_frames == descriptor_.maximum_tail_frames) {
        reset(); state_.zero_frames = descriptor_.maximum_tail_frames; return {};
      }
    } else state_.zero_frames = 0;
    double source = .5 * (left + right), magnitude = std::abs(source);
    state_.fast += (magnitude > state_.fast ? fast_attack_ : fast_release_) * (magnitude - state_.fast);
    state_.slow += (magnitude > state_.slow ? slow_attack_ : slow_release_) * (magnitude - state_.slow);
    if (state_.refractory) --state_.refractory;
    if (state_.fast < state_.slow * 1.1 || state_.fast < .002) state_.attack_latched = false;
    if (!state_.pending && !state_.attack_latched && !state_.refractory
      && state_.fast > .008 && state_.fast > state_.slow * 1.35 + .002) {
      state_.pending = true; state_.pending_age = 0; state_.pending_peak = state_.fast;
      state_.attack_latched = true;
    }
    if (state_.pending) {
      ++state_.pending_age; state_.pending_peak = std::max(state_.pending_peak, state_.fast);
      if (state_.pending_age > maximum_wait_) state_.pending = false;
    }
    analyze(source);
    if (state_.pending && state_.pending_age >= minimum_wait_ && state_.frequency > 0) {
      if (!state_.string_active) state_.delay = state_.target_delay;
      pluck(); state_.pending = false; state_.refractory = refractory_frames_;
    }
    if (!state_.string_active) return {};
    state_.delay += glide_ * (state_.target_delay - state_.delay);
    double position = double(state_.string_cursor) - state_.delay;
    if (position < 0) position += string_capacity_;
    uint32_t first = uint32_t(position), next = (first + 1) % string_capacity_;
    double fraction = position - first;
    double sample = string_[first] + fraction * (string_[next] - string_[first]);
    double frequency = rate_ / (state_.delay + .5);
    double loss = std::exp(-std::log(1000.0) / (frequency * parameters_.decay_seconds));
    string_[state_.string_cursor] = loss * .5 * (sample + state_.previous_read);
    state_.previous_read = sample;
    state_.string_cursor = (state_.string_cursor + 1) % string_capacity_;
    float output = float(parameters_.output_gain * sample);
    return {output, output};
  }
  void reset() noexcept override {
    std::fill(input_, input_ + taps_ + 1, 0); std::fill(string_, string_ + string_capacity_, 0);
    state_ = {};
  }
  bool compatible(const Effect& other) const noexcept override {
    const auto* candidate = dynamic_cast<const GuitarResynth*>(&other);
    return candidate && rate_ == candidate->rate_ && parameters_.decay_seconds == candidate->parameters_.decay_seconds
      && parameters_.brightness == candidate->parameters_.brightness && parameters_.pick_strength == candidate->parameters_.pick_strength
      && parameters_.output_gain == candidate->parameters_.output_gain;
  }
  void copy_state(const Effect& other) noexcept override {
    const auto& source = static_cast<const GuitarResynth&>(other);
    std::copy(source.input_, source.input_ + taps_ + 1, input_);
    std::copy(source.string_, source.string_ + string_capacity_, string_); state_ = source.state_;
  }
  std::unique_ptr<Effect> snapshot() const noexcept override {
    auto result = make_string(rate_, parameters_);
    if (result) static_cast<GuitarResynth*>(result.get())->copy_state(*this);
    return result;
  }
  size_t memory_bytes() const noexcept override { return sizeof(*this) + size_t(2 * taps_ + 1 + string_capacity_) * sizeof(double); }
 private:
  double pitch_sample(uint32_t age) const noexcept { return state_.pitch[(state_.pitch_cursor + pitch_size - 1 - age) % pitch_size]; }
  void analyze(double source) noexcept {
    input_[state_.fir_cursor] = source;
    state_.resample_phase += increment_;
    if (state_.resample_phase >= 1) {
      state_.resample_phase -= 1;
      double current = 0, previous = 0;
      for (uint32_t tap = 0; tap < taps_; ++tap) {
        current += coefficients_[tap] * input_[(state_.fir_cursor + taps_ + 1 - tap) % (taps_ + 1)];
        previous += coefficients_[tap] * input_[(state_.fir_cursor + taps_ - tap) % (taps_ + 1)];
      }
      double fraction = 1 - state_.resample_phase / increment_;
      state_.pitch[state_.pitch_cursor] = previous + fraction * (current - previous);
      state_.pitch_cursor = (state_.pitch_cursor + 1) % pitch_size;
      if (state_.pitch_valid < pitch_size) ++state_.pitch_valid;
      if (++state_.hop == hop_size) { state_.hop = 0; estimate_pitch(); }
    }
    state_.fir_cursor = (state_.fir_cursor + 1) % (taps_ + 1);
  }
  void estimate_pitch() noexcept {
    state_.frequency = 0; state_.confidence = 0;
    if (state_.pitch_valid < window + maximum_lag) return;
    double energy = 0;
    for (uint32_t sample = 0; sample < window; ++sample) energy += pitch_sample(sample) * pitch_sample(sample);
    if (energy / window < 1e-6) return;
    std::array<double, maximum_lag + 1> normalized{};
    normalized[0] = 1;
    double cumulative = 0;
    for (uint32_t lag = 1; lag <= maximum_lag; ++lag) {
      double difference = 0;
      for (uint32_t sample = 0; sample < window; ++sample) {
        double delta = pitch_sample(sample) - pitch_sample(sample + lag); difference += delta * delta;
      }
      cumulative += difference;
      normalized[lag] = cumulative > 1e-20 ? difference * lag / cumulative : 1;
    }
    uint32_t selected = 0;
    for (uint32_t lag = 8; lag <= maximum_lag; ++lag) if (normalized[lag] < .15) {
      while (lag < maximum_lag && normalized[lag + 1] < normalized[lag]) ++lag;
      selected = lag; break;
    }
    if (!selected) return;
    double lag = selected;
    if (selected < maximum_lag) {
      double low = normalized[selected - 1], center = normalized[selected], high = normalized[selected + 1];
      double curvature = low - 2 * center + high;
      if (curvature > 1e-12) lag += std::clamp(.5 * (low - high) / curvature, -.5, .5);
    }
    lag = std::clamp(lag, 8.0, 100.0);
    state_.frequency = 8000 / lag; state_.confidence = std::clamp(1 - normalized[selected], 0.0, 1.0);
    state_.target_delay = rate_ / state_.frequency - .5;
  }
  double random() noexcept {
    state_.rng ^= state_.rng << 13; state_.rng ^= state_.rng >> 17; state_.rng ^= state_.rng << 5;
    return double(state_.rng) / 2147483648.0 - 1;
  }
  void pluck() noexcept {
    uint32_t count = std::min(string_capacity_, uint32_t(std::ceil(state_.delay)) + 2);
    double velocity = std::clamp(state_.pending_peak * 6, 0.0, 1.0);
    double amplitude = .18 * parameters_.pick_strength * velocity, mean = 0;
    double noise_mix = .05 + .3 * parameters_.brightness, period = state_.delay + .5;
    double pick_position = .25 - .07 * parameters_.brightness;
    for (uint32_t age = 1; age <= count; ++age) {
      double phase = double(age) / period; phase -= std::floor(phase);
      double triangle = phase < pick_position ? -1 + 2 * phase / pick_position
        : 1 - 2 * (phase - pick_position) / (1 - pick_position);
      double value = (1 - noise_mix) * triangle + noise_mix * random();
      uint32_t index = (state_.string_cursor + string_capacity_ - age) % string_capacity_;
      string_[index] += amplitude * value; mean += value;
    }
    mean *= amplitude / count;
    for (uint32_t age = 1; age <= count; ++age)
      string_[(state_.string_cursor + string_capacity_ - age) % string_capacity_] -= mean;
    state_.string_active = true;
  }
  EffectDescriptor descriptor_;
  StringParameters parameters_;
  double rate_;
  double* coefficients_;
  double* input_;
  double* string_;
  uint32_t taps_, string_capacity_;
  double increment_, fast_attack_, fast_release_, slow_attack_, slow_release_, glide_;
  uint64_t minimum_wait_, maximum_wait_, refractory_frames_;
  ResynthState state_;
};
bool bounded(double value, double minimum, double maximum) noexcept { return std::isfinite(value) && value >= minimum && value <= maximum; }
}
std::unique_ptr<Effect> make_string(double rate, StringParameters parameters) noexcept {
  if (!bounded(rate, 8000, 192000) || !bounded(parameters.decay_seconds, .05, 3)
    || !bounded(parameters.brightness, 0, 1) || !bounded(parameters.pick_strength, 0, 2)
    || !bounded(parameters.output_gain, 0, 2)) return nullptr;
  uint32_t taps = 2 * uint32_t(std::ceil(.002 * rate)) + 1;
  uint32_t string_capacity = uint32_t(std::ceil(rate / 80)) + 4;
  auto coefficients = std::unique_ptr<double[]>(new (std::nothrow) double[taps]);
  auto input = std::unique_ptr<double[]>(new (std::nothrow) double[taps + 1]{});
  auto string = std::unique_ptr<double[]>(new (std::nothrow) double[string_capacity]{});
  if (!coefficients || !input || !string) return nullptr;
  double cutoff = 2700 / rate, center = .5 * (taps - 1), sum = 0;
  for (uint32_t tap = 0; tap < taps; ++tap) {
    double offset = double(tap) - center;
    double sinc = offset == 0 ? 2 * cutoff : std::sin(2 * pi * cutoff * offset) / (pi * offset);
    double phase = 2 * pi * tap / (taps - 1);
    coefficients[tap] = sinc * (.42 - .5 * std::cos(phase) + .08 * std::cos(2 * phase)); sum += coefficients[tap];
  }
  for (uint32_t tap = 0; tap < taps; ++tap) coefficients[tap] /= sum;
  auto* effect = new (std::nothrow) GuitarResynth(rate, parameters, coefficients.get(), input.get(), string.get(), taps, string_capacity);
  if (!effect) return nullptr;
  coefficients.release(); input.release(); string.release(); return std::unique_ptr<Effect>(effect);
}
}
