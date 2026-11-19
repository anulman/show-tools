#include "shake_percussion.h"

#include <algorithm>
#include <cmath>
#include <new>

namespace patches {
namespace {
constexpr double tau = 6.2831853071795864769;

struct Collision {
  double time, strength, pitch, pan;
};
constexpr Collision tambourine[] = {
  {0, .92, 1, -.28}, {.004, .85, 1.13, .30}, {.008, .66, .93, -.40},
  {.014, .60, 1.26, .48}, {.022, .45, .88, .16}, {.037, .32, 1.08, -.36},
  {.054, .19, 1.20, .21},
};
constexpr Collision sleigh_bells[] = {
  {0, .78, 1, .28}, {.007, .94, .80, -.63}, {.016, .75, 1.24, .58},
  {.029, .62, .93, -.38}, {.044, .53, 1.10, .27}, {.060, .41, .80, -.63},
  {.081, .35, 1.24, .58}, {.107, .24, .95, -.34}, {.137, .16, 1.04, .28},
};
struct Mode { double frequency, amplitude, decay_seconds; };
// Decay is the time constant of each partial. Inharmonic partials give metal its ring.
constexpr Mode tambourine_modes[] = {
  {2305, .64, .016}, {3180, .90, .026}, {4510, .85, .020},
  {5920, .59, .012}, {7431, .40, .008}, {9180, .22, .005},
};
constexpr Mode bell_modes[] = {
  {1749, .60, .060}, {2539, .72, .081}, {3097, 1, .075},
  {4318, .68, .047}, {5609, .47, .031}, {6859, .25, .017},
};

double random_unit(uint32_t& state) noexcept {
  state ^= state << 13;
  state ^= state >> 17;
  state ^= state << 5;
  return double(state) / 4294967296.0;
}

template <size_t Hits, size_t Modes>
double render_hit(Stereo* pcm, uint32_t length, double rate, uint32_t seed,
                  const Collision (&collisions)[Hits], const Mode (&modes)[Modes],
                  double noise_amount) noexcept {
  for (const auto& hit : collisions) {
    const double timing = hit.time == 0 ? 0 : hit.time + .004 * (random_unit(seed) - .5);
    const uint32_t start = uint32_t(std::round(timing * rate));
    const double pitch = hit.pitch * (.965 + .07 * random_unit(seed));
    const double force = hit.strength * (.84 + .32 * random_unit(seed));
    const double left = std::sqrt(.5 * (1 - hit.pan)) * force;
    const double right = std::sqrt(.5 * (1 + hit.pan)) * force;
    for (const auto& mode : modes) {
      const double hz = mode.frequency * pitch;
      if (hz >= .45 * rate) continue;
      const double angle = tau * hz / rate;
      const double decay = std::exp(-1 / (mode.decay_seconds * rate));
      const double real = decay * std::cos(angle);
      const double imag = decay * std::sin(angle);
      double x = mode.amplitude * (.78 + .44 * random_unit(seed)), y = 0;
      const uint32_t end = std::min(length, start + uint32_t(8 * mode.decay_seconds * rate));
      for (uint32_t i = start; i < end; ++i) {
        const double previous = x;
        x = real * x - imag * y;
        y = imag * previous + real * y;
        pcm[i].left += float(y * left);
        pcm[i].right += float(y * right);
      }
    }
    double envelope = noise_amount, previous_noise = 0;
    const double decay = std::exp(-1 / (.0015 * rate));
    for (uint32_t i = start; i < std::min(length, start + uint32_t(.012 * rate)); ++i) {
      const double noise = 2 * random_unit(seed) - 1;
      const double click = (noise - previous_noise) * envelope;
      pcm[i].left += float(click * left);
      pcm[i].right += float(click * right);
      previous_noise = noise;
      envelope *= decay;
    }
  }

  const uint32_t fade = uint32_t(.02 * rate);
  double peak = 0;
  for (uint32_t i = 0; i < length; ++i) {
    if (i >= length - fade) {
      const float gain = float(length - 1 - i) / float(fade - 1);
      pcm[i].left *= gain;
      pcm[i].right *= gain;
    }
    peak = std::max({peak, double(std::abs(pcm[i].left)), double(std::abs(pcm[i].right))});
  }
  return peak;
}
}

std::unique_ptr<ShakePercussion> ShakePercussion::create(double rate) noexcept {
  if (!std::isfinite(rate) || rate < 16000 || rate > 192000) return nullptr;
  auto result = std::unique_ptr<ShakePercussion>(new (std::nothrow) ShakePercussion);
  if (!result) return nullptr;
  result->lengths_ = {uint32_t(std::ceil(.24 * rate)), uint32_t(std::ceil(.60 * rate))};
  for (size_t bank = 0; bank < result->banks_.size(); ++bank) {
    const uint32_t length = result->lengths_[bank];
    result->banks_[bank].reset(new (std::nothrow) Stereo[size_t(length) * variations]{});
    if (!result->banks_[bank]) return nullptr;
    for (unsigned variant = 0; variant < variations; ++variant) {
      Stereo* pcm = result->banks_[bank].get() + size_t(variant) * length;
      const uint32_t seed = 0x3569aec1u + variant * 432709u;
      const double peak = bank == 0
        ? render_hit(pcm, length, rate, seed, tambourine, tambourine_modes, .85)
        : render_hit(pcm, length, rate, seed, sleigh_bells, bell_modes, .22);
      if (!std::isfinite(peak) || peak <= 0) return nullptr;
      const float gain = float(.1 / peak);
      for (uint32_t i = 0; i < length; ++i) {
        pcm[i].left *= gain;
        pcm[i].right *= gain;
      }
    }
  }
  return result;
}

bool ShakePercussion::note_on(int note, int velocity) noexcept {
  if ((note != tambourine_note && note != sleigh_bells_note) || velocity < 0 || velocity > 127) return false;
  if (velocity == 0) return true;
  const size_t bank = note == tambourine_note ? 0 : 1;
  const uint32_t length = lengths_[bank];
  auto slot = std::find_if(voices_.begin(), voices_.end(), [](const Voice& voice) { return !voice.remaining; });
  if (slot == voices_.end()) return false;
  const unsigned variant = next_variation_[bank];
  const float strength = float(velocity) / 127.f;
  *slot = {banks_[bank].get() + size_t(variant) * length, length, strength * (.25f + .75f * strength)};
  next_variation_[bank] = (variant + 1) % variations;
  return true;
}

Stereo ShakePercussion::next() noexcept {
  Stereo output{};
  for (auto& voice : voices_) {
    if (!voice.remaining) continue;
    output.left += voice.pcm->left * voice.gain;
    output.right += voice.pcm->right * voice.gain;
    ++voice.pcm;
    --voice.remaining;
  }
  return output;
}

void ShakePercussion::reset() noexcept {
  voices_ = {};
  next_variation_ = {};
}

}
