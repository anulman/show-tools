#ifndef SHOW_TOOLS_PATCH_ENGINE_H
#define SHOW_TOOLS_PATCH_ENGINE_H
#include <cstddef>
#include <cstdint>
#include <memory>

namespace patches {
struct Stereo { float left = 0, right = 0; };
struct ParameterDescriptor { const char* name; double minimum, maximum, initial; };
struct EffectDescriptor {
  const char* type;
  uint32_t version;
  uint32_t latency_frames;
  uint64_t maximum_tail_frames;
  const ParameterDescriptor* parameters;
  size_t parameter_count;
  bool deterministic_source_replay = false;
  bool complete_state_snapshot = false;
};

class Effect {
 public:
  virtual ~Effect() = default;
  virtual const EffectDescriptor& descriptor() const noexcept = 0;
  virtual Stereo process(Stereo input) noexcept = 0;
  virtual void reset() noexcept = 0;
  virtual bool compatible(const Effect& other) const noexcept = 0;
  virtual std::unique_ptr<Effect> snapshot() const noexcept = 0;
  virtual size_t memory_bytes() const noexcept = 0;
 private:
  friend class Rack;
  virtual void copy_state(const Effect& other) noexcept = 0;
};

struct SlapbackParameters { double delay_ms = 100, feedback = 0, wet = .25; };
std::unique_ptr<Effect> make_slapback(double sample_rate, SlapbackParameters parameters = {}) noexcept;

struct ChorusParameters { double rate_hz = .8, depth_ms = 5, base_delay_ms = 20, wet = .35; };
std::unique_ptr<Effect> make_chorus(double sample_rate, ChorusParameters parameters = {}) noexcept;

class Rack {
 public:
  static std::unique_ptr<Rack> create(std::unique_ptr<Effect>* stages, size_t count) noexcept;
  ~Rack();
  Rack(const Rack&) = delete;
  Rack& operator=(const Rack&) = delete;
  Stereo process(Stereo input) noexcept;
  bool process(const float* left, const float* right, float* out_left, float* out_right, uint32_t frames) noexcept;
  void reset() noexcept;
  bool compatible(const Rack& other) const noexcept;
  bool supports_capture() const noexcept;
  bool copy_state(const Rack& other) noexcept;
  std::unique_ptr<Rack> snapshot() const noexcept;
  size_t memory_bytes() const noexcept;
  uint64_t maximum_tail_frames() const noexcept;
  uint64_t latency_frames() const noexcept;
 private:
  Rack(std::unique_ptr<Effect>* stages, size_t count) noexcept;
  std::unique_ptr<Effect>* stages_;
  size_t count_;
};

enum class TakeState { prepared, capturing, committed };
class ProcessedTake {
 public:
  static std::unique_ptr<ProcessedTake> create(const Rack& definition, uint32_t capacity_frames, uint64_t revision, uint32_t source_channels = 2) noexcept;
  ~ProcessedTake();
  ProcessedTake(const ProcessedTake&) = delete;
  ProcessedTake& operator=(const ProcessedTake&) = delete;
  bool begin(const Rack& live) noexcept;
  bool capture(Rack& live, const float* left, const float* right, float* out_left, float* out_right, uint32_t frames) noexcept;
  bool append_processed(const Rack& live, const float* source_left, const float* source_right,
    const float* processed_left, const float* processed_right, uint32_t frames) noexcept;
  bool commit(uint32_t period_frames = 0) noexcept;
  bool reset_for_capture() noexcept;
  uint32_t length() const noexcept { return length_; }
  uint32_t period() const noexcept { return period_; }
  uint32_t capacity() const noexcept { return capacity_; }
  uint64_t revision() const noexcept { return revision_; }
  uint32_t source_channels() const noexcept { return source_channels_; }
  TakeState state() const noexcept { return state_; }
  size_t memory_bytes() const noexcept;
  Stereo sample(uint32_t frame) const noexcept;
 private:
  friend class Playback;
  ProcessedTake(std::unique_ptr<Rack> initial, std::unique_ptr<Rack> end, float* source, Stereo* printed, uint32_t capacity, uint64_t revision, uint32_t source_channels) noexcept;
  bool source_valid(const float* left, const float* right, uint32_t frames) const noexcept;
  void write_source(uint32_t frame, Stereo source) noexcept;
  Stereo read_source(uint32_t frame) const noexcept;
  std::unique_ptr<Rack> initial_, end_;
  float* source_;
  Stereo* printed_;
  uint32_t capacity_, source_channels_, length_ = 0, period_ = 0;
  uint64_t revision_;
  TakeState state_ = TakeState::prepared;
  mutable uint64_t active_playbacks_ = 0;
  const Rack* live_ = nullptr;
};

enum class PlaybackState { idle, playing, releasing };
enum class PlaybackMode { evolving };
class Playback {
 public:
  static std::unique_ptr<Playback> create(const ProcessedTake& take, PlaybackMode mode = PlaybackMode::evolving) noexcept;
  ~Playback();
  Playback(const Playback&) = delete;
  Playback& operator=(const Playback&) = delete;
  bool start(bool loop, uint32_t start_frame = 0) noexcept;
  bool start_at_capture_end(bool loop) noexcept;
  bool set_source_end(uint32_t exclusive_frame) noexcept;
  void clear_source_end() noexcept { source_end_ = UINT32_MAX; }
  double source_end() const noexcept { return source_end_ == UINT32_MAX ? -1 : double(source_end_); }
  void stop() noexcept;
  void reset() noexcept;
  Stereo next() noexcept;
  bool render(float* left, float* right, uint32_t frames) noexcept;
  PlaybackState state() const noexcept { return state_; }
  uint32_t phase() const noexcept { return phase_; }
  uint64_t release_remaining_frames() const noexcept { return release_remaining_; }
  size_t memory_bytes() const noexcept;
 private:
  Playback(const ProcessedTake& take, std::unique_ptr<Rack> shadow) noexcept;
  const ProcessedTake& take_;
  std::unique_ptr<Rack> shadow_;
  PlaybackState state_ = PlaybackState::idle;
  uint32_t phase_ = 0;
  uint32_t source_end_ = UINT32_MAX;
  uint64_t release_remaining_ = 0, iteration_ = 0;
  void finish() noexcept;
  bool loop_ = false;
  bool printed_history_valid_ = true;
};
}
#endif
