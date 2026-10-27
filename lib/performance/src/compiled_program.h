#ifndef SHOW_TOOLS_COMPILED_PROGRAM_H
#define SHOW_TOOLS_COMPILED_PROGRAM_H
#include "performance_engine.h"
#include "patch_engine.h"
#include <memory>

namespace compiled {
struct VoiceInfo { bool ready = false, looping = false, muted = false; int status = PF_EMPTY, light = PF_OFF, pending = PF_NONE; double release_ms = 0, gain = 1; };
class Program {
 public:
  static std::unique_ptr<Program> create(const double* data, uint32_t fields, double rate, const patches::Rack& definition, uint32_t revision) noexcept;
  ~Program();
  bool prepare_effects(const patches::Rack& definition, uint32_t revision) noexcept;
  void observe(void* context, void (*notify)(void*, double)) noexcept { observer_context_ = context; observer_ = notify; }
  void outcomes(void* context, void (*notify)(void*, double, int, int, int)) noexcept { outcome_context_ = context; outcome_ = notify; }
  void tempo_handler(void* context, int (*hit)(void*, int)) noexcept { tempo_context_ = context; tempo_hit_ = hit; }
  void tempo_changed(double frame, double old_bpm, double new_bpm) noexcept;
  void start(int start_bar, int count_in_beats, double frame, double bpm) noexcept;
  void stop() noexcept;
  void microphone_lost() noexcept;
  int press(int button, double frame, double bpm, bool microphone) noexcept;
  void beat(int phase, int bar, int beat, int count_remaining, double frame, double bpm) noexcept;
  void render(const float* input, float* left, float* right, float* live_left, float* live_right,
    uint32_t frames, double frame, double bpm, bool live, patches::Rack& default_rack) noexcept;
  void set_channel(int button, double gain, bool muted) noexcept;
  VoiceInfo channel_info(int button, double bpm) const noexcept;
  void take_info(uint32_t take, double* out) const noexcept;
  int beats_per_bar() const noexcept { return beats_; }
  int bars() const noexcept { return bars_; }
  int end_bar() const noexcept { return end_; }
  double initial_bpm() const noexcept { return bpm_; }
  int error() const noexcept { return error_; }
  void clear_error() noexcept { error_ = PF_OK; }
  bool has_capture() const noexcept;
  const double* table() const noexcept { return table_.get(); }
  uint32_t table_fields() const noexcept { return fields_; }
 private:
  struct Take;
  struct Cue;
  struct Member;
  struct PlaybackCue;
  struct Pending;
  struct CommitPlan { uint32_t period = 0; bool invalid_draft = false; };
  struct ActiveCapture { int take = -1, bank = -1; uint64_t generation = 0; };
  Program() = default;
  bool reservation_available(int take, int button, int committing) const noexcept;
  int available_bank(int take) const noexcept;
  int preflight_commit(const Cue& cue, CommitPlan& plan) const noexcept;
  int preflight_start(const Cue& cue, const Cue* staged_commit, uint32_t staged_period, int& bank) const noexcept;
  void discard_invalid_draft(const Cue& cue) noexcept;
  int execute(int cue, double frame) noexcept;
  bool selection_ready(int selection, int voice) const noexcept;
  bool select(int voice, int selection, bool automatic) noexcept;
  bool play_take(int take, double gain = 1) noexcept;
  void stop_voice(int voice, bool hard) noexcept;
  void switch_route(int voice, bool history_handed_off = false) noexcept;
  double position(double frame, double bpm) const noexcept;
  void apply_pending(double frame, double bpm) noexcept;
  double cue_frame(const Cue& cue, double bpm) const noexcept;
  void remember_cues(double frame, double bpm) noexcept;
  bool commit_period(int take, uint32_t& period) const noexcept;
  std::unique_ptr<double[]> table_;
  uint32_t fields_ = 0, prepared_revision_ = 0;
  std::unique_ptr<Take[]> takes_;
  std::unique_ptr<Cue[]> cues_;
  std::unique_ptr<Member[]> members_;
  std::unique_ptr<PlaybackCue[]> playback_;
  std::unique_ptr<Pending[]> pending_;
  std::unique_ptr<patches::Rack> voices_[PF_CHANNELS], tails_[PF_CHANNELS];
  bool detached_tail_[PF_CHANNELS]{};
  uint64_t tail_generation_[PF_CHANNELS]{}, capture_generation_ = 0;
  int take_count_ = 0, cue_count_ = 0, member_count_ = 0, playback_count_ = 0;
  int beats_ = 4, bars_ = 1, end_ = 1, start_ = 1, phase_ = PF_IDLE, bar_ = 0;
  int binding_[PF_CHANNELS]{0, 1, 2, 3}, selection_[PF_CHANNELS]{-1, -1, -1, -1};
  bool muted_[PF_CHANNELS]{}, suppressed_[PF_CHANNELS]{};
  double gain_[PF_CHANNELS]{1, 1, 1, 1};
  uint64_t drain_[PF_CHANNELS + 1]{};
  double rate_ = 0, bpm_ = 120, early_ = 0, late_ = 0, anchor_frame_ = 0, anchor_position_ = 0, query_position_ = 0, query_frame_ = 0;
  double capture_bpm_ = 120;
  ActiveCapture active_capture_;
  int live_route_ = -1, error_ = PF_OK;
  void* outcome_context_ = nullptr;
  void (*outcome_)(void*, double, int, int, int) = nullptr;
  void* tempo_context_ = nullptr;
  int (*tempo_hit_)(void*, int) = nullptr;
  void* observer_context_ = nullptr;
  void (*observer_)(void*, double) = nullptr;
};
}
#endif
