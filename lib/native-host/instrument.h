#ifndef SHOW_TOOLS_NATIVE_INSTRUMENT_H
#define SHOW_TOOLS_NATIVE_INSTRUMENT_H

#include "audio_pump.h"
#include <array>
#include <memory>

namespace native_host {
enum class Lifecycle { Stopped, Prepared, Running, Faulted };
struct InstrumentConfig { double sample_rate; int max_voices; double max_seconds; uint32_t block_capacity; bool microphone_ready; bool idle_microphone_monitor = false; };
struct Profiles {
  std::array<uint32_t, PF_VOICE_PROFILES> counts, revisions;
  const pf_effect_definition* effects;
  uint32_t effect_count;
};
struct ExternalWave { uint32_t slot; std::vector<uint8_t> bytes; };
struct Start { double bpm; int count_in_bars, start_bar, end_bar, loop, automatic; };
class Instrument {
public:
  explicit Instrument(InstrumentConfig config);
  bool prepare(const uint8_t* packet, uint32_t bytes, const Profiles& profiles,
               const std::vector<ExternalWave>& waves = {});
  bool prepare_profiles(const Profiles& profiles);
  bool start(const Start& start);
  bool can_start() const;
  void stop();
  int control(int id, double value);
  int input_attach(uint32_t producer, double session, double generation, uint32_t kind, uint32_t released, uint32_t held);
  int input_event(uint32_t producer, double session, double generation, double sequence, uint32_t input, double value);
  int input_revoke(uint32_t producer, double session);
  int select(int channel);
  int set_channel(int channel, double gain, int muted);
  int set_automatic(int enabled);
  int set_click(int enabled);
  int set_click_gain(double gain);
  int set_jiggle_thresholds(double travel, double reversal);
  int prepare_external_wave(uint32_t slot, const uint8_t* bytes, uint32_t length);
  int tuner(int operation, uint32_t expected_revision, int value, int scale);
  bool audio_needed() const;
  bool idle_monitor_only() const;
  bool supports_audition() const { return config_.idle_microphone_monitor; }
  int audition_profile() const { return audition_profile_; }
  int audition(int profile);
  int render(const float* input, uint32_t frames);
  int64_t write(AudioPump::Write sink, void* context);
  Lifecycle lifecycle() const;
  pf_engine* engine() const;
  uint32_t pending() const;
  const AudioPump* mix() const { return pump_.get(); }
private:
  using Engine = std::unique_ptr<pf_engine, decltype(&pf_destroy)>;
  InstrumentConfig config_;
  Lifecycle lifecycle_ = Lifecycle::Stopped;
  Engine engine_{nullptr, pf_destroy};
  std::unique_ptr<AudioPump> pump_;
  enum class IdleMonitor { Disabled, Enabled, PanicMuted };
  enum class Output { Performance, Tuner, IdleMonitor };
  IdleMonitor idle_monitor_;
  int audition_profile_ = -1;
  Output output_ = Output::Performance;
  bool monitoring() const;
  void silence_panic();
};
}
#endif
