#ifndef SHOW_TOOLS_TRIBULATIONS_INTERNAL_H
#define SHOW_TOOLS_TRIBULATIONS_INTERNAL_H
#include "patch_engine.h"

namespace patches::tribulations {
struct StringParameters {
  double decay_seconds = 2.2, brightness = .62, pick_strength = .95, output_gain = 1.8;
};
struct FilterParameters {
  double input_highpass_hz = 90, drive_gain = 1.5;
  double envelope_attack_ms = 2, envelope_release_ms = 180, envelope_sensitivity = .006;
  double resting_hz = 350, sweep_octaves = 2.4, q = 1.25;
  double bandpass_mix = .60, post_lowpass_hz = 4600, output_gain = 1.3;
};
struct GarageAmpParameters {
  double drive_gain = 36, grit = 1, bias = .18, tone_hz = 4000, output_gain = .06;
};
std::unique_ptr<Effect> make_string(double rate, StringParameters parameters = {}) noexcept;
std::unique_ptr<Effect> make_filter(double rate, FilterParameters parameters = {}) noexcept;
std::unique_ptr<Effect> make_amp(double rate, GarageAmpParameters parameters = {}) noexcept;
double twang_saturation(double input) noexcept;
double antialiased_twang_saturation(double current, double previous) noexcept;
}
#endif
