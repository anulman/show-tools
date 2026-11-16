#include "instrument.h"
#include <cmath>

namespace native_host {
namespace {
bool valid(const Profiles& profiles) {
  uint64_t total = 0;
  for (uint32_t count : profiles.counts) {
    if (count > PF_MAX_LIVE_EFFECTS) return false;
    total += count;
  }
  return total == profiles.effect_count && (!total || profiles.effects);
}
}
Instrument::Instrument(InstrumentConfig config) : config_(config) {}
bool Instrument::prepare(const uint8_t* packet, uint32_t bytes, const Profiles& profiles) {
  if (lifecycle_ == Lifecycle::Running || lifecycle_ == Lifecycle::Faulted || pending() || !packet || !bytes ||
      !valid(profiles) || bytes > 8 * 1024 * 1024 || !std::isfinite(config_.sample_rate) || config_.sample_rate <= 0 || config_.max_voices <= 0 ||
      !std::isfinite(config_.max_seconds) || config_.max_seconds <= 0 || !config_.block_capacity) return false;
  Engine candidate(pf_create(config_.sample_rate, PF_PRACTICE, config_.max_voices, config_.max_seconds, 4), pf_destroy);
  if (!candidate || pf_prepare_voice_effects(candidate.get(), profiles.effects, profiles.counts.data(), profiles.revisions.data()) < 0 ||
      pf_load_compiled_bytes(candidate.get(), packet, bytes) < 0 || pf_set_microphone(candidate.get(), config_.microphone_ready ? 1 : 0) < 0) return false;
  if (engine_ && pf_input_inherit(candidate.get(), engine_.get()) < 0) return false;
  auto pump = std::make_unique<AudioPump>(candidate.get(), config_.block_capacity);
  pump_ = std::move(pump); engine_ = std::move(candidate); lifecycle_ = Lifecycle::Prepared;
  return true;
}
bool Instrument::prepare_profiles(const Profiles& profiles) {
  return lifecycle_ == Lifecycle::Prepared && !pending() && valid(profiles) &&
    pf_prepare_voice_effects(engine_.get(), profiles.effects, profiles.counts.data(), profiles.revisions.data()) == 0;
}
bool Instrument::start(const Start& start) {
  if (!can_start() || pf_start(engine_.get(), start.bpm, start.count_in_bars, start.start_bar,
      start.end_bar, start.loop, start.automatic) < 0) return false;
  if (utility_output_) pump_->discard();
  utility_output_ = false;
  lifecycle_ = Lifecycle::Running; return true;
}
bool Instrument::can_start() const { return lifecycle_ == Lifecycle::Prepared && (!pending() || utility_output_); }
void Instrument::stop() {
  if (!engine_) return;
  pf_stop(engine_.get()); pump_->discard();
  if (lifecycle_ != Lifecycle::Faulted) lifecycle_ = Lifecycle::Prepared;
}
int Instrument::prepare_external_wave(uint32_t slot, const uint8_t* bytes, uint32_t length) {
  if (!engine_ || lifecycle_ != Lifecycle::Prepared || pending()) return -1;
  return pf_prepare_external_wav(engine_.get(), slot, bytes, length);
}
int Instrument::control(int id, double value) {
  if (!engine_ || lifecycle_ == Lifecycle::Faulted) return -1;
  int result = pf_control(engine_.get(), id, value, nullptr, 0);
  if (result == 0 && id == 4) { pump_->discard(); lifecycle_ = Lifecycle::Prepared; }
  return result;
}
int Instrument::input_attach(uint32_t producer, double session, double generation, uint32_t kind, uint32_t released, uint32_t held) {
  return engine_ && lifecycle_ != Lifecycle::Faulted
    ? pf_input_attach(engine_.get(), producer, session, generation, kind, released, held) : -1;
}
int Instrument::input_event(uint32_t producer, double session, double generation, double sequence, uint32_t input, double value) {
  if (!engine_ || lifecycle_ == Lifecycle::Faulted) return -1;
  const bool panic = pf_input_is_panic(engine_.get(), producer, session, generation, sequence, input, value) == 1;
  const int result = pf_input_event(engine_.get(), producer, session, generation, sequence, input, value);
  if (result == 0 && panic) { pump_->discard(); lifecycle_ = Lifecycle::Prepared; }
  return result;
}
int Instrument::input_revoke(uint32_t producer, double session) {
  return engine_ && lifecycle_ != Lifecycle::Faulted ? pf_input_revoke(engine_.get(), producer, session) : -1;
}
int Instrument::select(int channel) { return engine_ && lifecycle_ != Lifecycle::Faulted ? pf_select(engine_.get(), channel) : -1; }
int Instrument::set_channel(int channel, double gain, int muted) { return engine_ && lifecycle_ != Lifecycle::Faulted ? pf_set_channel(engine_.get(), channel, gain, muted) : -1; }
int Instrument::set_automatic(int enabled) { return engine_ && lifecycle_ != Lifecycle::Faulted ? pf_set_automatic(engine_.get(), enabled) : -1; }
int Instrument::set_click(int enabled) { return engine_ && lifecycle_ != Lifecycle::Faulted ? pf_set_click(engine_.get(), enabled) : -1; }
int Instrument::set_click_gain(double gain) { return engine_ && lifecycle_ != Lifecycle::Faulted ? pf_set_click_gain(engine_.get(), gain) : -1; }
int Instrument::set_jiggle_thresholds(double travel, double reversal) {
  return engine_ && (lifecycle_ == Lifecycle::Prepared || lifecycle_ == Lifecycle::Running)
    ? pf_set_jiggle_thresholds(engine_.get(), travel, reversal) : -1;
}
int Instrument::tuner(int operation, uint32_t expected_revision, int value, int scale) {
  return engine_ && (lifecycle_ == Lifecycle::Prepared || ((operation == PF_TUNER_CLOSE || operation == PF_TUNER_SILENCE) && lifecycle_ == Lifecycle::Running))
    ? pf_tuner_command_apply(engine_.get(), operation, expected_revision, value, scale) : -1;
}
bool Instrument::audio_needed() const { return engine_ && lifecycle_ != Lifecycle::Faulted && pf_audio_needed(engine_.get()); }
int Instrument::render(const float* input, uint32_t frames) {
  if (!audio_needed()) return -1;
  const bool running = lifecycle_ == Lifecycle::Running;
  if (pump_->render(input, frames) < 0) { lifecycle_ = Lifecycle::Faulted; return -1; }
  utility_output_ = !running;
  if (!running) return 0;
  std::array<double, PF_FIELDS> state{};
  pf_snapshot(engine_.get(), state.data());
  if (state[PF_PHASE] == PF_ENDED) lifecycle_ = Lifecycle::Prepared;
  else if (state[PF_PHASE] == PF_IDLE) lifecycle_ = state[PF_ERROR] ? Lifecycle::Faulted : Lifecycle::Prepared;
  return 0;
}
int64_t Instrument::write(AudioPump::Write sink, void* context) {
  if (!pump_ || !pump_->pending()) return -1;
  auto result = pump_->write(sink, context);
  if (result < 0) lifecycle_ = Lifecycle::Faulted;
  return result;
}
Lifecycle Instrument::lifecycle() const { return lifecycle_; }
pf_engine* Instrument::engine() const { return engine_.get(); }
uint32_t Instrument::pending() const { return pump_ ? pump_->pending() : 0; }
}
