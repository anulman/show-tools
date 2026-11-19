#ifndef SHOW_TOOLS_SHAKE_PERCUSSION_H
#define SHOW_TOOLS_SHAKE_PERCUSSION_H
#include "patch_engine.h"

#include <array>

namespace patches {

inline constexpr int tambourine_note = 54;
inline constexpr int sleigh_bells_note = 83;

// The render owner submits note-ons at the desired audio frame, before next().
class ShakePercussion final {
 public:
  static std::unique_ptr<ShakePercussion> create(double sample_rate) noexcept;
  ShakePercussion(const ShakePercussion&) = delete;
  ShakePercussion& operator=(const ShakePercussion&) = delete;
  bool note_on(int note, int velocity) noexcept;
  Stereo next() noexcept;
  void reset() noexcept;

 private:
  static constexpr unsigned variations = 6;
  static constexpr unsigned max_polyphony = 8;
  struct Voice {
    const Stereo* pcm = nullptr;
    uint32_t remaining = 0;
    float gain = 0;
  };

  ShakePercussion() = default;
  std::array<std::unique_ptr<Stereo[]>, 2> banks_;
  std::array<uint32_t, 2> lengths_{};
  std::array<unsigned, 2> next_variation_{};
  std::array<Voice, max_polyphony> voices_{};
};

}
#endif
