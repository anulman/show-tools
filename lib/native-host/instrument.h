#ifndef SHOW_TOOLS_NATIVE_INSTRUMENT_H
#define SHOW_TOOLS_NATIVE_INSTRUMENT_H

#include "audio_pump.h"
#include <array>
#include <memory>

namespace native_host {
enum class Lifecycle { Stopped, Prepared, Running, Faulted };
struct InstrumentConfig { double sample_rate; int max_voices; double max_seconds; uint32_t block_capacity; bool microphone_ready; };
struct Profiles {
  std::array<uint32_t, PF_VOICE_PROFILES> counts, revisions;
  const pf_effect_definition* effects;
  uint32_t effect_count;
};
struct Start { double bpm; int count_in_bars, start_bar, end_bar, loop, automatic; };
class Instrument {
public:
  explicit Instrument(InstrumentConfig config);
  bool prepare(const uint8_t* packet, uint32_t bytes, const Profiles& profiles);
  bool prepare_profiles(const Profiles& profiles);
  bool start(const Start& start);
  bool can_start() const;
  void stop();
  int control(int id, double value);
  int select(int channel);
  int set_channel(int channel, double gain, int muted);
  int set_automatic(int enabled);
  int set_click(int enabled);
  int set_click_gain(double gain);
  int set_jiggle_thresholds(double travel, double reversal);
  int tuner(int operation, uint32_t expected_revision, int value, int scale);
  bool audio_needed() const;
  int render(const float* input, uint32_t frames);
  int64_t write(AudioPump::Write sink, void* context);
  Lifecycle lifecycle() const;
  pf_engine* engine() const;
  uint32_t pending() const;
private:
  using Engine = std::unique_ptr<pf_engine, decltype(&pf_destroy)>;
  InstrumentConfig config_;
  Lifecycle lifecycle_ = Lifecycle::Stopped;
  Engine engine_{nullptr, pf_destroy};
  std::unique_ptr<AudioPump> pump_;
  bool utility_output_ = false;
};
}
#endif
