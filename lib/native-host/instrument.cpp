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
  auto pump = std::make_unique<AudioPump>(candidate.get(), config_.block_capacity);
  pump_ = std::move(pump); engine_ = std::move(candidate); lifecycle_ = Lifecycle::Prepared;
  return true;
}
bool Instrument::prepare_profiles(const Profiles& profiles) {
  return lifecycle_ == Lifecycle::Prepared && !pending() && valid(profiles) &&
    pf_prepare_voice_effects(engine_.get(), profiles.effects, profiles.counts.data(), profiles.revisions.data()) == 0;
}
bool Instrument::start(const Start& start) {
  if (lifecycle_ != Lifecycle::Prepared || pending() || pf_start(engine_.get(), start.bpm, start.count_in_bars, start.start_bar,
      start.end_bar, start.loop, start.automatic) < 0) return false;
  lifecycle_ = Lifecycle::Running; return true;
}
void Instrument::stop() {
  if (!engine_) return;
  pf_stop(engine_.get()); pump_->discard();
  if (lifecycle_ != Lifecycle::Faulted) lifecycle_ = Lifecycle::Prepared;
}
int Instrument::control(int id, double value) {
  if (!engine_ || lifecycle_ == Lifecycle::Faulted) return -1;
  int result = pf_control(engine_.get(), id, value, nullptr, 0);
  if (result == 0 && id == 4) { pump_->discard(); lifecycle_ = Lifecycle::Prepared; }
  return result;
}
int Instrument::select(int channel) { return engine_ && lifecycle_ != Lifecycle::Faulted ? pf_select(engine_.get(), channel) : -1; }
int Instrument::set_channel(int channel, double gain, int muted) { return engine_ && lifecycle_ != Lifecycle::Faulted ? pf_set_channel(engine_.get(), channel, gain, muted) : -1; }
int Instrument::set_automatic(int enabled) { return engine_ && lifecycle_ != Lifecycle::Faulted ? pf_set_automatic(engine_.get(), enabled) : -1; }
int Instrument::set_click(int enabled) { return engine_ && lifecycle_ != Lifecycle::Faulted ? pf_set_click(engine_.get(), enabled) : -1; }
int Instrument::set_click_gain(double gain) { return engine_ && lifecycle_ != Lifecycle::Faulted ? pf_set_click_gain(engine_.get(), gain) : -1; }
int Instrument::render(const float* input, uint32_t frames) {
  if (lifecycle_ != Lifecycle::Running) return -1;
  if (pump_->render(input, frames) < 0) { lifecycle_ = Lifecycle::Faulted; return -1; }
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
