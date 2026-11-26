#include "instrument.h"
#include <cmath>
#include <array>

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
Instrument::Instrument(InstrumentConfig config) : config_(config),
  idle_monitor_(config.idle_microphone_monitor && config.microphone_ready ? IdleMonitor::Enabled : IdleMonitor::Disabled) {}
bool Instrument::prepare(const uint8_t* packet, uint32_t bytes, const Profiles& profiles,
                         const std::vector<ExternalWave>& waves) {
  const bool pending_non_audition = pending() && output_ != Output::IdleMonitor && !has_tambourine_output();
  if (lifecycle_ == Lifecycle::Running || lifecycle_ == Lifecycle::Faulted || pending_non_audition || !packet || !bytes ||
      !valid(profiles) || bytes > 8 * 1024 * 1024 || !std::isfinite(config_.sample_rate) || config_.sample_rate <= 0 || config_.max_voices <= 0 ||
      !std::isfinite(config_.max_seconds) || config_.max_seconds <= 0 || !config_.block_capacity) return false;
  Engine candidate(pf_create(config_.sample_rate, PF_PRACTICE, config_.max_voices, config_.max_seconds, 4), pf_destroy);
  if (!candidate || pf_prepare_voice_effects(candidate.get(), profiles.effects, profiles.counts.data(), profiles.revisions.data()) < 0 ||
      pf_load_compiled_bytes(candidate.get(), packet, bytes) < 0 || pf_set_microphone(candidate.get(), config_.microphone_ready ? 1 : 0) < 0) return false;
  for (const auto& wave : waves) {
    if (pf_prepare_external_wav(candidate.get(), wave.slot, wave.bytes.data(), uint32_t(wave.bytes.size())) < 0) return false;
  }
  auto pump = std::make_unique<AudioPump>(candidate.get(), config_.block_capacity);
  if (engine_ && pf_input_inherit(candidate.get(), engine_.get()) < 0) return false;
  pump_ = std::move(pump); engine_ = std::move(candidate); lifecycle_ = Lifecycle::Prepared;
  output_ = Output::Performance;
  audition_profile_ = -1;
  return true;
}
bool Instrument::prepare_profiles(const Profiles& profiles) {
  return lifecycle_ == Lifecycle::Prepared && (!pending() || output_ == Output::IdleMonitor) && valid(profiles) &&
    pf_prepare_voice_effects(engine_.get(), profiles.effects, profiles.counts.data(), profiles.revisions.data()) == 0;
}
bool Instrument::start(const Start& start) {
  if (!can_start() || pf_start(engine_.get(), start.bpm, start.count_in_bars, start.start_bar,
      start.end_bar, start.loop, start.automatic) < 0) return false;
  if (output_ == Output::IdleUtility || has_tambourine_output()) pump_->discard();
  if (!pending()) output_ = Output::Performance;
  if (idle_monitor_ == IdleMonitor::PanicMuted) idle_monitor_ = IdleMonitor::Enabled;
  audition_profile_ = -1;
  lifecycle_ = Lifecycle::Running; return true;
}
bool Instrument::can_start() const { return lifecycle_ == Lifecycle::Prepared && (!pending() || output_ != Output::Performance); }
void Instrument::stop() {
  if (!engine_) return;
  pf_stop(engine_.get()); pump_->discard(); output_ = Output::Performance;
  if (lifecycle_ != Lifecycle::Faulted) lifecycle_ = Lifecycle::Prepared;
}
void Instrument::silence_panic() {
  audition_profile_ = -1;
  pump_->discard();
  output_ = Output::Performance;
  lifecycle_ = Lifecycle::Prepared;
  if (idle_monitor_ == IdleMonitor::Enabled) idle_monitor_ = IdleMonitor::PanicMuted;
}
int Instrument::prepare_external_wave(uint32_t slot, const uint8_t* bytes, uint32_t length) {
  if (!engine_ || lifecycle_ != Lifecycle::Prepared || (pending() && output_ != Output::IdleMonitor)) return -1;
  return pf_prepare_external_wav(engine_.get(), slot, bytes, length);
}
int Instrument::control(int id, double value) {
  if (!engine_ || lifecycle_ == Lifecycle::Faulted) return -1;
  int result = pf_control(engine_.get(), id, value, nullptr, 0);
  if (result == 0 && id == 4) silence_panic();
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
  if (result == 0 && panic) silence_panic();
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
int Instrument::begin_required_tuning(uint32_t expected_revision, uint32_t profile, const double* slots, uint32_t count, int root, int scale) {
  if (lifecycle_ != Lifecycle::Prepared || (pending() && output_ == Output::Performance)) return -1;
  std::array<double, PF_TUNER_FIELDS> state{};
  pf_tuner_info(engine_.get(), state.data());
  if (state[PF_TUNER_REVISION] != expected_revision) return -1;
  return pf_begin_tuning_bank(engine_.get(), profile, slots, count, root, scale);
}
int Instrument::tuner(int operation, uint32_t expected_revision, int value, int scale) {
  return engine_ && (lifecycle_ == Lifecycle::Prepared || ((operation == PF_TUNER_CLOSE || operation == PF_TUNER_SILENCE) && lifecycle_ == Lifecycle::Running))
    ? pf_tuner_command_apply(engine_.get(), operation, expected_revision, value, scale) : -1;
}
int Instrument::audition(int profile) {
  if (!monitoring() || profile < -1 || profile >= PF_VOICE_PROFILES) return -1;
  if (idle_monitor_only() && output_ == Output::IdleMonitor) pump_->discard();
  audition_profile_ = profile;
  return 0;
}
int Instrument::audition_tambourine(int32_t velocity, int32_t slot) {
  if (!engine_ || lifecycle_ == Lifecycle::Faulted ||
      (velocity >= 0 && (lifecycle_ == Lifecycle::Prepared && pending() && output_ == Output::Performance))) return -1;
  const int result = pf_audition_tambourine(engine_.get(), velocity, slot);
  if (result < 0) return result;
  if (velocity == -1 && has_tambourine_output()) {
    pump_->discard();
    output_ = Output::Performance;
  }
  return 0;
}
bool Instrument::monitoring() const { return lifecycle_ == Lifecycle::Prepared && idle_monitor_ == IdleMonitor::Enabled; }
bool Instrument::idle_monitor_only() const {
  return monitoring() && !pf_audio_needed(engine_.get()) && output_ != Output::IdleUtility && !has_tambourine_output();
}
bool Instrument::audio_needed() const {
  return engine_ && lifecycle_ != Lifecycle::Faulted && (monitoring() || pf_audio_needed(engine_.get()));
}
int Instrument::render(const float* input, uint32_t frames) {
  if (!audio_needed()) return -1;
  const bool running = lifecycle_ == Lifecycle::Running;
  const bool tambourine = pf_tambourine_active(engine_.get());
  const bool monitor_only = monitoring() && !pf_audio_needed(engine_.get());
  if (pump_->render(input, frames, monitoring(), audition_profile_ < 0 ? PF_DEFAULT_PROFILE : uint32_t(audition_profile_)) < 0) { lifecycle_ = Lifecycle::Faulted; return -1; }
  output_ = running ? Output::Performance : tambourine ? Output::Tambourine : monitor_only ? Output::IdleMonitor : Output::IdleUtility;
  if (!running) return 0;
  std::array<double, PF_FIELDS> state{};
  pf_snapshot(engine_.get(), state.data());
  if (state[PF_PHASE] == PF_ENDED) lifecycle_ = Lifecycle::Prepared;
  else if (state[PF_PHASE] == PF_IDLE && !state[PF_PREFLIGHT_STAGE])
    lifecycle_ = state[PF_ERROR] ? Lifecycle::Faulted : Lifecycle::Prepared;
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
