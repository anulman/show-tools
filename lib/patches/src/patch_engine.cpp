#include "patch_engine.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <new>

namespace patches {
namespace {
constexpr ParameterDescriptor slapback_parameters[] = {
  {"delay_ms", 40, 250, 100}, {"feedback", 0, .7, 0}, {"wet", 0, 1, .25}
};
class Slapback final : public Effect {
 public:
  Slapback(double rate, SlapbackParameters parameters, float* rings, uint32_t capacity) noexcept:
    descriptor_{"slapback", 1, 0, parameters.wet == 0 ? 0 : uint64_t(std::ceil(
      parameters.feedback == 0 ? rate * parameters.delay_ms / 1000 : rate * 12)), slapback_parameters, 3, true, true},
    parameters_(parameters), rate_(rate), rings_(rings), capacity_(capacity), delay_(rate * parameters.delay_ms / 1000) {}
  ~Slapback() override { delete[] rings_; }
  const EffectDescriptor& descriptor() const noexcept override { return descriptor_; }
  Stereo process(Stereo input) noexcept override {
    double position = double(cursor_) - delay_;
    if (position < 0) position += capacity_;
    uint32_t first = uint32_t(position), next = (first + 1) % capacity_;
    double fraction = position - first;
    double l = rings_[first] + fraction * (double(rings_[next]) - rings_[first]);
    double r = rings_[capacity_ + first] + fraction * (double(rings_[capacity_ + next]) - rings_[capacity_ + first]);
    rings_[cursor_] = float(input.left + parameters_.feedback * l);
    rings_[capacity_ + cursor_] = float(input.right + parameters_.feedback * r);
    cursor_ = (cursor_ + 1) % capacity_;
    return {float(input.left + parameters_.wet * l), float(input.right + parameters_.wet * r)};
  }
  void reset() noexcept override { std::fill(rings_, rings_ + size_t(capacity_) * 2, 0); cursor_ = 0; }
  bool compatible(const Effect& other) const noexcept override {
    const auto* candidate = dynamic_cast<const Slapback*>(&other);
    return candidate && rate_ == candidate->rate_ && parameters_.delay_ms == candidate->parameters_.delay_ms
      && parameters_.feedback == candidate->parameters_.feedback && parameters_.wet == candidate->parameters_.wet;
  }
  void copy_state(const Effect& other) noexcept override {
    const auto& source = static_cast<const Slapback&>(other);
    std::copy(source.rings_, source.rings_ + size_t(capacity_) * 2, rings_); cursor_ = source.cursor_;
  }
  std::unique_ptr<Effect> snapshot() const noexcept override {
    auto result = make_slapback(rate_, parameters_);
    if (result) static_cast<Slapback*>(result.get())->copy_state(*this);
    return result;
  }
  size_t memory_bytes() const noexcept override { return sizeof(*this) + size_t(capacity_) * 2 * sizeof(float); }
 private:
  EffectDescriptor descriptor_;
  SlapbackParameters parameters_;
  double rate_;
  float* rings_;
  uint32_t capacity_, cursor_ = 0;
  double delay_;
};
constexpr ParameterDescriptor chorus_parameters[] = {
  {"rate_hz", .05, 5, .8}, {"depth_ms", 0, 9, 5}, {"base_delay_ms", 10, 40, 20}, {"wet", 0, 1, .35}
};
class Chorus final : public Effect {
 public:
  Chorus(double rate, ChorusParameters parameters, float* rings, uint32_t capacity) noexcept:
    descriptor_{"chorus", 1, 0, parameters.wet == 0 ? 0 : uint64_t(std::ceil(
      rate * (parameters.base_delay_ms + parameters.depth_ms) / 1000)), chorus_parameters, 4, true, true},
    parameters_(parameters), rate_(rate), rings_(rings), capacity_(capacity), increment_(parameters.rate_hz / rate) {}
  ~Chorus() override { delete[] rings_; }
  const EffectDescriptor& descriptor() const noexcept override { return descriptor_; }
  Stereo process(Stereo input) noexcept override {
    constexpr double tau = 6.283185307179586476925286766559;
    double delay = rate_ * (parameters_.base_delay_ms + parameters_.depth_ms * std::sin(tau * phase_)) / 1000;
    double position = double(cursor_) - delay;
    if (position < 0) position += capacity_;
    uint32_t first = uint32_t(position), next = (first + 1) % capacity_;
    double fraction = position - first;
    double l = rings_[first] + fraction * (double(rings_[next]) - rings_[first]);
    double r = rings_[capacity_ + first] + fraction * (double(rings_[capacity_ + next]) - rings_[capacity_ + first]);
    rings_[cursor_] = input.left;
    rings_[capacity_ + cursor_] = input.right;
    cursor_ = (cursor_ + 1) % capacity_;
    phase_ += increment_;
    if (phase_ >= 1) phase_ -= 1;
    return {float(input.left + parameters_.wet * l), float(input.right + parameters_.wet * r)};
  }
  void reset() noexcept override { std::fill(rings_, rings_ + size_t(capacity_) * 2, 0); cursor_ = 0; phase_ = 0; }
  bool compatible(const Effect& other) const noexcept override {
    const auto* candidate = dynamic_cast<const Chorus*>(&other);
    return candidate && rate_ == candidate->rate_ && parameters_.rate_hz == candidate->parameters_.rate_hz
      && parameters_.depth_ms == candidate->parameters_.depth_ms && parameters_.base_delay_ms == candidate->parameters_.base_delay_ms
      && parameters_.wet == candidate->parameters_.wet;
  }
  void copy_state(const Effect& other) noexcept override {
    const auto& source = static_cast<const Chorus&>(other);
    std::copy(source.rings_, source.rings_ + size_t(capacity_) * 2, rings_);
    cursor_ = source.cursor_; phase_ = source.phase_;
  }
  std::unique_ptr<Effect> snapshot() const noexcept override {
    auto result = make_chorus(rate_, parameters_);
    if (result) static_cast<Chorus*>(result.get())->copy_state(*this);
    return result;
  }
  size_t memory_bytes() const noexcept override { return sizeof(*this) + size_t(capacity_) * 2 * sizeof(float); }
 private:
  EffectDescriptor descriptor_;
  ChorusParameters parameters_;
  double rate_;
  float* rings_;
  uint32_t capacity_, cursor_ = 0;
  double increment_, phase_ = 0;
};
bool output_valid(float* left, float* right, uint32_t frames) noexcept { return !frames || (left && right && left != right); }
Stereo input_at(const float* left, const float* right, uint32_t index) noexcept {
  return {left ? left[index] : 0, right ? right[index] : left ? left[index] : 0};
}
}
std::unique_ptr<Effect> make_slapback(double rate, SlapbackParameters parameters) noexcept {
  if (!std::isfinite(rate) || rate < 1000 || rate > 384000
    || !std::isfinite(parameters.delay_ms) || parameters.delay_ms < 40 || parameters.delay_ms > 250
    || !std::isfinite(parameters.feedback) || parameters.feedback < 0 || parameters.feedback > .7
    || !std::isfinite(parameters.wet) || parameters.wet < 0 || parameters.wet > 1) return nullptr;
  uint32_t capacity = uint32_t(std::ceil(rate * .25)) + 2;
  float* rings = new (std::nothrow) float[size_t(capacity) * 2]{};
  if (!rings) return nullptr;
  auto* effect = new (std::nothrow) Slapback(rate, parameters, rings, capacity);
  if (!effect) delete[] rings;
  return std::unique_ptr<Effect>(effect);
}
std::unique_ptr<Effect> make_chorus(double rate, ChorusParameters parameters) noexcept {
  if (!std::isfinite(rate) || rate < 1000 || rate > 384000
    || !std::isfinite(parameters.rate_hz) || parameters.rate_hz < .05 || parameters.rate_hz > 5
    || !std::isfinite(parameters.depth_ms) || parameters.depth_ms < 0 || parameters.depth_ms > 9
    || !std::isfinite(parameters.base_delay_ms) || parameters.base_delay_ms < 10 || parameters.base_delay_ms > 40
    || !std::isfinite(parameters.wet) || parameters.wet < 0 || parameters.wet > 1) return nullptr;
  uint32_t capacity = uint32_t(std::ceil(rate * (parameters.base_delay_ms + parameters.depth_ms) / 1000)) + 2;
  float* rings = new (std::nothrow) float[size_t(capacity) * 2]{};
  if (!rings) return nullptr;
  auto* effect = new (std::nothrow) Chorus(rate, parameters, rings, capacity);
  if (!effect) delete[] rings;
  return std::unique_ptr<Effect>(effect);
}
Rack::Rack(std::unique_ptr<Effect>* stages, size_t count) noexcept: stages_(stages), count_(count) {}
Rack::~Rack() { delete[] stages_; }
std::unique_ptr<Rack> Rack::create(std::unique_ptr<Effect>* stages, size_t count) noexcept {
  if (count > 64 || (count && !stages)) return nullptr;
  for (size_t index = 0; index < count; ++index) if (!stages[index]) return nullptr;
  auto* owned = count ? new (std::nothrow) std::unique_ptr<Effect>[count] : nullptr;
  if (count && !owned) return nullptr;
  auto* rack = new (std::nothrow) Rack(owned, count);
  if (!rack) { delete[] owned; return nullptr; }
  for (size_t index = 0; index < count; ++index) owned[index] = std::move(stages[index]);
  return std::unique_ptr<Rack>(rack);
}
Stereo Rack::process(Stereo input) noexcept {
  for (size_t index = 0; index < count_; ++index) input = stages_[index]->process(input);
  return input;
}
bool Rack::process(const float* left, const float* right, float* out_left, float* out_right, uint32_t frames) noexcept {
  if (!output_valid(out_left, out_right, frames)) return false;
  for (uint32_t index = 0; index < frames; ++index) {
    Stereo output = process(input_at(left, right, index)); out_left[index] = output.left; out_right[index] = output.right;
  }
  return true;
}
void Rack::reset() noexcept { for (size_t index = 0; index < count_; ++index) stages_[index]->reset(); }
bool Rack::compatible(const Rack& other) const noexcept {
  if (count_ != other.count_) return false;
  for (size_t index = 0; index < count_; ++index) if (!stages_[index]->compatible(*other.stages_[index])) return false;
  return true;
}
bool Rack::supports_capture() const noexcept {
  for (size_t index = 0; index < count_; ++index) {
    const auto& descriptor = stages_[index]->descriptor();
    if (!descriptor.deterministic_source_replay || !descriptor.complete_state_snapshot) return false;
  }
  return true;
}
bool Rack::copy_state(const Rack& other) noexcept {
  if (!compatible(other)) return false;
  for (size_t index = 0; index < count_; ++index) stages_[index]->copy_state(*other.stages_[index]);
  return true;
}
std::unique_ptr<Rack> Rack::snapshot() const noexcept {
  auto stages = std::unique_ptr<std::unique_ptr<Effect>[]>(count_ ? new (std::nothrow) std::unique_ptr<Effect>[count_] : nullptr);
  if (count_ && !stages) return nullptr;
  for (size_t index = 0; index < count_; ++index) { stages[index] = stages_[index]->snapshot(); if (!stages[index]) return nullptr; }
  return create(stages.get(), count_);
}
size_t Rack::memory_bytes() const noexcept {
  size_t bytes = sizeof(*this) + count_ * sizeof(std::unique_ptr<Effect>);
  for (size_t index = 0; index < count_; ++index) bytes += stages_[index]->memory_bytes();
  return bytes;
}
uint64_t Rack::maximum_tail_frames() const noexcept {
  uint64_t frames = 0;
  for (size_t index = 0; index < count_; ++index) {
    uint64_t tail = stages_[index]->descriptor().maximum_tail_frames;
    if (tail > std::numeric_limits<uint64_t>::max() - frames) return std::numeric_limits<uint64_t>::max();
    frames += tail;
  }
  return frames;
}
uint64_t Rack::latency_frames() const noexcept {
  uint64_t frames = 0;
  for (size_t index = 0; index < count_; ++index) frames += stages_[index]->descriptor().latency_frames;
  return frames;
}
ProcessedTake::ProcessedTake(std::unique_ptr<Rack> initial, std::unique_ptr<Rack> end, float* source, Stereo* printed, uint32_t capacity, uint64_t revision, uint32_t source_channels) noexcept:
  initial_(std::move(initial)), end_(std::move(end)), source_(source), printed_(printed), capacity_(capacity), source_channels_(source_channels), revision_(revision) {}
ProcessedTake::~ProcessedTake() { delete[] source_; delete[] printed_; }
std::unique_ptr<ProcessedTake> ProcessedTake::create(const Rack& definition, uint32_t capacity, uint64_t revision, uint32_t source_channels) noexcept {
  if (source_channels != 1 && source_channels != 2) return nullptr;
  uint64_t bytes = uint64_t(capacity) * (sizeof(Stereo) + source_channels * sizeof(float)) + sizeof(ProcessedTake);
  if (!capacity || bytes > std::numeric_limits<size_t>::max() || !definition.supports_capture()) return nullptr;
  auto initial = definition.snapshot();
  if (!initial || initial->memory_bytes() > std::numeric_limits<size_t>::max() - bytes) return nullptr;
  bytes += initial->memory_bytes();
  auto end = definition.snapshot();
  if (!end || end->memory_bytes() > std::numeric_limits<size_t>::max() - bytes) return nullptr;
  auto source = std::unique_ptr<float[]>(new (std::nothrow) float[size_t(capacity) * source_channels]);
  auto printed = std::unique_ptr<Stereo[]>(new (std::nothrow) Stereo[capacity]);
  if (!source || !printed) return nullptr;
  auto* take = new (std::nothrow) ProcessedTake(std::move(initial), std::move(end), source.get(), printed.get(), capacity, revision, source_channels);
  if (!take) return nullptr;
  source.release(); printed.release(); return std::unique_ptr<ProcessedTake>(take);
}
bool ProcessedTake::source_valid(const float* left, const float* right, uint32_t frames) const noexcept {
  if (source_channels_ == 2 || !right || left == right) return true;
  for (uint32_t index = 0; index < frames; ++index)
    if ((left ? left[index] : 0) != right[index]) return false;
  return true;
}
void ProcessedTake::write_source(uint32_t frame, Stereo source) noexcept {
  size_t offset = size_t(frame) * source_channels_;
  source_[offset] = source.left;
  if (source_channels_ == 2) source_[offset + 1] = source.right;
}
Stereo ProcessedTake::read_source(uint32_t frame) const noexcept {
  if (frame >= length_) return {};
  size_t offset = size_t(frame) * source_channels_;
  return {source_[offset], source_[offset + (source_channels_ == 2)]};
}
bool ProcessedTake::begin(const Rack& live) noexcept {
  if (state_ != TakeState::prepared || !initial_->copy_state(live)) return false;
  live_ = &live; state_ = TakeState::capturing; return true;
}
bool ProcessedTake::capture(Rack& live, const float* left, const float* right, float* out_left, float* out_right, uint32_t frames) noexcept {
  if (state_ != TakeState::capturing || live_ != &live || frames > capacity_ - length_
    || !output_valid(out_left, out_right, frames) || !initial_->compatible(live) || !source_valid(left, right, frames)) return false;
  for (uint32_t index = 0; index < frames; ++index) {
    Stereo source = input_at(left, right, index), output = live.process(source);
    write_source(length_, source); printed_[length_++] = output;
    out_left[index] = output.left; out_right[index] = output.right;
  }
  return true;
}
bool ProcessedTake::append_processed(const Rack& live, const float* source_left, const float* source_right,
  const float* processed_left, const float* processed_right, uint32_t frames) noexcept {
  if (state_ != TakeState::capturing || live_ != &live || frames > capacity_ - length_
    || (frames && (!processed_left || !processed_right)) || !initial_->compatible(live)
    || !source_valid(source_left, source_right, frames)) return false;
  for (uint32_t index = 0; index < frames; ++index) {
    write_source(length_, input_at(source_left, source_right, index));
    printed_[length_++] = {processed_left[index], processed_right[index]};
  }
  return true;
}
bool ProcessedTake::reset_for_capture() noexcept {
  if (active_playbacks_) return false;
  state_ = TakeState::prepared; length_ = period_ = 0; live_ = nullptr; return true;
}
bool ProcessedTake::commit(uint32_t period_frames) noexcept {
  if (state_ != TakeState::capturing || !length_ || (period_frames && period_frames < length_)) return false;
  if (!end_->copy_state(*live_)) return false;
  period_ = period_frames ? period_frames : length_;
  state_ = TakeState::committed; return true;
}
size_t ProcessedTake::memory_bytes() const noexcept { return sizeof(*this) + size_t(capacity_) * (sizeof(Stereo) + source_channels_ * sizeof(float)) + initial_->memory_bytes() + end_->memory_bytes(); }
Stereo ProcessedTake::sample(uint32_t frame) const noexcept { return frame < length_ ? printed_[frame] : Stereo{}; }
Playback::Playback(const ProcessedTake& take, std::unique_ptr<Rack> shadow) noexcept: take_(take), shadow_(std::move(shadow)) {}
std::unique_ptr<Playback> Playback::create(const ProcessedTake& take, PlaybackMode mode) noexcept {
  if (mode != PlaybackMode::evolving) return nullptr;
  auto shadow = take.initial_->snapshot();
  if (!shadow) return nullptr;
  return std::unique_ptr<Playback>(new (std::nothrow) Playback(take, std::move(shadow)));
}
Playback::~Playback() { finish(); }
void Playback::finish() noexcept {
  if (state_ != PlaybackState::idle) --take_.active_playbacks_;
  state_ = PlaybackState::idle; release_remaining_ = 0; grains_ = {};
}
bool Playback::start(bool loop, uint32_t start_frame) noexcept {
  if (start_frame >= take_.period_ || take_.state_ != TakeState::committed || !take_.length_ || !shadow_->copy_state(*take_.initial_)) return false;
  if (state_ == PlaybackState::idle) ++take_.active_playbacks_;
  clear_source_end(); source_begin_ = 0; window_period_ = take_.period_; repeat_phase_ = 0; printed_history_valid_ = true;
  grains_ = {}; phase_ = 0; rate_ = 1; iteration_ = 0; loop_ = loop; release_remaining_ = 0; state_ = PlaybackState::playing;
  seek_phase(start_frame); return true;
}
bool Playback::start_at_capture_end(bool loop) noexcept {
  if (take_.state_ != TakeState::committed || !take_.length_ || !shadow_->copy_state(*take_.end_)) return false;
  if (state_ == PlaybackState::idle) ++take_.active_playbacks_;
  clear_source_end(); source_begin_ = 0; window_period_ = take_.period_; repeat_phase_ = 0; printed_history_valid_ = true;
  grains_ = {}; phase_ = take_.length_; iteration_ = 1; loop_ = loop; release_remaining_ = 0; state_ = PlaybackState::playing; return true;
}
bool Playback::set_source_end(uint32_t exclusive_frame) noexcept {
  if (take_.state_ != TakeState::committed || exclusive_frame > take_.length_) return false;
  source_end_ = exclusive_frame; return true;
}
bool Playback::start_window(bool loop, uint32_t begin, uint32_t end, uint32_t period, const Rack& initial) noexcept {
  if (take_.state_ != TakeState::committed || begin > end || end > take_.length_ || !period || period < end - begin
    || !shadow_->copy_state(initial)) return false;
  if (state_ == PlaybackState::idle) ++take_.active_playbacks_;
  source_begin_ = begin; source_end_ = end; window_period_ = period; repeat_phase_ = 0;
  grains_ = {}; phase_ = 0; iteration_ = 0; loop_ = loop; release_remaining_ = 0; state_ = PlaybackState::playing;
  printed_history_valid_ = true; return true;
}
bool Playback::set_window(uint32_t begin, uint32_t end, uint32_t period) noexcept {
  if (take_.state_ != TakeState::committed || begin > end || end > take_.length_ || !period || period < end - begin) return false;
  if (source_begin_ != begin || source_end_ != end || window_period_ != period) {
    printed_history_valid_ = false;
    grains_ = {};
  }
  if (window_period_ != period) phase_ = std::fmod(phase_, double(period));
  source_begin_ = begin; source_end_ = end; window_period_ = period; repeat_phase_ = 0;
  return true;
}
bool Playback::start_window_at_capture_end(bool loop, uint32_t begin, uint32_t end, uint32_t period) noexcept {
  if (end != take_.length_ || !start_window(loop, begin, end, period, *take_.end_)) return false;
  printed_history_valid_ = false; iteration_ = 1; return true;
}
bool Playback::start_intro_loop(uint32_t repeat_frame, uint32_t end_frame, bool capture_handoff) noexcept {
  if (repeat_frame >= end_frame || !start_window(true, 0, end_frame, end_frame,
      capture_handoff ? *take_.end_ : *take_.initial_)) return false;
  repeat_phase_ = repeat_frame;
  if (capture_handoff) printed_history_valid_ = false;
  return true;
}
void Playback::set_semitones(double semitones) noexcept {
  if (!std::isfinite(semitones)) return;
  rate_ = std::pow(2.0, std::clamp(semitones, -3.0, 3.0) / 12.0);
  if (rate_ != 1) printed_history_valid_ = false;
}
void Playback::seek_phase(uint32_t phase) noexcept {
  if (state_ != PlaybackState::playing || !window_period_) return;
  phase %= window_period_;
  while (phase_ < phase) next();
}
void Playback::stop() noexcept {
  if (state_ != PlaybackState::playing) return;
  release_remaining_ = shadow_->maximum_tail_frames();
  if (release_remaining_) state_ = PlaybackState::releasing;
  else finish();
}
void Playback::reset() noexcept { rate_ = 1; shadow_->reset(); finish(); phase_ = 0; iteration_ = 0; clear_source_end(); printed_history_valid_ = true; }
Stereo Playback::next() noexcept {
  if (grains_.hop) grains_ = {};
  if (state_ == PlaybackState::playing && phase_ >= window_period_) {
    if (loop_) {
      phase_ = repeat_phase_ + std::fmod(phase_ - window_period_, double(window_period_ - repeat_phase_));
      if (iteration_ != std::numeric_limits<uint64_t>::max()) ++iteration_;
    } else stop();
  }
  if (state_ == PlaybackState::playing) {
    uint32_t source_frame = source_begin_ + uint32_t(phase_);
    bool suppressed = source_frame >= source_end_;
    if (suppressed) printed_history_valid_ = false;
    Stereo source = suppressed ? Stereo{} : take_.read_source(source_frame);
    if (!suppressed && rate_ != 1) {
      uint32_t following = source_frame + 1;
      if (following >= source_end_ || following >= source_begin_ + window_period_) following = source_begin_ + repeat_phase_;
      Stereo after = take_.read_source(following);
      double fraction = phase_ - std::floor(phase_);
      source.left += float((after.left - source.left) * fraction);
      source.right += float((after.right - source.right) * fraction);
    }
    Stereo evolved = shadow_->process(source);
    Stereo output = !iteration_ && printed_history_valid_ && source_frame < take_.length_ ? take_.printed_[source_frame] : evolved;
    phase_ += rate_; return output;
  }
  if (state_ == PlaybackState::releasing) {
    Stereo output = shadow_->process({});
    if (!--release_remaining_) finish();
    return output;
  }
  return {};
}
Stereo Playback::grain_sample(double phase) const noexcept {
  if (phase < 0 || phase >= window_period_) return {};
  const uint32_t frame = uint32_t(phase);
  const uint64_t source = uint64_t(source_begin_) + frame;
  if (source >= source_end_ || source >= take_.length_) return {};
  const Stereo before = take_.read_source(uint32_t(source));
  const float fraction = float(phase - frame);
  if (fraction == 0) return before;
  const Stereo after = frame + 1 < window_period_ && source + 1 < source_end_ && source + 1 < take_.length_
    ? take_.read_source(uint32_t(source + 1)) : Stereo{};
  return {before.left + (after.left - before.left) * fraction,
          before.right + (after.right - before.right) * fraction};
}

double Playback::grain_start(double desired, double outgoing, uint32_t hop) const noexcept {
  const int radius = int(hop / 3);
  if (!radius) return desired;
  double best = -2;
  int shift = 0;
  const auto score = [&](int offset) {
    double dot = 0, first_energy = 0, second_energy = 0;
    for (int sample = 0; sample < 16; ++sample) {
      const double at = double(sample) * hop / 16 * rate_;
      const Stereo a = grain_sample(outgoing + at), b = grain_sample(desired + offset + at);
      dot += double(a.left) * b.left + double(a.right) * b.right;
      first_energy += double(a.left) * a.left + double(a.right) * a.right;
      second_energy += double(b.left) * b.left + double(b.right) * b.right;
    }
    return first_energy > 1e-12 && second_energy > 1e-12
      ? dot / std::sqrt(first_energy * second_energy) : 0;
  };
  const auto consider = [&](int offset) {
    const double merit = score(offset) - .025 * std::abs(offset) / radius;
    if (merit > best) { best = merit; shift = offset; }
  };
  consider(0);
  const int step = std::max(1, radius / 8);
  for (int offset = -radius; offset <= radius; offset += step) consider(offset);
  const int coarse = shift;
  for (int offset = std::max(-radius, coarse - step); offset <= std::min(radius, coarse + step); ++offset) consider(offset);
  return desired + shift;
}

Stereo Playback::next_warped(double source_phase, uint32_t grain_frames) noexcept {
  if (state_ != PlaybackState::playing || !loop_ || !window_period_ || !std::isfinite(source_phase)) return next();
  if (source_phase < 0 || source_phase >= window_period_) {
    source_phase = std::fmod(source_phase, double(window_period_));
    if (source_phase < 0) source_phase += window_period_;
  }
  const uint32_t hop = std::max(1u, std::min({grain_frames / 2, window_period_ / 4, 2048u}));
  if (!grains_.hop) {
    const double outgoing = phase_ >= window_period_ ? source_phase : phase_;
    grains_ = {outgoing, source_phase, source_phase, hop, 0};
  } else if (source_phase + (window_period_ - repeat_phase_) / 2.0 < grains_.last_phase) {
    grains_ = {source_phase, source_phase, source_phase, hop, 0};
    if (iteration_ != std::numeric_limits<uint64_t>::max()) ++iteration_;
  } else if (grains_.elapsed == grains_.hop) {
    const double outgoing = grains_.incoming + grains_.hop * rate_;
    grains_ = {outgoing, grain_start(source_phase, outgoing, hop), source_phase, hop, 0};
  }
  grains_.last_phase = source_phase;
  const double motion = grains_.elapsed * rate_;
  const float fraction = float(grains_.elapsed++) / float(grains_.hop);
  const float blend = fraction * fraction * (3 - 2 * fraction);
  Stereo sample{};
  if (uint64_t(source_begin_) + uint32_t(source_phase) < std::min(source_end_, take_.length_)) {
    const Stereo a = grain_sample(grains_.outgoing + motion), b = grain_sample(grains_.incoming + motion);
    sample = {a.left + (b.left - a.left) * blend, a.right + (b.right - a.right) * blend};
  }
  phase_ = source_phase + 1;
  printed_history_valid_ = false;
  return shadow_->process(sample);
}

bool Playback::render(float* left, float* right, uint32_t frames) noexcept {
  if (!output_valid(left, right, frames)) return false;
  for (uint32_t index = 0; index < frames; ++index) {
    Stereo output = next(); left[index] = output.left; right[index] = output.right;
  }
  return true;
}
size_t Playback::memory_bytes() const noexcept { return sizeof(*this) + shadow_->memory_bytes(); }
}
