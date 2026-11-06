#include "tuner.h"
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <new>
#include <stdexcept>
#include <vector>
static std::atomic<bool> track{false};
static std::atomic<unsigned> allocations{0};
void* operator new(std::size_t size) { if (track) ++allocations; if (auto p = std::malloc(size)) return p; throw std::bad_alloc(); }
void* operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void* p) noexcept { std::free(p); }
void operator delete[](void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }
void operator delete[](void* p, std::size_t) noexcept { std::free(p); }
static void check(bool ok, const char* message) { if (!ok) throw std::runtime_error(message); }
constexpr double pi = 3.14159265358979323846;
static std::vector<float> tone(double rate, double hz, double seconds, bool harmonics = false) {
  std::vector<float> result(static_cast<size_t>(rate * seconds));
  for (size_t i = 0; i < result.size(); ++i) {
    const double phase = 2 * pi * hz * i / rate;
    result[i] = static_cast<float>(0.12 * std::sin(phase) + (harmonics ? 0.2 * std::sin(2 * phase) + 0.08 * std::sin(3 * phase) : 0));
  }
  return result;
}
static void feed(tuner::Engine& e, const std::vector<float>& raw, uint32_t block = 128) {
  for (size_t i = 0; i < raw.size();) {
    const auto n = static_cast<uint32_t>(std::min<size_t>(block, raw.size() - i));
    e.process(raw.data() + i, nullptr, nullptr, n, true); i += n;
  }
}
static void scales() {
  tuner::Engine e(48000); auto s = e.snapshot();
  check(s.rootMidi == 48 && s.targetCount == 8 && s.targets[7].midi == 60, "default C3 major octave");
  const int expected[] = {48, 50, 52, 53, 55, 57, 59, 60};
  for (unsigned i = 0; i < 8; ++i) {
    s = e.snapshot(); check(s.targets[s.step].midi == expected[i], "major progression");
    check(e.confirm(s.commandRevision), "confirm accepted");
    check(!e.confirm(s.commandRevision), "repeated confirm rejected");
  }
  check(e.snapshot().complete && e.snapshot().previewKind == tuner::PreviewKind::Silent && e.cue(), "final confirm completes; last note remains audible");
  check(!e.configure(116, tuner::Scale::Major), "octave bound");
  check(!e.configure(48, static_cast<tuner::Scale>(99)), "scale bound");
  check(e.configure(54, tuner::Scale::Major), "configure F sharp");
  s = e.snapshot(); check(s.targets[6].letter == 'E' && s.targets[6].accidental == 1, "F sharp major spells E sharp");
  e.configure(58, tuner::Scale::NaturalMinor); s = e.snapshot();
  check(s.targets[2].letter == 'D' && s.targets[2].accidental == -1, "B flat minor spells D flat");
  e.configure(48, tuner::Scale::Chromatic); check(e.snapshot().targetCount == 13, "chromatic octave");
}
static void synthesis(double rate) {
  tuner::Engine e(rate); e.cue();
  const size_t length = static_cast<size_t>(std::llround(rate * 1.5));
  std::vector<float> left(length + 1000, 0), right(left.size(), 0), raw(left.size(), 0);
  e.process(raw.data(), left.data(), right.data(), static_cast<uint32_t>(left.size()), true);
  check(e.snapshot().previewKind == tuner::PreviewKind::Silent, "cue finite duration");
  check(left == right, "stereo cue equal");
  double peak = 0; unsigned crossings = 0;
  for (size_t i = 1; i < length; ++i) { peak = std::max(peak, std::abs(static_cast<double>(left[i]))); if (left[i - 1] <= 0 && left[i] > 0) ++crossings; }
  check(peak > .199 && peak <= .20001, "cue amplitude");
  check(std::abs(crossings / 1.5 - 130.81278265) < 1, "cue C3 frequency");
  check(left.front() == 0 && left[length - 1] == 0, "cue envelope endpoints");
  for (size_t i = length; i < left.size(); ++i) check(left[i] == 0, "cue exact stop");
  e.setListening(true); e.cue(); feed(e, tone(rate, 220, .2));
  check(e.snapshot().detector.status == tuner::PitchStatus::Reference, "own cue blocks detection");
  e.silence(); check(e.snapshot().detector.frequency == 0, "silence clears detection");
}
static void detection(double rate) {
  for (double hz : {50.0, 55.0, 130.81278265, 220.0 * std::exp2(23.0 / 1200), 440.0, 1000.0, 1450.0, 1500.0}) {
    tuner::Engine a(rate), b(rate); a.setListening(true); b.setListening(true);
    auto raw = tone(rate, hz, .5, hz < 1000);
    feed(a, raw, 128); feed(b, raw, 357);
    const auto x = a.snapshot(), y = b.snapshot();
    if (x.detector.status != tuner::PitchStatus::Pitched || std::abs(1200 * std::log2(x.detector.frequency / hz)) >= 12)
      std::fprintf(stderr, "pitch rate %.0f expected %.4f measured %.4f status %d\n", rate, hz, x.detector.frequency, static_cast<int>(x.detector.status));
    check(x.detector.status == tuner::PitchStatus::Pitched, "sine/harmonic pitch detected");
    check(std::abs(1200 * std::log2(x.detector.frequency / hz)) < 12, "pitch cents accuracy");
    check(x.detector.frequency == y.detector.frequency && x.frameCount == y.frameCount, "chunk partition invariant");
    check(x.commandRevision == 1, "telemetry does not increment revision");
    std::vector<float> quiet(static_cast<size_t>(rate * .3), 0); feed(a, quiet);
    check(a.snapshot().detector.status == tuner::PitchStatus::Unvoiced && a.snapshot().detector.frequency == 0, "silence clears stale pitch");
    a.microphoneLost(); check(a.snapshot().detector.status == tuner::PitchStatus::Microphone, "lost mic status");
    a.close(); check(a.snapshot().detector.status == tuner::PitchStatus::Off, "closed detector off");
  }
  tuner::Engine e(rate); e.setListening(true);
  std::vector<float> noise(static_cast<size_t>(rate * .4)); uint32_t rng = 123;
  for (auto& value : noise) { rng = 1664525 * rng + 1013904223; value = (static_cast<double>(rng) / 4294967296.0 - .5) * .3; }
  feed(e, noise); check(e.snapshot().detector.status == tuner::PitchStatus::Unvoiced, "noise rejected");
  std::fill(noise.begin(), noise.end(), std::numeric_limits<float>::quiet_NaN()); feed(e, noise);
  check(e.snapshot().detector.status == tuner::PitchStatus::Unvoiced && e.snapshot().detector.rms == 0, "nonfinite PCM ignored");
}
static void lifecycle() {
  tuner::Engine e(48000); e.setListening(true); e.cue();
  auto raw = tone(48000, 220, 1.5); feed(e, raw);
  check(e.snapshot().previewKind == tuner::PreviewKind::Silent && e.snapshot().detector.status == tuner::PitchStatus::Reference, "cue stop retains acoustic gate");
  feed(e, tone(48000, 220, .15));
  check(e.snapshot().detector.status == tuner::PitchStatus::Reference, "full 150ms acoustic gate");
  feed(e, tone(48000, 220, .2));
  check(e.snapshot().detector.status == tuner::PitchStatus::Pitched, "detection resumes after acoustic gate");
  e.cue(); const auto revision = e.snapshot().commandRevision;
  float output[16] = {}, input[16] = {};
  e.process(input, output, nullptr, 16, false);
  check(e.snapshot().previewKind == tuner::PreviewKind::Silent && e.snapshot().detector.status == tuner::PitchStatus::Microphone, "input loss clears cue and pitch");
  check(e.snapshot().commandRevision == revision, "input telemetry does not mutate command revision");
  e.process(input, output, nullptr, 16, true);
  e.cue(); e.silence();
  check(e.snapshot().detector.status == tuner::PitchStatus::Reference, "early cue stop retains acoustic gate");
  e.close(); const auto closed = e.snapshot().commandRevision; e.close();
  check(e.snapshot().commandRevision == closed + 1, "close always fences prior commands");
  check(!e.confirm(closed), "close rejects prior confirm");
  tuner::Engine invalid(std::numeric_limits<double>::quiet_NaN()); invalid.cue();
  check(invalid.snapshot().previewKind == tuner::PreviewKind::Note, "invalid direct constructor rate uses safe default");
}
static void preview(double rate, tuner::Scale scale) {
  tuner::Engine a(rate), b(rate), discarded(rate);
  for (auto* engine : {&a, &b, &discarded}) {
    engine->configure(48, scale); engine->setListening(true);
    engine->confirm(engine->snapshot().commandRevision);
    engine->confirm(engine->snapshot().commandRevision);
    check(engine->snapshot().previewKind == tuner::PreviewKind::Silent, "idle confirm is silent");
    check(engine->playScale(), "whole scale starts");
  }
  const auto initial = a.snapshot();
  const size_t note = static_cast<size_t>(std::llround(rate * 1.5));
  const size_t gap = static_cast<size_t>(std::ceil(rate * .15));
  const size_t length = initial.targetCount * note + (initial.targetCount - 1) * gap;
  std::vector<float> raw(length + gap, .1f), left(raw.size()), right(raw.size()), partition(raw.size());
  for (size_t step = 0; step < initial.targetCount; ++step) {
    const size_t offset = step * (note + gap);
    check(a.snapshot().previewKind == tuner::PreviewKind::Scale && a.snapshot().previewStep == step,
      "preview cursor follows sample clock");
    a.process(raw.data() + offset, left.data() + offset, right.data() + offset, static_cast<uint32_t>(note), true);
    unsigned crossings = 0;
    for (size_t i = offset + 1; i < offset + note; ++i)
      if (left[i - 1] <= 0 && left[i] > 0) ++crossings;
    const double hz = 440 * std::exp2((initial.targets[step].midi - 69) / 12.0);
    check(std::abs(crossings / 1.5 - hz) < 1, "whole scale PCM matches every native target");
    check(a.snapshot().step == 2 && !a.snapshot().complete, "preview never confirms exercise");
    if (step + 1 < initial.targetCount) {
      check(a.snapshot().previewKind == tuner::PreviewKind::Scale && a.snapshot().previewStep == step,
        "scale remains active through gap");
      a.process(raw.data() + offset + note, left.data() + offset + note, right.data() + offset + note,
        static_cast<uint32_t>(gap), true);
      for (size_t i = offset + note; i < offset + note + gap; ++i) check(left[i] == 0, "exact silent inter-note gap");
    }
  }
  check(a.snapshot().previewKind == tuner::PreviewKind::Silent, "last scale tone finishes");
  a.process(raw.data() + length, left.data() + length, right.data() + length, static_cast<uint32_t>(gap), true);
  check(a.snapshot().detector.status == tuner::PitchStatus::Reference, "scale retains full acoustic tail gate");
  check(a.snapshot().commandRevision == initial.commandRevision, "preview telemetry does not change revision");
  for (size_t i = 0; i < raw.size();) {
    const auto count = static_cast<uint32_t>(std::min<size_t>(357, raw.size() - i));
    b.process(raw.data() + i, partition.data() + i, nullptr, count, true);
    discarded.process(raw.data() + i, nullptr, nullptr, count, true); i += count;
  }
  check(left == right && left == partition, "whole scale stereo and block partition invariant");
  check(discarded.snapshot().previewKind == tuner::PreviewKind::Silent && discarded.snapshot().frameCount == a.snapshot().frameCount,
    "null output still advances whole scale");
  a.process(raw.data(), nullptr, nullptr, 1, true);
  check(a.snapshot().detector.status == tuner::PitchStatus::Warming, "analysis resumes after exact scale tail");
}
static void independentConfirm() {
  tuner::Engine a(48000), b(48000);
  a.cue(); b.cue();
  float input[1024] = {}, left[1024] = {}, right[1024] = {};
  a.process(input, left, nullptr, 1024, true); b.process(input, right, nullptr, 1024, true);
  for (unsigned i = 0; i < 8; ++i) check(a.confirm(a.snapshot().commandRevision), "confirm during reference accepted");
  std::fill_n(left, 1024, 0); std::fill_n(right, 1024, 0);
  a.process(input, left, nullptr, 1024, true); b.process(input, right, nullptr, 1024, true);
  check(std::equal(left, left + 1024, right), "confirm including completion never changes active PCM");
  check(a.snapshot().complete && a.snapshot().step == 7 && a.snapshot().previewStep == 0,
    "confirmed and preview cursors independent");
  a.silence(); check(a.cue() && a.snapshot().previewStep == 7, "completed exercise can hear final target");
  a.playScale(); b.playScale();
  b.configure(48, tuner::Scale::Major); b.playScale();
  std::fill_n(left, 1024, 0); std::fill_n(right, 1024, 0);
  a.process(input, left, nullptr, 1024, true); b.process(input, right, nullptr, 1024, true);
  b.confirm(b.snapshot().commandRevision);
  std::fill_n(left, 1024, 0); std::fill_n(right, 1024, 0);
  a.process(input, left, nullptr, 1024, true); b.process(input, right, nullptr, 1024, true);
  check(std::equal(left, left + 1024, right), "confirm never replaces scale preview");
  b.setListening(true); b.silence();
  check(b.snapshot().listening && b.snapshot().previewKind == tuner::PreviewKind::Silent, "stop preserves listen");
  b.playScale(); b.configure(54, tuner::Scale::NaturalMinor);
  check(b.snapshot().step == 0 && b.snapshot().previewStep == 0 && b.snapshot().previewKind == tuner::PreviewKind::Silent,
    "reconfigure stops preview and resets exercise");
  b.playScale(); b.microphoneLost();
  check(b.snapshot().previewKind == tuner::PreviewKind::Silent, "mic loss stops scale");
  b.playScale(); b.close();
  check(!b.snapshot().listening && b.snapshot().previewKind == tuner::PreviewKind::Silent, "close stops scale");
}
static void realtime() {
  tuner::Engine e(48000); e.setListening(true); auto raw = tone(48000, 220, .5);
  std::vector<float> left(raw.size()), right(raw.size()); allocations = 0; track = true;
  e.process(raw.data(), left.data(), right.data(), static_cast<uint32_t>(raw.size()), true);
  e.cue(); e.process(raw.data(), left.data(), right.data(), static_cast<uint32_t>(raw.size()), true);
  e.playScale();
  for (unsigned i = 0; i < 44; ++i) e.process(raw.data(), left.data(), right.data(), static_cast<uint32_t>(raw.size()), true);
  track = false; check(allocations == 0, "no process allocations");
}
int main() {
  try { scales(); synthesis(44100); synthesis(48000); detection(44100); detection(48000); lifecycle();
    independentConfirm(); preview(44100, tuner::Scale::Major); preview(48000, tuner::Scale::NaturalMinor);
    preview(48000, tuner::Scale::Chromatic); realtime();
    std::puts("PASS tuner native synthesis, scale, detector and allocation checks"); }
  catch (const std::exception& error) { std::fprintf(stderr, "FAIL %s\n", error.what()); return 1; }
}
