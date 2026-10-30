#include "tribulations_guitar.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <new>
#include <vector>

namespace { bool watch_heap = false; unsigned allocations = 0, frees = 0; }
#ifndef __EMSCRIPTEN__
void* operator new(std::size_t bytes) {
  if (watch_heap) ++allocations;
  void* result = std::malloc(bytes ? bytes : 1);
  if (!result) std::abort();
  return result;
}
void* operator new[](std::size_t bytes) { return ::operator new(bytes); }
void operator delete(void* pointer) noexcept { if (watch_heap && pointer) ++frees; std::free(pointer); }
void operator delete[](void* pointer) noexcept { ::operator delete(pointer); }
void operator delete(void* pointer, std::size_t) noexcept { ::operator delete(pointer); }
void operator delete[](void* pointer, std::size_t) noexcept { ::operator delete(pointer); }
#endif
namespace {
using namespace patches;
constexpr double tau = 6.2831853071795864769;
std::vector<Stereo> fixture;
void require(bool condition, const char* message) {
  if (!condition) { std::fprintf(stderr, "FAIL %s\n", message); std::abort(); }
}
void equal(Stereo actual, Stereo expected, const char* message) {
  require(std::isfinite(actual.left) && std::isfinite(actual.right)
    && actual.left == expected.left && actual.right == expected.right, message);
}
struct NoHeap {
  NoHeap() { allocations = frees = 0; watch_heap = true; }
  ~NoHeap() { watch_heap = false; require(!allocations && !frees, "prepared process/copy/reset/capture/playback uses no C++ heap"); }
};
std::unique_ptr<Rack> prepare(double rate) {
  std::unique_ptr<Effect> stage[]{make_tribulations_guitar(rate)};
  auto rack = Rack::create(stage, 1);
  require(bool(rack), "fixed patch prepares");
  return rack;
}
float voice(unsigned frame, double rate, double frequency = 225.5) {
  double time = frame / rate - .05;
  if (time <= 0) return 0;
  double phase = tau * frequency * time;
  return float(.2 * std::min(1., time / .003) * (std::sin(phase) + .4 * std::sin(2 * phase) + .2 * std::sin(3 * phase)));
}
double pitch(const std::vector<Stereo>& output, double rate, unsigned begin, unsigned count) {
  unsigned low = unsigned(rate / 1000), high = unsigned(rate / 80);
  std::vector<double> correlation(high + 2);
  double best = 0;
  for (unsigned lag = low; lag <= high + 1; ++lag) {
    double ab = 0, aa = 0, bb = 0;
    for (unsigned i = 0; i < count - lag; ++i) {
      double a = output[begin + i].left, b = output[begin + i + lag].left;
      ab += a * b; aa += a * a; bb += b * b;
    }
    correlation[lag] = aa && bb ? ab / std::sqrt(aa * bb) : 0;
    if (lag <= high) best = std::max(best, correlation[lag]);
  }
  require(best > .8, "output has independently measurable periodicity");
  for (unsigned lag = low + 1; lag < high; ++lag) {
    if (correlation[lag] <= correlation[lag - 1] || correlation[lag] < correlation[lag + 1] || correlation[lag] < .95 * best) continue;
    double curvature = correlation[lag - 1] - 2 * correlation[lag] + correlation[lag + 1];
    double offset = curvature ? std::clamp(.5 * (correlation[lag - 1] - correlation[lag + 1]) / curvature, -.5, .5) : 0;
    return rate / (lag + offset);
  }
  require(false, "fundamental found"); return 0;
}
void approved_pcm(double rate) {
  // Frozen probes from the operator-approved V7 Legato route before extraction.
  const float at_44100[]{.0405620076f, .049643781f, .0475612208f, .0451213345f, .0339181088f};
  const float at_48000[]{.0419553518f, .0517083891f, .0500467978f, .0469074324f, .0344734453f};
  const float* expected = rate == 44100 ? at_44100 : at_48000;
  const double times[]{.09, .12, .2, .32, .49};
  auto effect = make_tribulations_guitar(rate);
  unsigned probe = 0;
  NoHeap guard;
  for (unsigned i = 0; i < unsigned(.5 * rate); ++i) {
    float x = voice(i, rate);
    auto output = effect->process({x, x});
    if (probe < 5 && i == unsigned(times[probe] * rate)) {
      require(std::abs(output.left - expected[probe]) < 1e-6f, "approved Legato PCM probes retain preset and signal order");
      ++probe;
    }
  }
  require(probe == 5, "all approved PCM probes observed");
}
void musical_output(double rate) {
  for (double frequency : {110., 225.5, 440.}) {
    auto rack = prepare(rate);
    std::vector<Stereo> output(unsigned(.5 * rate));
    unsigned onset = unsigned(output.size());
    double peak = 0;
    { NoHeap guard;
      for (unsigned i = 0; i < output.size(); ++i) {
        float sample = voice(i, rate, frequency);
        output[i] = rack->process({sample, sample});
        require(output[i].left == output[i].right && std::isfinite(output[i].left), "output is finite centered mono");
        if (std::abs(output[i].left) > 1e-5 && onset == output.size()) onset = i;
        peak = std::max(peak, double(std::abs(output[i].left)));
      }
    }
    double measured = pitch(output, rate, unsigned(.15 * rate), unsigned(.25 * rate));
    double cents = 1200 * std::log2(measured / frequency);
    double onset_ms = 1000 * (onset / rate - .05);
    require(std::abs(cents) < 20 && peak > .005 && peak < .5, "unquantized pitch and nominal headroom");
    require(onset_ms >= 15 && onset_ms < 120, "fixture onset includes pitch analysis and pluck wait");
    std::printf("guitar rate=%.0f target=%.6g measured=%.9g cents=%.4g onset_ms=%.4g peak=%.6g\n", rate, frequency, measured, cents, onset_ms, peak);
    fixture.insert(fixture.end(), output.begin(), output.end());
  }
  auto rack = prepare(rate);
  std::vector<Stereo> bend(unsigned(1.3 * rate));
  double phase = 0;
  { NoHeap guard;
    for (unsigned i = 0; i < bend.size(); ++i) {
      double t = i / rate - .05;
      float input = 0;
      if (t > 0) {
        phase += 220.7 * std::pow(279.3 / 220.7, t / 1.25) / rate;
        input = float(.2 * std::min(1., t / .003) * std::sin(tau * phase));
      }
      bend[i] = rack->process({input, input});
    }
  }
  double early = pitch(bend, rate, unsigned(.25 * rate), unsigned(.125 * rate));
  double late = pitch(bend, rate, unsigned(rate), unsigned(.125 * rate));
  require(late > early * 1.1, "free bend moves continuously rather than holding one snapped note");
  fixture.insert(fixture.end(), bend.begin(), bend.end());
  for (float velocity : {.2f, 5.f}) {
    rack->reset();
    double peak = 0;
    { NoHeap guard;
      for (unsigned i = 0; i < unsigned(.35 * rate); ++i) {
        float sample = velocity * voice(i, rate);
        auto value = rack->process({sample, sample});
        require(std::isfinite(value.left) && value.left == value.right && std::abs(value.left) < .5, "soft/strong articulation remains finite with headroom");
        peak = std::max(peak, double(std::abs(value.left)));
      }
    }
    require(peak > .001, "soft/strong articulation both excite the patch");
  }
}
void snapshots_and_capture(double rate) {
  unsigned warm = unsigned(.15 * rate), length = unsigned(.1 * rate), period = unsigned(.125 * rate);
  auto live = prepare(rate), reference = prepare(rate), endpoint = prepare(rate), restored = prepare(rate);
  auto wrong = prepare(rate == 48000 ? 44100 : 48000);
  auto take = ProcessedTake::create(*live, length, 1, 1);
  require(bool(take), "mono-source processed take prepares");
  auto playback = Playback::create(*take);
  require(bool(playback), "playback prepares");
  std::vector<float> input(length), left(length), right(length);
  for (unsigned i = 0; i < length; ++i) input[i] = voice(i + warm + 517, rate);
  { NoHeap guard;
    for (unsigned i = 0; i < warm; ++i) {
      float x = voice(i, rate); live->process({x, x}); reference->process({x, x}); endpoint->process({x, x});
    }
  }
  auto snapshot = live->snapshot();
  require(bool(snapshot), "snapshot prepares");
  { NoHeap guard;
    require(restored->copy_state(*snapshot) && !live->copy_state(*wrong), "warm graph copies, mismatched rate rejects atomically");
    for (unsigned i = 0; i < 517; ++i) {
      float x = voice(i + warm, rate);
      equal(live->process({x, x}), restored->process({x, x}), "complete filter/string/amp snapshot resumes exactly");
      reference->process({x, x}); endpoint->process({x, x});
    }
    require(take->begin(*live) && take->capture(*live, input.data(), nullptr, left.data(), right.data(), length)
      && take->commit(period), "capture seals original source, printed PCM, endpoint and virtual suffix");
    for (float x : input) endpoint->process({x, x});
    require(playback->start(true), "first-cycle playback starts");
    for (unsigned i = 0; i < period * 3 + 71; ++i) {
      float x = i % period < length ? input[i % period] : 0;
      equal(playback->next(), reference->process({x, x}), "printed first pass and evolved wraps match continuous original-source oracle");
    }
    playback->stop();
    for (uint64_t i = 0; i <= live->maximum_tail_frames(); ++i)
      equal(playback->next(), reference->process({}), "Stop preserves reached DSP history through bounded natural release");
    require(playback->state() == PlaybackState::idle, "bounded release unpins playback");
    require(playback->start_at_capture_end(true), "capture-end handoff starts without reprocessing prefix");
    for (unsigned i = 0; i < period * 3 + 71; ++i) {
      unsigned phase = (length + i) % period;
      float x = phase < length ? input[phase] : 0;
      equal(playback->next(), endpoint->process({x, x}), "END handoff keeps endpoint history and evolves subsequent loops");
    }
    playback->reset();
    require(take->reset_for_capture(), "reset releases bank for reuse");
    live->reset(); restored->reset();
    for (unsigned i = 0; i < warm; ++i) {
      float x = voice(i, rate); equal(live->process({x, x}), restored->process({x, x}), "reset restores deterministic excitation seed and all DSP state");
    }
  }
  auto pending = prepare(rate);
  for (unsigned i = 0; i < unsigned(.06 * rate); ++i) { float x = voice(i, rate); pending->process({x, x}); }
  auto pending_saved = pending->snapshot();
  require(pending_saved && restored->copy_state(*pending_saved), "pending pluck snapshot prepares");
  { NoHeap guard;
    for (unsigned i = unsigned(.06 * rate); i < warm; ++i) {
      float x = voice(i, rate); equal(pending->process({x, x}), restored->process({x, x}), "snapshot retains pending attack and tracker analysis horizon");
    }
  }
}
void admission_and_silence() {
  for (double bad : {0., 15999., 192001., std::numeric_limits<double>::quiet_NaN(), std::numeric_limits<double>::infinity()})
    require(!make_tribulations_guitar(bad), "rate validation");
  for (double rate : {16000., 192000.}) require(bool(make_tribulations_guitar(rate)), "inclusive supported rate endpoints");
  auto effect = make_tribulations_guitar(48000);
  require(std::strcmp(effect->descriptor().type, "tribulations_guitar") == 0 && effect->descriptor().parameter_count == 0,
    "canonical fixed patch descriptor");
  auto rack = prepare(48000);
  require(rack->supports_capture() && rack->maximum_tail_frames() == 192000, "complete snapshots and explicit four-second summed cap");
  for (unsigned mode = 0; mode < 4; ++mode) {
    rack->reset(); uint32_t rng = 0x1234abcd; float previous = 0;
    { NoHeap guard;
      for (unsigned i = 0; i < 24000; ++i) {
        rng = rng * 1664525u + 1013904223u;
        float noise = float(int32_t(rng)) / 2147483648.f * .2f;
        float x = mode == 0 ? 0 : mode == 1 ? (i == 100 ? 1.f : 0) : mode == 2 ? noise : (noise - previous) * .5f;
        previous = noise;
        equal(rack->process({x, x}), {}, "silence/impulse/noise/sibilance has no raw-voice bypass");
      }
    }
  }
  rack->reset(); auto mean = prepare(48000);
  { NoHeap guard;
    for (unsigned i = 0; i < 24000; ++i) {
      float x = voice(i, 48000);
      equal(rack->process({x, 0}), mean->process({.5f * x, .5f * x}), "stereo source is arithmetic mean, never boosted downmix");
    }
    for (uint64_t i = 0; i <= rack->maximum_tail_frames(); ++i) {
      auto value = rack->process({});
      if (i == rack->maximum_tail_frames()) equal(value, {}, "composed hard release cap reaches exact silence");
    }
    equal(effect->process({std::numeric_limits<float>::quiet_NaN(), std::numeric_limits<float>::infinity()}), {}, "nonfinite source sanitized before pitch tracking");
  }
}
}
int main(int argc, char** argv) {
  admission_and_silence();
  for (double rate : {44100., 48000.}) { approved_pcm(rate); musical_output(rate); snapshots_and_capture(rate); }
  if (argc == 3 && std::strcmp(argv[1], "--fixture") == 0) {
    FILE* file = std::fopen(argv[2], "wb"); require(file, "fixture opens");
    require(std::fwrite(fixture.data(), sizeof(Stereo), fixture.size(), file) == fixture.size(), "fixture writes");
    require(std::fclose(file) == 0, "fixture closes");
  } else require(argc == 1, "usage tribulations_guitar_tests [--fixture PATH]");
  std::printf("PASS canonical Tribulations guitar fixture_frames=%zu\n", fixture.size());
}
