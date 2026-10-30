#include "patch_engine.h"
#include "tribulations_guitar.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace {
int fail(const char* message) { std::fprintf(stderr, "%s\n", message); return 1; }
bool write(const char* path, const std::vector<float>& samples) {
  FILE* file = std::fopen(path, "wb");
  if (!file) return false;
  bool ok = std::fwrite(samples.data(), sizeof(float), samples.size(), file) == samples.size();
  return std::fclose(file) == 0 && ok;
}
bool number(const char* text, double& value) {
  char* end = nullptr; value = std::strtod(text, &end);
  return end != text && *end == '\0' && std::isfinite(value);
}
std::unique_ptr<patches::Effect> prepare(double rate, const char* patch) {
  if (std::strcmp(patch, "tribulations-guitar") == 0) return patches::make_tribulations_guitar(rate);
  if (std::strcmp(patch, "slapback") == 0) return patches::make_slapback(rate);
  if (std::strcmp(patch, "chorus") == 0) return patches::make_chorus(rate);
  return nullptr;
}

}
int main(int argc, char** argv) {
  if (argc == 4 && std::strcmp(argv[1], "--describe") == 0) {
    double rate;
    if (!number(argv[2], rate) || (rate != 44100 && rate != 48000)) return fail("Invalid descriptor sample rate.");
    auto effect = prepare(rate, argv[3]);
    if (!effect) return fail("Cannot prepare requested shared effect descriptor.");
    const auto& descriptor = effect->descriptor();
    std::printf("{\"type\":\"%s\",\"version\":%u,\"maximumTailFrames\":%llu}\n", descriptor.type, descriptor.version,
      static_cast<unsigned long long>(descriptor.maximum_tail_frames));
    return 0;
  }
  // Input path or "synthetic", channels, rate, input gain, output gain, patch, three raw outputs.
  if (argc != 10) return fail("Expected source, channels, rate, gains, patch, source/dry/processed output paths.");
  double channels_value, rate, input_gain, output_gain;
  if (!number(argv[2], channels_value) || (channels_value != 1 && channels_value != 2)
    || !number(argv[3], rate) || (rate != 44100 && rate != 48000)
    || !number(argv[4], input_gain) || input_gain < 0 || input_gain > 16
    || !number(argv[5], output_gain) || output_gain < 0 || output_gain > 16)
    return fail("Invalid channel count, sample rate, or explicit gain.");
  unsigned channels = unsigned(channels_value);
  auto effect = prepare(rate, argv[6]);
  if (!effect) return fail("Shared C++ effect preparation failed.");
  std::vector<float> input;
  if (std::strcmp(argv[1], "synthetic") == 0) {
    channels = 1; input.resize(size_t(rate * 2));
    constexpr double tau = 6.2831853071795864769;
    for (unsigned i = 0; i < input.size(); ++i) {
      double time = i / rate, local = std::fmod(time, .65) - .05;
      if (local <= 0 || local >= .5) continue;
      double frequency = time < .65 ? 110 : time < 1.3 ? 225.5 : 440;
      double phase = tau * frequency * local;
      input[i] = float(.2 * std::min(1., local / .003)
        * (std::sin(phase) + .4 * std::sin(2 * phase) + .2 * std::sin(3 * phase)));
    }
  } else {
    FILE* file = std::fopen(argv[1], "rb");
    if (!file) return fail("Cannot open decoded source.");
    if (std::fseek(file, 0, SEEK_END) != 0) { std::fclose(file); return fail("Cannot inspect decoded source."); }
    long bytes = std::ftell(file); std::rewind(file);
    if (bytes <= 0 || bytes % (long(channels) * 4) || bytes > long(rate * 30 * channels * 4)) {
      std::fclose(file); return fail("Decoded source must contain nonempty complete frames, at most thirty seconds.");
    }
    input.resize(size_t(bytes) / 4);
    bool ok = std::fread(input.data(), sizeof(float), input.size(), file) == input.size();
    if (std::fclose(file) != 0 || !ok) return fail("Cannot read decoded source completely.");
  }
  for (float x : input) if (!std::isfinite(x) || std::abs(x) > 1)
    return fail("Source contains nonfinite or out-of-range PCM. Supply finite samples within [-1, 1].");
  size_t frames = input.size() / channels;
  uint64_t tail = effect->descriptor().maximum_tail_frames;
  if (tail > uint64_t(rate * 12)) return fail("Patch exceeds the audition tool's twelve-second tail bound.");
  std::vector<float> mono(frames), dry((frames + tail) * 2), processed(dry.size());
  for (size_t i = 0; i < frames + tail; ++i) {
    float source = 0;
    if (i < frames) {
      source = channels == 1 ? input[i] : float(.5 * (double(input[2 * i]) + input[2 * i + 1]));
      mono[i] = source;
    }
    float driven = float(source * input_gain);
    auto value = effect->process({driven, driven});
    dry[2 * i] = dry[2 * i + 1] = float(driven * output_gain);
    processed[2 * i] = float(value.left * output_gain);
    processed[2 * i + 1] = float(value.right * output_gain);
    if (!std::isfinite(dry[2 * i]) || std::abs(dry[2 * i]) > 1
      || !std::isfinite(processed[2 * i]) || std::abs(processed[2 * i]) > 1
      || !std::isfinite(processed[2 * i + 1]) || std::abs(processed[2 * i + 1]) > 1)
      return fail("Rendered peak exceeds full scale. Lower the explicit input or output gain and rerun; no limiter or normalization was applied.");
  }
  if (!write(argv[7], mono) || !write(argv[8], dry) || !write(argv[9], processed))
    return fail("Could not write complete rendered PCM.");
  return 0;
}
