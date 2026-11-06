#include "tuner.h"
#include <algorithm>
#include <cmath>
#include <limits>
namespace tuner {
namespace {
constexpr double pi = 3.14159265358979323846;
constexpr int major[] = {0, 2, 4, 5, 7, 9, 11, 12};
constexpr int minor[] = {0, 2, 3, 5, 7, 8, 10, 12};
constexpr char letters[] = {'C', 'D', 'E', 'F', 'G', 'A', 'B'};
constexpr int naturals[] = {0, 2, 4, 5, 7, 9, 11};
constexpr int rootLetters[] = {0, 0, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6};
constexpr int rootAccidentals[] = {0, 1, 0, -1, 0, 0, 1, 0, -1, 0, -1, 0};
double validRate(double rate) {
  return std::isfinite(rate) && rate >= 8000 && rate <= 192000 ? rate : 48000;
}
double frequency(int midi) { return 440.0 * std::exp2((midi - 69) / 12.0); }
Target canonical(int midi) {
  const int pitchClass = (midi % 12 + 12) % 12;
  return {midi, letters[rootLetters[pitchClass]], rootAccidentals[pitchClass], midi / 12 - 1};
}
}
Engine::Engine(double sampleRate) : sampleRate_(validRate(sampleRate)),
  detectorRate_(sampleRate_ / std::ceil(sampleRate_ / 12000.0)),
  downsample_(static_cast<uint32_t>(std::ceil(sampleRate_ / 12000.0))),
  cueLength_(static_cast<uint64_t>(std::llround(sampleRate_ * 1.5))),
  gapLength_(static_cast<uint64_t>(std::ceil(sampleRate_ * 0.15))) {
  plan();
}
void Engine::plan() {
  state_.targets = {};
  state_.targetCount = state_.scale == Scale::Chromatic ? 13 : 8;
  const int rootLetter = rootLetters[state_.rootMidi % 12];
  const int rootOctave = state_.rootMidi / 12 - 1;
  for (uint32_t i = 0; i < state_.targetCount; ++i) {
    const int midi = state_.rootMidi + (state_.scale == Scale::Chromatic ? static_cast<int>(i) :
      (state_.scale == Scale::Major ? major[i] : minor[i]));
    if (state_.scale == Scale::Chromatic) state_.targets[i] = canonical(midi);
    else {
      const int letterIndex = rootLetter + static_cast<int>(i);
      const int octave = rootOctave + letterIndex / 7;
      const int naturalMidi = 12 * (octave + 1) + naturals[letterIndex % 7];
      state_.targets[i] = {midi, letters[letterIndex % 7], midi - naturalMidi, octave};
    }
  }
}
bool Engine::configure(int rootMidi, Scale scale) {
  if (state_.commandRevision == std::numeric_limits<uint32_t>::max()) return false;
  if (rootMidi < 0 || rootMidi > 115 || (scale != Scale::Major && scale != Scale::NaturalMinor && scale != Scale::Chromatic)) return false;
  state_.rootMidi = rootMidi; state_.scale = scale; state_.step = 0; state_.complete = false;
  stopPreview(); state_.previewStep = 0; plan(); clearDetector(idleStatus());
  if (state_.commandRevision != std::numeric_limits<uint32_t>::max()) ++state_.commandRevision; return true;
}
void Engine::beginTone(uint32_t step) {
  state_.previewStep = step; cueFrame_ = 0; cuePhase_ = 0;
  cueIncrement_ = 2 * pi * frequency(state_.targets[step].midi) / sampleRate_;
}
void Engine::beginPreview(PreviewKind kind, uint32_t step) {
  state_.previewKind = kind; beginTone(step);
  gateFrames_ = 0; clearDetector(idleStatus());
}
void Engine::stopPreview() {
  if (state_.previewKind != PreviewKind::Silent) gateFrames_ = gapLength_;
  state_.previewKind = PreviewKind::Silent;
}
bool Engine::cue() {
  if (state_.commandRevision == std::numeric_limits<uint32_t>::max()) return false;
  beginPreview(PreviewKind::Note, state_.step); ++state_.commandRevision; return true;
}
bool Engine::playScale() {
  if (state_.commandRevision == std::numeric_limits<uint32_t>::max()) return false;
  beginPreview(PreviewKind::Scale, 0); ++state_.commandRevision; return true;
}
bool Engine::confirm(uint32_t expectedRevision) {
  if (expectedRevision != state_.commandRevision || state_.complete || state_.commandRevision == std::numeric_limits<uint32_t>::max()) return false;
  if (state_.step + 1 == state_.targetCount) {
    state_.complete = true;
  } else { ++state_.step; }
  if (state_.commandRevision != std::numeric_limits<uint32_t>::max()) ++state_.commandRevision; return true;
}
bool Engine::setListening(bool listening) {
  if (listening && state_.commandRevision == std::numeric_limits<uint32_t>::max()) return false;
  state_.listening = listening; clearDetector(idleStatus()); if (state_.commandRevision != std::numeric_limits<uint32_t>::max()) ++state_.commandRevision; return true;
}
bool Engine::silence() {
  stopPreview(); clearDetector(idleStatus()); if (state_.commandRevision != std::numeric_limits<uint32_t>::max()) ++state_.commandRevision; return true;
}
bool Engine::microphoneLost() {
  microphoneReady_ = false; stopPreview();
  clearDetector(idleStatus()); if (state_.commandRevision != std::numeric_limits<uint32_t>::max()) ++state_.commandRevision; return true;
}
bool Engine::close() {
  state_.listening = false; stopPreview();
  clearDetector(PitchStatus::Off); if (state_.commandRevision != std::numeric_limits<uint32_t>::max()) ++state_.commandRevision; return true;
}
Snapshot Engine::snapshot() const { return state_; }
PitchStatus Engine::idleStatus() const {
  if (!state_.listening) return PitchStatus::Off;
  if (!microphoneReady_) return PitchStatus::Microphone;
  if (state_.previewKind != PreviewKind::Silent || gateFrames_) return PitchStatus::Reference;
  return PitchStatus::Warming;
}
void Engine::clearDetector(PitchStatus status) {
  state_.detector = {}; state_.detector.status = status;
  ringWrite_ = ringCount_ = hop_ = downsampleCount_ = 0; downsampleSum_ = 0;
}
void Engine::analyze() {
  constexpr uint32_t window = 1024;
  const auto maxLag = static_cast<uint32_t>(std::floor(detectorRate_ / 50));
  const auto minLag = static_cast<uint32_t>(std::floor(detectorRate_ / 1500));
  auto at = [&](uint32_t i) { return ring_[(ringWrite_ + 2048 - (window + maxLag) + i) % 2048]; };
  double sum = 0, square = 0;
  for (uint32_t i = 0; i < window; ++i) { const auto x = at(i); sum += x; square += x * x; }
  auto& result = state_.detector;
  result = {}; result.status = PitchStatus::Unvoiced;
  result.rms = std::sqrt(std::max(0.0, square / window - (sum / window) * (sum / window)));
  if (result.rms < 0.005) return;
  double cumulative = 0;
  difference_[0] = 1;
  for (uint32_t lag = 1; lag <= maxLag; ++lag) {
    double difference = 0;
    for (uint32_t i = 0; i < window; ++i) { const double d = at(i) - at(i + lag); difference += d * d; }
    cumulative += difference;
    difference_[lag] = cumulative > 0 ? difference * lag / cumulative : 1;
  }
  uint32_t selected = 0;
  for (uint32_t lag = std::max(2u, minLag); lag < maxLag; ++lag) {
    if (difference_[lag] < 0.15) {
      while (lag + 1 < maxLag && difference_[lag + 1] < difference_[lag]) ++lag;
      selected = lag; break;
    }
  }
  if (!selected) return;
  const double a = difference_[selected - 1], b = difference_[selected], c = difference_[selected + 1];
  const double denominator = 2 * (a - 2 * b + c);
  const double estimate = selected + (std::abs(denominator) > 1e-12 ? (a - c) / denominator : 0);
  auto error = [&](double period) {
    const auto base = static_cast<uint32_t>(std::floor(period));
    const double t = period - base;
    double total = 0;
    for (uint32_t i = 0; i < window - 2; ++i) {
      const double y0 = at(i + base - 1), y1 = at(i + base);
      const double y2 = at(i + base + 1), y3 = at(i + base + 2);
      const double interpolated = y1 + 0.5 * t * (y2 - y0 + t *
        (2 * y0 - 5 * y1 + 4 * y2 - y3 + t * (3 * (y1 - y2) + y3 - y0)));
      const double d = at(i) - interpolated;
      total += d * d;
    }
    return total;
  };
  double low = std::max(2.0, estimate - 0.75), high = std::min(static_cast<double>(maxLag - 1), estimate + 0.75);
  for (int iteration = 0; iteration < 14; ++iteration) {
    const double first = low + (high - low) / 3, second = high - (high - low) / 3;
    if (error(first) < error(second)) high = second; else low = first;
  }
  const double estimateHz = detectorRate_ / ((low + high) / 2);
  if (estimateHz < 49.99 || estimateHz > 1500.3 || !std::isfinite(estimateHz)) return;
  const double hz = std::clamp(estimateHz, 50.0, 1500.0);
  result.status = PitchStatus::Pitched; result.frequency = hz;
  result.midi = 69 + 12 * std::log2(hz / 440);
  result.roundedMidi = static_cast<int>(std::lround(result.midi));
  result.cents = 100 * (result.midi - result.roundedMidi);
  result.confidence = std::clamp(1 - b, 0.0, 1.0); result.note = canonical(result.roundedMidi);
}
void Engine::process(const float* raw, float* left, float* right, uint32_t frames, bool microphoneReady) {
  if (!microphoneReady || !raw) {
    if (microphoneReady_) { stopPreview(); }
    microphoneReady_ = false; clearDetector(idleStatus());
  } else if (!microphoneReady_) { microphoneReady_ = true; clearDetector(idleStatus()); }
  const uint32_t required = 1024 + static_cast<uint32_t>(std::floor(detectorRate_ / 50));
  for (uint32_t i = 0; i < frames; ++i) {
    const bool gated = state_.previewKind != PreviewKind::Silent || gateFrames_ > 0;
    if (state_.previewKind != PreviewKind::Silent && cueFrame_ < cueLength_) {
      const double attack = std::min(1.0, static_cast<double>(cueFrame_) / (sampleRate_ * 0.01));
      const double release = std::min(1.0, static_cast<double>(cueLength_ - 1 - cueFrame_) / (sampleRate_ * 0.03));
      const float sample = static_cast<float>(0.2 * std::sin(cuePhase_) * attack * release);
      if (left) left[i] += sample;
      if (right) right[i] += sample;
      cuePhase_ += cueIncrement_; if (cuePhase_ >= 2 * pi) cuePhase_ = std::fmod(cuePhase_, 2 * pi);
      if (++cueFrame_ == cueLength_ &&
          (state_.previewKind == PreviewKind::Note || state_.previewStep + 1 == state_.targetCount)) stopPreview();
    } else if (state_.previewKind == PreviewKind::Scale) {
      if (++cueFrame_ == cueLength_ + gapLength_) beginTone(state_.previewStep + 1);
    } else if (gateFrames_) --gateFrames_;
    if (state_.listening && microphoneReady_) {
      if (gated) {
        if (state_.detector.status != PitchStatus::Reference) clearDetector(PitchStatus::Reference);
      } else {
        if (state_.detector.status == PitchStatus::Reference) clearDetector(PitchStatus::Warming);
        const double input = std::isfinite(raw[i]) ? raw[i] : 0;
        downsampleSum_ += input;
        if (++downsampleCount_ == downsample_) {
          ring_[ringWrite_] = downsampleSum_ / downsample_; ringWrite_ = (ringWrite_ + 1) % 2048;
          ringCount_ = std::min(2048u, ringCount_ + 1); downsampleCount_ = 0; downsampleSum_ = 0;
          if (++hop_ >= 256 && ringCount_ >= required) { hop_ = 0; analyze(); }
        }
      }
    }
    ++state_.frameCount;
  }
}
}
