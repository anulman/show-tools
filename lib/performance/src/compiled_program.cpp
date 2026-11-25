#include "compiled_program.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <new>

namespace compiled {
namespace {
constexpr int default_route = PF_VOICE_PROFILES, backup_route = PF_VOICE_PROFILES + 1, route_count = PF_VOICE_PROFILES + 2;
constexpr double epsilon = 1e-8;
constexpr double minimum_bpm = 40, maximum_bpm = 240;
constexpr double edge_arm_early = PF_COMPILED_EDGE_ARM_EARLY_TICKS / 960.;
constexpr double edge_arm_late = PF_COMPILED_EDGE_ARM_LATE_TICKS / 960.;
constexpr double edge_capture_grace = PF_COMPILED_EDGE_CAPTURE_GRACE_TICKS / 960.;
constexpr double edge_playback_tolerance = PF_COMPILED_EDGE_PLAYBACK_TOLERANCE_TICKS / 960.;
int word_playback_slot(double offset) noexcept {
  if (std::abs(offset) <= edge_playback_tolerance + epsilon) return 0;
  if (std::abs(offset - 1) <= edge_playback_tolerance + epsilon) return 1;
  return -1;
}

bool whole(double value, double maximum) { return std::isfinite(value) && value >= 0 && value <= maximum && std::floor(value) == value; }
bool index(double value, int count, bool optional = false) { return (optional && value == -1) || whole(value, count - 1); }
bool point(double value, int beats) { return std::isfinite(value) && value >= 0 && value < beats && std::floor(value * 960) == value * 960; }
bool count_in_pickup(int bar, int kind, double cue, int timing, double execute, int bar_offset, int beats) noexcept {
  return bar == 0 && kind == PF_ARM && cue < 0 && timing == 2 && !bar_offset && execute >= beats - 1;
}
double cue_boundary(int bar, double cue, int timing, double execute, int beats, int kind) {
  if (timing == 1) return bar * beats;
  if (bar == 0 && kind == PF_ARM && timing == 2) return execute - beats;
  return (std::max(1, bar) - 1) * beats + (timing == 2 ? execute : std::max(0.0, cue));
}
}
namespace {
struct CaptureGrid {
  struct Point { double count = 0, frame = 0; };
  std::unique_ptr<Point[]> points;
  uint32_t size = 0, capacity = 0;
  double initial_bpm = 0;
  bool tempo_changed = false;

  void add(double count, double frame) noexcept {
    if (size && (count <= points[size - 1].count + epsilon || frame <= points[size - 1].frame)) return;
    if (size < capacity) points[size++] = {count, frame};
  }

  void begin(double count, double bpm) noexcept {
    size = 0; initial_bpm = bpm; tempo_changed = false;
    add(count, 0);
  }

  double interpolate(double value, bool inverse, double fallback) const noexcept {
    const auto from = [=](const Point& point) { return inverse ? point.frame : point.count; };
    const auto to = [=](const Point& point) { return inverse ? point.count : point.frame; };
    if (!size) return value * fallback;
    const Point* begin = points.get();
    const Point* end = begin + size;
    const Point* next = std::upper_bound(begin, end, value, [&](double key, const Point& point) { return key < from(point); });
    if (next == begin) return to(*next) + (value - from(*next)) * fallback;
    const Point& previous = next[-1];
    const double ratio = next == end ? fallback : (to(*next) - to(previous)) / (from(*next) - from(previous));
    return to(previous) + (value - from(previous)) * ratio;
  }
};

struct LoopClock {
  double first_count = 0, counts = 0, phase = 0;
  uint32_t first_frame = 0, frames = 0;
  bool warped = false;
  double repeat_begin = 0;

  double wrap(double position) const noexcept {
    if (repeat_begin > 0 && position >= 0) {
      if (position + epsilon < counts) return position;
      return repeat_begin + std::fmod(std::max(0., position - counts), counts - repeat_begin);
    }
    double result = std::fmod(position, counts);
    if (result < 0) result += counts;
    return result + epsilon >= counts ? 0 : result;
  }
};
}
struct Program::Take {
  int voice = 0, profile = 0, active_selection = -1, latest = -1, anchor = -1, commit_cue = -1;
  double begin = 0, end = 0, loop_end = 0, gain = 1;
  double capture_start_phase = 0;
  CaptureGrid grid[2];
  LoopClock clock[2];
  uint32_t capacity = 0;
  bool edge_capture = false;
  double playback_gain[2]{1, 1};
  std::unique_ptr<patches::ProcessedTake> cache[2];
  std::unique_ptr<patches::Playback> playback[2];
};
struct Program::Cue {
  int button = 0, voice = 0, bar = 0, kind = PF_NONE, timing = 0, take = -1, commit = -1, selection = -1;
  double cue = -1, execute = 0, occurred_frame = std::numeric_limits<double>::quiet_NaN();
  int tempo_hint = 0, launch = PF_AUTOPLAY, mode = PF_LOOP_MODE, bar_offset = 0, group = -1;
  bool used = false, replacement_capture = false, announced = false, edge_capture = false, word_window = false;
  bool playback_intent() const noexcept { return kind == PF_STOP || kind == PF_PLAY; }
  bool recoverable() const noexcept { return kind == PF_STOP || (kind == PF_PLAY && mode == PF_LOOP_MODE); }
};
struct Program::Member { int selection = 0, take = 0; double gain = 1; };
struct Program::PlaybackCue { int bar = 1, voice = 0, selection = 0; };
struct Program::Due { int cue = -1, result = PF_OK, bank = -1; uint64_t owner = 0; CommitPlan commit; };
struct Program::Pending { int cue = -1, reserved_take = -1; double position = 0; uint64_t owner = 0; bool automatic = false; };

Program::~Program() = default;
std::unique_ptr<Program> Program::create(const double* data, uint32_t fields, double rate, const patches::Rack& definition, uint32_t revision) noexcept {
  const patches::Rack* definitions[PF_VOICE_PROFILES]; uint32_t revisions[PF_VOICE_PROFILES];
  for (int voice = 0; voice < PF_VOICE_PROFILES; ++voice) { definitions[voice] = &definition; revisions[voice] = revision; }
  return create(data, fields, rate, definitions, revisions);
}
std::unique_ptr<Program> Program::create(const double* data, uint32_t fields, double rate, const patches::Rack* const* definitions, const uint32_t* revisions) noexcept {
  if (!data || fields < PF_COMPILED_HEADER_FIELDS || data[0] != PF_COMPILED_MAGIC || (data[1] != PF_COMPILED_VERSION && data[1] != PF_COMPILED_LEGACY_VERSION)
    || !whole(data[2], 6) || (data[2] != 4 && data[2] != 6) || !whole(data[3], PF_MAX_BARS) || data[3] < 1
    || !std::isfinite(data[4]) || data[4] < minimum_bpm || data[4] > maximum_bpm || !whole(data[5], data[3]) || data[5] < 1
    || !std::isfinite(data[6]) || data[6] < 0 || data[6] > 100 || !std::isfinite(data[7]) || data[7] < 0 || data[7] > 100
    || !whole(data[8], PF_COMPILED_MAX_TAKES) || !whole(data[9], PF_MAX_EVENTS) || !whole(data[10], PF_MAX_EVENTS) || !whole(data[11], PF_MAX_EVENTS)) return nullptr;
  const uint32_t cue_fields = data[1] == PF_COMPILED_LEGACY_VERSION ? PF_COMPILED_LEGACY_CUE_FIELDS : PF_COMPILED_CUE_FIELDS;
  uint64_t needed = PF_COMPILED_HEADER_FIELDS + uint64_t(data[8]) * PF_COMPILED_TAKE_FIELDS + uint64_t(data[9]) * cue_fields
    + uint64_t(data[10]) * PF_COMPILED_MEMBER_FIELDS + uint64_t(data[11]) * PF_COMPILED_PLAYBACK_FIELDS;
  if (needed > fields) return nullptr;
  int rotation_count = 0, window_count = 0, external_count = 0, note_count = 0, profile_count = 0, sustain_count = 0, intro_count = 0, overlap_count = 0; double rotation_inactivity = .25;
  uint64_t rotation_offset = 0, window_offset = 0, external_offset = 0, note_offset = 0, profile_offset = 0, sustain_offset = 0, intro_offset = 0, overlap_offset = 0, cursor = needed;
  uint64_t edge_offset = 0;
  int edge_captures = 0, edge_playbacks = 0;
  bool input_extension = false;
  performance_input::Binding input_bindings[PF_INPUT_SWITCHES];
  uint32_t input_rows = 0;
  while (cursor < fields) {
    if (data[cursor] == PF_COMPILED_ROTATION_MAGIC) {
      if (rotation_offset || window_offset || fields - cursor < PF_COMPILED_ROTATION_HEADER_FIELDS
        || !whole(data[cursor + 1], PF_MAX_EVENTS) || !whole(data[cursor + 2] * 960, 960) || data[cursor + 2] <= 0) return nullptr;
      rotation_offset = cursor; rotation_count = int(data[cursor + 1]); rotation_inactivity = data[cursor + 2];
      cursor += PF_COMPILED_ROTATION_HEADER_FIELDS + uint64_t(rotation_count) * PF_COMPILED_ROTATION_FIELDS;
    } else if (data[cursor] == PF_COMPILED_WINDOW_MAGIC) {
      if (window_offset || fields - cursor < PF_COMPILED_WINDOW_HEADER_FIELDS || !whole(data[cursor + 1], PF_MAX_EVENTS)) return nullptr;
      window_offset = cursor; window_count = int(data[cursor + 1]);
      cursor += PF_COMPILED_WINDOW_HEADER_FIELDS + uint64_t(window_count) * PF_COMPILED_WINDOW_FIELDS;
    } else if (data[cursor] == PF_COMPILED_INTRO_LOOP_MAGIC || data[cursor] == PF_COMPILED_OVERLAP_LOOP_MAGIC) {
      const bool overlap = data[cursor] == PF_COMPILED_OVERLAP_LOOP_MAGIC;
      auto& offset = overlap ? overlap_offset : intro_offset;
      auto& count = overlap ? overlap_count : intro_count;
      if (offset || fields - cursor < 2 || !whole(data[cursor + 1], data[8])) return nullptr;
      offset = cursor; count = int(data[cursor + 1]);
      cursor += 2 + uint64_t(count) * PF_COMPILED_INTRO_LOOP_FIELDS;
    } else if (data[cursor] == PF_COMPILED_SUSTAIN_MAGIC) {
      if (sustain_offset || fields - cursor < 2 || !whole(data[cursor + 1], PF_COMPILED_MAX_TAKES)) return nullptr;
      sustain_offset = cursor; sustain_count = int(data[cursor + 1]); cursor += 2 + sustain_count;
    } else if (data[cursor] == PF_COMPILED_PROFILES_MAGIC) {
      if (profile_offset || fields - cursor < 2 || !whole(data[cursor + 1], data[8])) return nullptr;
      profile_offset = cursor; profile_count = int(data[cursor + 1]);
      cursor += 2 + uint64_t(profile_count) * PF_COMPILED_PROFILES_FIELDS;
    } else if (data[cursor] == PF_COMPILED_NOTES_MAGIC) {
      if (note_offset || fields - cursor < 2 || !whole(data[cursor + 1], PF_MAX_EVENTS)) return nullptr;
      note_offset = cursor; note_count = int(data[cursor + 1]);
      cursor += 2 + uint64_t(note_count) * PF_COMPILED_NOTES_FIELDS;
    } else if (data[cursor] == PF_COMPILED_EXTERNAL_MAGIC) {
      if (external_offset || fields - cursor < 2 || !whole(data[cursor + 1], PF_MAX_EVENTS)) return nullptr;
      external_offset = cursor; external_count = int(data[cursor + 1]);
      cursor += 2 + uint64_t(external_count) * PF_COMPILED_EXTERNAL_FIELDS;
    } else if (data[cursor] == PF_COMPILED_EDGE_MAGIC) {
      if (data[1] != PF_COMPILED_VERSION || edge_offset || fields - cursor < 3
        || !whole(data[cursor + 1], int(data[8]) / 2) || !whole(data[cursor + 2], PF_MAX_EVENTS)
        || (data[cursor + 1] == 0 && data[cursor + 2] == 0)) return nullptr;
      edge_offset = cursor;
      edge_captures = int(data[cursor + 1]); edge_playbacks = int(data[cursor + 2]);
      cursor += 3 + uint64_t(edge_captures) * PF_COMPILED_EDGE_CAPTURE_FIELDS + uint64_t(edge_playbacks) * PF_COMPILED_EDGE_PLAYBACK_FIELDS;
    } else if (data[cursor] == PF_INPUT_MAGIC) {
      if (data[1] != PF_COMPILED_VERSION || input_extension || fields - cursor < 2
        || !whole(data[cursor + 1], PF_INPUT_SWITCHES)) return nullptr;
      input_extension = true;
      const uint32_t count = uint32_t(data[cursor + 1]); cursor += 2;
      if (fields - cursor != uint64_t(count) * PF_INPUT_BINDING_FIELDS) return nullptr;
      for (uint32_t id = 0; id < count; ++id, cursor += PF_INPUT_BINDING_FIELDS) {
        const double* row = data + cursor;
        if (!whole(row[0], PF_INPUT_SWITCHES - 1) || !whole(row[1], PF_INPUT_PANIC) || !whole(row[2], 15)) return nullptr;
        auto& binding = input_bindings[int(row[0])];
        if (binding.kind >= 0 || (row[1] == PF_INPUT_CUES ? row[2] == 0 || (input_rows & uint32_t(row[2])) : row[2] != 0)) return nullptr;
        binding.kind = int(row[1]); binding.rows = uint32_t(row[2]); input_rows |= binding.rows;
      }
    } else return nullptr;
    if (cursor > fields) return nullptr;
  }
  for (int button = 0; button < PF_CHANNELS; ++button) {
    if (!index(data[12 + button], PF_CHANNELS)) return nullptr;
    for (int previous = 0; previous < button; ++previous) if (data[12 + previous] == data[12 + button]) return nullptr;
  }
  auto program = std::unique_ptr<Program>(new (std::nothrow) Program);
  if (!program) return nullptr;
  std::copy(input_bindings, input_bindings + PF_INPUT_SWITCHES, program->input_bindings_);
  program->fields_ = fields; program->rate_ = rate; program->beats_ = int(data[2]); program->bars_ = int(data[3]); program->bpm_ = data[4]; program->end_ = int(data[5]);
  program->early_ = data[6]; program->late_ = data[7]; program->take_count_ = int(data[8]); program->cue_count_ = int(data[9]);
  program->member_count_ = int(data[10]); program->playback_count_ = int(data[11]);
  for (int button = 0; button < PF_CHANNELS; ++button) program->binding_[button] = int(data[12 + button]);
  program->rotation_count_ = rotation_count; program->rotation_inactivity_ = rotation_inactivity;
  program->rotation_windows_.reset(new (std::nothrow) RotationWindow[rotation_count]);
  if (!program->rotation_windows_) return nullptr;
  for (int id = 0; id < rotation_count; ++id) {
    const double* row = data + rotation_offset + PF_COMPILED_ROTATION_HEADER_FIELDS + id * PF_COMPILED_ROTATION_FIELDS;
    if (!whole(row[0], program->bars_) || row[0] < 1 || !point(row[1], program->beats_)
      || !whole(row[2], program->bars_ + 1) || row[2] < 1 || !point(row[3], program->beats_) || (row[2] == program->bars_ + 1 && row[3] != 0)) return nullptr;
    auto& window = program->rotation_windows_[id]; window.begin = (row[0] - 1) * program->beats_ + row[1]; window.end = (row[2] - 1) * program->beats_ + row[3];
    if (window.end <= window.begin || (id && window.begin < program->rotation_windows_[id - 1].end)) return nullptr;
  }
  program->note_count_ = note_count;
  program->notes_.reset(new (std::nothrow) InstrumentNote[note_count]);
  if (!program->notes_) return nullptr;
  for (int id = 0; id < note_count; ++id) {
    const double* row = data + note_offset + 2 + id * PF_COMPILED_NOTES_FIELDS;
    if (!index(row[0], PF_CHANNELS) || !whole(row[1], 63) || !whole(row[2], program->bars_) || row[2] < 1
      || !point(row[3], program->beats_) || !std::isfinite(row[4]) || row[4] < 0 || row[4] > 100) return nullptr;
    auto& note = program->notes_[id];
    note.button = int(row[0]); note.slot = uint32_t(row[1]); note.at = (row[2] - 1) * program->beats_ + row[3]; note.tolerance = row[4];
    for (int previous = 0; previous < id; ++previous) if (program->notes_[previous].button == note.button && program->notes_[previous].at >= note.at) return nullptr;
  }
  program->external_count_ = external_count;
  program->external_windows_.reset(new (std::nothrow) ExternalWindow[external_count]);
  if (!program->external_windows_) return nullptr;
  for (int id = 0; id < external_count; ++id) {
    const double* row = data + external_offset + 2 + id * PF_COMPILED_EXTERNAL_FIELDS;
    if (!whole(row[0], 63) || !whole(row[1], program->bars_) || row[1] < 1 || !point(row[2], program->beats_)
      || !whole(row[3], program->bars_ + 1) || row[3] < 1 || !point(row[4], program->beats_) || (row[3] > program->bars_ && row[4] != 0)) return nullptr;
    auto& window = program->external_windows_[id];
    window.slot = uint32_t(row[0]); window.begin = (row[1] - 1) * program->beats_ + row[2]; window.end = (row[3] - 1) * program->beats_ + row[4];
    if (window.end <= window.begin) return nullptr;
  }
  program->table_.reset(new (std::nothrow) double[fields]);
  program->takes_.reset(new (std::nothrow) Take[program->take_count_]); program->cues_.reset(new (std::nothrow) Cue[program->cue_count_]);
  program->members_.reset(new (std::nothrow) Member[program->member_count_]); program->playback_.reset(new (std::nothrow) PlaybackCue[program->playback_count_]);
  program->pending_.reset(new (std::nothrow) Pending[program->cue_count_]);
  program->due_.reset(new (std::nothrow) Due[program->cue_count_]);
  if (!program->due_ || !program->table_ || !program->takes_ || !program->cues_ || !program->members_ || !program->playback_ || !program->pending_) return nullptr;
  std::copy(data, data + fields, program->table_.get());
  uint32_t offset = PF_COMPILED_HEADER_FIELDS;
  uint64_t pcm_bytes = 0;
  for (int id = 0; id < program->take_count_; ++id, offset += PF_COMPILED_TAKE_FIELDS) {
    const double* row = data + offset;
    if (!index(row[0], PF_CHANNELS) || !whole(row[1], program->bars_) || !point(row[2], program->beats_)
      || !whole(row[3], program->bars_ + 1) || row[3] < 1 || !point(row[4], program->beats_) || (row[3] == program->bars_ + 1 && row[4] != 0) || !std::isfinite(row[5]) || row[5] < 0 || row[5] > 4
      || !whole(row[6], program->bars_ + 1) || row[6] < 1 || !point(row[7], program->beats_) || (row[6] == program->bars_ + 1 && row[7] != 0)
      || !index(row[8], program->take_count_)) return nullptr;
    Take& take = program->takes_[id]; take.voice = int(row[0]); take.profile = take.voice; take.begin = (row[1] - 1) * program->beats_ + row[2]; take.end = (row[3] - 1) * program->beats_ + row[4]; take.gain = row[5]; take.loop_end = (row[6] - 1) * program->beats_ + row[7]; take.anchor = int(row[8]);
    if (take.loop_end < take.end || std::ceil((take.loop_end - take.begin) * rate * 60 / minimum_bpm) > std::numeric_limits<uint32_t>::max()) return nullptr;
    double capacity = std::ceil((take.end - take.begin) * rate * 60 / minimum_bpm);
    if (capacity < 1 || capacity > std::numeric_limits<uint32_t>::max()) return nullptr;
    take.capacity = uint32_t(capacity); pcm_bytes += uint64_t(take.capacity) * (sizeof(patches::Stereo) + sizeof(float)) * 2;
    for (auto& grid : take.grid) {
      grid.capacity = uint32_t(std::ceil(take.end - take.begin + 2)) * 8 + 2;
      grid.points.reset(new (std::nothrow) CaptureGrid::Point[grid.capacity]);
      if (!grid.points) return nullptr;
      pcm_bytes += uint64_t(grid.capacity) * sizeof(CaptureGrid::Point);
    }
  }
  bool profile_assigned[PF_COMPILED_MAX_TAKES]{};
  for (int id = 0; id < profile_count; ++id) {
    const double* row = data + profile_offset + 2 + id * PF_COMPILED_PROFILES_FIELDS;
    if (!index(row[0], program->take_count_) || !index(row[1], PF_VOICE_PROFILES) || profile_assigned[int(row[0])]) return nullptr;
    profile_assigned[int(row[0])] = true; program->takes_[int(row[0])].profile = int(row[1]);
  }
  for (int id = 0; id < program->take_count_; ++id) {
    const Take& take = program->takes_[id]; const Take& anchor = program->takes_[take.anchor];
    int64_t period = std::llround(take.loop_end * 960) - std::llround(take.begin * 960);
    if (period <= 0 || anchor.anchor != take.anchor || anchor.voice != take.voice || anchor.profile != take.profile
      || period != std::llround(anchor.loop_end * 960) - std::llround(anchor.begin * 960) || (take.anchor != id && (take.anchor > id || anchor.end > take.begin))
      || (std::llround(take.begin * 960) - std::llround(anchor.begin * 960)) % period != 0) return nullptr;
  }
  for (int id = 0; id < program->take_count_; ++id) for (int previous = 0; previous < id; ++previous) {
    const Take& a = program->takes_[id]; const Take& b = program->takes_[previous];
    if (a.begin < b.end && b.begin < a.end) return nullptr;
  }
  for (int id = 0; id < program->cue_count_; ++id, offset += cue_fields) {
    const double* row = data + offset;
    if (!index(row[0], PF_CHANNELS) || !index(row[1], PF_CHANNELS) || !whole(row[2], program->bars_)
      || !(row[3] == -1 || point(row[3], program->beats_)) || !whole(row[4], PF_PLAY) || row[4] < PF_ARM
      || !whole(row[5], 2) || !point(row[6], program->beats_) || !index(row[7], program->take_count_, true) || !index(row[8], program->take_count_, true)
      || !whole(row[9] + 1, PF_MAX_EVENTS) || !whole(row[10], 1)) return nullptr;
    Cue& cue = program->cues_[id]; cue.button = int(row[0]); cue.voice = int(row[1]); cue.bar = int(row[2]); cue.cue = row[3]; cue.kind = int(row[4]);
    cue.timing = int(row[5]); cue.execute = row[6]; cue.take = int(row[7]); cue.commit = int(row[8]); cue.selection = int(row[9]); cue.tempo_hint = int(row[10]);
    if (cue_fields > PF_COMPILED_LEGACY_CUE_FIELDS) {
      if (!whole(row[11], 1) || !whole(row[12], PF_GATED_MODE) || !whole(row[13], 1) || !whole(row[14] + 1, PF_MAX_EVENTS) || !whole(row[15], 1)) return nullptr;
      cue.replacement_capture = row[15] == 1; cue.launch = int(row[11]); cue.mode = int(row[12]); cue.bar_offset = int(row[13]); cue.group = int(row[14]);
      if (cue.launch == PF_STORE_ONLY && cue.kind != PF_COMMIT && cue.kind != PF_COMMIT_ARM) return nullptr;
    }
    if (cue.tempo_hint && (cue.kind != PF_PLAY || cue.timing != 0)) return nullptr;
    if (cue.kind != PF_PLAY && cue.kind != PF_STOP && cue.voice != program->binding_[cue.button]) return nullptr;
    if ((cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM) && cue.bar == 0 && cue.timing != 1
      && !count_in_pickup(cue.bar, cue.kind, cue.cue, cue.timing, cue.execute, cue.bar_offset, program->beats_)) return nullptr;
    if ((cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM) && (cue.take < 0 || program->takes_[cue.take].voice != cue.voice)) return nullptr;
    if ((cue.kind == PF_COMMIT || cue.kind == PF_COMMIT_ARM) && (cue.commit < 0 || program->takes_[cue.commit].voice != cue.voice)) return nullptr;
    if (cue.kind == PF_COMMIT_ARM && cue.take == cue.commit) return nullptr;
  }
  for (int id = 0; id < program->cue_count_; ++id) if (program->cues_[id].group >= 0) {
    const Cue& cue = program->cues_[id];
    for (int previous = 0; previous < id; ++previous) {
      const Cue& other = program->cues_[previous];
      if (other.group == cue.group && (other.button != cue.button || other.bar != cue.bar || other.cue != cue.cue)) return nullptr;
    }
  }
  unsigned arms[PF_COMPILED_MAX_TAKES]{}, commits[PF_COMPILED_MAX_TAKES]{};
  int arm_cues[PF_COMPILED_MAX_TAKES]{};
  for (int id = 0; id < program->cue_count_; ++id) {
    const Cue& cue = program->cues_[id];
    bool arms_take = cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM;
    bool commits_take = cue.kind == PF_COMMIT || cue.kind == PF_COMMIT_ARM;
    if ((!arms_take && cue.take != -1) || (!commits_take && cue.commit != -1)) return nullptr;
    double boundary = cue_boundary(cue.bar, cue.cue, cue.timing, cue.execute, program->beats_, cue.kind) + cue.bar_offset * program->beats_;
    if (arms_take) {
      if (++arms[cue.take] != 1 || program->takes_[cue.take].begin != boundary) return nullptr;
      arm_cues[cue.take] = id;
      if (cue.timing == 0 && cue.cue >= 0) {
        Take& take = program->takes_[cue.take];
        double extended = take.capacity + std::ceil(program->early_ * rate / 1000 * maximum_bpm / minimum_bpm);
        if (extended > std::numeric_limits<uint32_t>::max()) return nullptr;
        uint32_t capacity = uint32_t(extended);
        pcm_bytes += uint64_t(capacity - take.capacity) * (sizeof(patches::Stereo) + sizeof(float)) * 2;
        take.capacity = capacity;
      }
    }
    if (commits_take) {
      if (++commits[cue.commit] != 1 || program->takes_[cue.commit].end != boundary) return nullptr;
      program->takes_[cue.commit].commit_cue = id;
    }
  }
  for (int id = 0; id < program->take_count_; ++id) if (arms[id] != 1 || commits[id] != 1) return nullptr;
  auto has_guide = [&](const Cue& cue, double position) {
    return cue.bar > 0 && cue.cue >= 0 && (cue.bar - 1) * program->beats_ + cue.cue == position;
  };
  program->edge_capture_count_ = edge_captures;
  for (int id = 0; id < edge_captures; ++id) {
    const double* row = data + edge_offset + 3 + id * PF_COMPILED_EDGE_CAPTURE_FIELDS;
    if (!index(row[0], program->take_count_) || !index(row[1], program->take_count_) || row[0] == row[1]) return nullptr;
    const int first = int(row[0]), second = int(row[1]);
    Take& a = program->takes_[first]; Take& b = program->takes_[second];
    Cue& arm_a = program->cues_[arm_cues[first]]; Cue& arm_b = program->cues_[arm_cues[second]];
    Cue& cut_a = program->cues_[a.commit_cue]; Cue& cut_b = program->cues_[b.commit_cue];
    if (a.edge_capture || b.edge_capture || a.anchor != first || b.anchor != second || a.voice != b.voice
      || a.profile != b.profile || a.end != b.begin || a.end != a.loop_end || b.end != b.loop_end
      || !has_guide(arm_a, a.begin) || !has_guide(cut_a, a.end) || !has_guide(arm_b, b.begin) || !has_guide(cut_b, b.end)
      || arm_a.button != arm_b.button || arm_a.kind != PF_ARM || arm_b.kind != PF_ARM
      || cut_a.kind != PF_COMMIT || cut_b.kind != PF_COMMIT || cut_a.button != arm_a.button || cut_b.button != arm_a.button
      || cut_a.launch != PF_STORE_ONLY || cut_b.launch != PF_STORE_ONLY || cut_a.mode != PF_ONESHOT_MODE || cut_b.mode != PF_ONESHOT_MODE
      || arm_a.mode != PF_ONESHOT_MODE || arm_b.mode != PF_ONESHOT_MODE || cut_a.group < 0 || cut_a.group != arm_b.group
      || arm_a.group >= 0 || cut_b.group >= 0
      || arm_a.replacement_capture || arm_b.replacement_capture || cut_a.replacement_capture || cut_b.replacement_capture) return nullptr;
    int grouped_cues = 0;
    for (int cue = 0; cue < program->cue_count_; ++cue) {
      if (program->cues_[cue].group == cut_a.group) ++grouped_cues;
    }
    if (grouped_cues != 2) return nullptr;
    for (int previous = 0; previous < id; ++previous) {
      const auto& pair = program->edge_capture_pairs_[previous];
      if (a.begin - edge_arm_early < program->takes_[pair.takes[1]].end + edge_capture_grace
        && program->takes_[pair.takes[0]].begin - edge_arm_early < b.end + edge_capture_grace) return nullptr;
    }
    auto& capture = program->edge_capture_pairs_[id];
    capture.button = arm_a.button;
    capture.takes[0] = first; capture.takes[1] = second;
    capture.arms[0] = arm_cues[first]; capture.arms[1] = arm_cues[second];
    for (Take* take : {&a, &b}) {
      const double capacity = std::ceil((b.end + edge_capture_grace - (a.begin - edge_arm_early)) * rate * 60 / minimum_bpm);
      if (capacity > std::numeric_limits<uint32_t>::max()) return nullptr;
      const uint32_t resized = std::max(take->capacity, uint32_t(capacity));
      pcm_bytes += uint64_t(resized - take->capacity) * (sizeof(patches::Stereo) + sizeof(float)) * 2;
      take->capacity = resized; take->edge_capture = true;
    }
    arm_a.edge_capture = arm_b.edge_capture = cut_a.edge_capture = cut_b.edge_capture = true;
  }
  if (pcm_bytes > 180ULL * 1024 * 1024) return nullptr;
  for (int id = 0; id < program->member_count_; ++id, offset += PF_COMPILED_MEMBER_FIELDS) {
    const double* row = data + offset;
    if (!whole(row[0], PF_MAX_EVENTS - 1) || !index(row[1], program->take_count_) || !std::isfinite(row[2]) || row[2] < 0 || row[2] > 4) return nullptr;
    Member& member = program->members_[id]; member.selection = int(row[0]); member.take = int(row[1]); member.gain = row[2];
    for (int previous = 0; previous < id; ++previous) if (program->members_[previous].selection == member.selection) {
      if (program->members_[previous].take == member.take || program->takes_[program->members_[previous].take].voice != program->takes_[member.take].voice || program->takes_[program->members_[previous].take].anchor != program->takes_[member.take].anchor) return nullptr;
    }
  }
  const int overlap_start = window_count + intro_count;
  const int fixed_windows = overlap_start + overlap_count;
  program->window_count_ = fixed_windows + sustain_count;
  program->selection_windows_.reset(new (std::nothrow) SelectionWindow[program->window_count_]);
  if (!program->selection_windows_) return nullptr;
  for (int id = 0; id < fixed_windows; ++id) {
    const bool intro = id >= window_count;
    const bool overlap = id >= overlap_start;
    const double* row = intro
      ? data + (overlap ? overlap_offset : intro_offset) + 2 + (id - (overlap ? overlap_start : window_count)) * PF_COMPILED_INTRO_LOOP_FIELDS
      : data + window_offset + PF_COMPILED_WINDOW_HEADER_FIELDS + id * PF_COMPILED_WINDOW_FIELDS;
    const double begin = intro ? 0 : row[1], end = row[2], period = intro ? end : row[3];
    if (!whole(row[0], PF_MAX_EVENTS - 1) || !std::isfinite(begin) || !std::isfinite(end) || !std::isfinite(period)
      || begin < 0 || end <= begin || period < end - begin
      || std::floor(begin * 960) != begin * 960 || std::floor(end * 960) != end * 960 || std::floor(period * 960) != period * 960) return nullptr;
    if (intro && (!whole(row[1] / program->beats_, program->bars_) || !whole(end / program->beats_, program->bars_) || row[1] >= end)) return nullptr;
    auto& window = program->selection_windows_[id];
    window.selection = int(row[0]); window.begin = begin; window.end = end; window.period = period;
    if (intro) window.repeat_begin = row[1];
    window.overlap_final_eighth = overlap;
    for (int previous = 0; previous < id; ++previous) if (program->selection_windows_[previous].selection == window.selection) return nullptr;
    for (int member = 0; member < program->member_count_; ++member) if (program->members_[member].selection == window.selection) {
      if (window.take >= 0) return nullptr;
      window.take = program->members_[member].take;
    }
    if (window.take < 0) return nullptr;
    const Take& take = program->takes_[window.take];
    if (window.end > take.end - take.begin || window.begin + window.period > take.loop_end - take.begin) return nullptr;
    if (overlap && (take.end - take.begin != window.end + .5 || std::fmod(take.end, double(program->beats_)) != 0)) return nullptr;
    if (intro && !overlap && (std::fmod(take.end - take.begin, double(program->beats_)) != 0
      || !(std::fmod(take.end, double(program->beats_)) == 0 || std::fmod(take.end, double(program->beats_)) >= program->beats_ - 1))) return nullptr;
    if (intro) for (int other = 0; other < program->take_count_; ++other)
      if (other != window.take && program->takes_[other].anchor == take.anchor) return nullptr;
    for (int cue = 0; cue < program->cue_count_; ++cue) if (program->cues_[cue].selection == window.selection) {
      const auto& selected = program->cues_[cue];
      if (intro && selected.kind != PF_STOP && selected.mode != PF_LOOP_MODE) return nullptr;
      if (!intro && (selected.kind == PF_COMMIT || selected.kind == PF_COMMIT_ARM)
        && (window.end != take.end - take.begin || window.begin != window.end - program->beats_ || window.period != program->beats_)) return nullptr;
    }
  }
  for (int id = 0; id < sustain_count; ++id) {
    double selected = data[sustain_offset + 2 + id];
    if (!whole(selected, PF_MAX_EVENTS - 1)) return nullptr;
    auto& window = program->selection_windows_[fixed_windows + id];
    window.selection = int(selected); window.automatic = true; window.begin = window.end = window.period = -1;
    for (int previous = 0; previous < fixed_windows + id; ++previous) if (program->selection_windows_[previous].selection == window.selection) return nullptr;
    for (int member = 0; member < program->member_count_; ++member) if (program->members_[member].selection == window.selection) {
      if (window.take >= 0) return nullptr;
      window.take = program->members_[member].take;
    }
    if (window.take < 0) return nullptr;
    for (int previous = fixed_windows; previous < fixed_windows + id; ++previous)
      if (program->selection_windows_[previous].take == window.take) return nullptr;
    for (int cue = 0; cue < program->cue_count_; ++cue) if (program->cues_[cue].selection == window.selection
      && (program->cues_[cue].kind != PF_PLAY || (program->cues_[cue].mode != PF_HELD_MODE && program->cues_[cue].mode != PF_GATED_MODE))) return nullptr;
  }
  for (int id = 0; id < program->playback_count_; ++id, offset += PF_COMPILED_PLAYBACK_FIELDS) {
    const double* row = data + offset;
    if (!whole(row[0], program->bars_) || row[0] < 1 || !index(row[1], PF_CHANNELS) || !whole(row[2], PF_MAX_EVENTS - 1)) return nullptr;
    for (int window = window_count; window < program->window_count_; ++window)
      if (program->selection_windows_[window].selection == int(row[2])) return nullptr;
    PlaybackCue& cue = program->playback_[id]; cue.bar = int(row[0]); cue.voice = int(row[1]); cue.selection = int(row[2]);
  }
  for (int id = 0; id < program->cue_count_; ++id) {
    const Cue& cue = program->cues_[id];
    if ((cue.kind == PF_COMMIT || cue.kind == PF_COMMIT_ARM || cue.kind == PF_PLAY) && cue.selection < 0) return nullptr;
    if (cue.selection >= 0) {
      if (cue.kind == PF_ARM || (cue.kind == PF_STOP && data[1] == PF_COMPILED_LEGACY_VERSION)) return nullptr;
      bool found = false, committed = false;
      for (int member = 0; member < program->member_count_; ++member) if (program->members_[member].selection == cue.selection) {
        const Take& take = program->takes_[program->members_[member].take];
        if (take.voice != cue.voice || take.end > cue_boundary(cue.bar, cue.cue, cue.timing, cue.execute, program->beats_, cue.kind) + cue.bar_offset * program->beats_) return nullptr;
        if (program->members_[member].take == cue.commit) committed = true;
        found = true;
      }
      if (!found || ((cue.kind == PF_COMMIT || cue.kind == PF_COMMIT_ARM) && !committed)) return nullptr;
    }
  }
  for (int id = 0; id < program->playback_count_; ++id) {
    bool found = false;
    for (int member = 0; member < program->member_count_; ++member) if (program->members_[member].selection == program->playback_[id].selection) {
      const Take& take = program->takes_[program->members_[member].take];
      if (take.voice != program->playback_[id].voice || take.end > (program->playback_[id].bar - 1) * program->beats_) return nullptr;
      found = true;
    }
    if (!found) return nullptr;
  }
  auto full_take = [&](int selection, int voice) {
    for (int index = 0; index < program->window_count_; ++index)
      if (program->selection_windows_[index].selection == selection) return -1;
    int take = -1;
    for (int index = 0; index < program->member_count_; ++index) if (program->members_[index].selection == selection) {
      const auto& member = program->members_[index];
      if (take >= 0 || program->takes_[member.take].voice != voice) return -1;
      take = member.take;
    }
    return take;
  };
  for (int id = 0; id < edge_captures; ++id) {
    const auto& pair = program->edge_capture_pairs_[id];
    for (int take : pair.takes) {
      const Take& captured = program->takes_[take];
      if (full_take(program->cues_[captured.commit_cue].selection, captured.voice) != take) return nullptr;
      for (int window = 0; window < program->window_count_; ++window)
        if (program->selection_windows_[window].take == take && !program->selection_windows_[window].automatic) return nullptr;
    }
  }
  program->edge_playback_count_ = edge_playbacks;
  if (edge_playbacks) {
    program->edge_playback_pairs_.reset(new (std::nothrow) EdgePlaybackPair[edge_playbacks]);
    if (!program->edge_playback_pairs_) return nullptr;
  }
  for (int id = 0; id < edge_playbacks; ++id) {
    const double* row = data + edge_offset + 3 + edge_captures * PF_COMPILED_EDGE_CAPTURE_FIELDS + id * PF_COMPILED_EDGE_PLAYBACK_FIELDS;
    if (!index(row[0], PF_CHANNELS) || !whole(row[1], program->bars_) || row[1] < 1 || !point(row[2], program->beats_)
      || !whole(row[3], PF_MAX_EVENTS - 1) || !whole(row[4], PF_MAX_EVENTS - 1) || row[3] == row[4]) return nullptr;
    auto& pair = program->edge_playback_pairs_[id];
    pair.button = int(row[0]); pair.at = (row[1] - 1) * program->beats_ + row[2];
    if (pair.at + 1 >= program->end_ * program->beats_) return nullptr;
    const double window_start = pair.at - edge_playback_tolerance, window_end = pair.at + 1 + edge_playback_tolerance;
    for (int cue_id = 0; cue_id < program->cue_count_; ++cue_id) {
      const Cue& cue = program->cues_[cue_id];
      if (cue.button != pair.button || cue.bar < 1) continue;
      const double bar_start = (cue.bar - 1) * program->beats_;
      if (cue.cue < 0) {
        if (bar_start <= window_end && bar_start + program->beats_ > window_start) return nullptr;
      } else {
        const double guide = bar_start + cue.cue;
        if (guide >= window_start && guide <= window_end) return nullptr;
      }
    }
    for (int step = 0; step < 2; ++step) {
      pair.selections[step] = int(row[3 + step]);
      pair.takes[step] = full_take(pair.selections[step], program->binding_[pair.button]);
      if (pair.takes[step] < 0) return nullptr;
      const auto& take = program->takes_[pair.takes[step]];
      const auto& commit = program->cues_[take.commit_cue];
      if (commit.mode != PF_ONESHOT_MODE || commit.launch != PF_STORE_ONLY || commit.selection != pair.selections[step]
        || take.end > pair.at - edge_playback_tolerance) return nullptr;
    }
    if (pair.takes[0] == pair.takes[1]) return nullptr;
    for (int previous = 0; previous < id; ++previous) {
      const auto& other = program->edge_playback_pairs_[previous];
      if (pair.button == other.button && std::abs(pair.at - other.at) <= 1 + 2 * edge_playback_tolerance) return nullptr;
    }
  }
  if (edge_captures) for (int id = 0; id < program->cue_count_; ++id) {
    auto& cue = program->cues_[id];
    if (cue.kind != PF_PLAY || cue.mode != PF_ONESHOT_MODE || cue.cue < 0) continue;
    const int take = full_take(cue.selection, cue.voice);
    cue.word_window = take >= 0 && program->takes_[take].edge_capture;
  }
  if (!definitions || !revisions || !program->prepare_effects(definitions, revisions)) return nullptr;
  return program;
}

bool Program::prepare_effects(const patches::Rack& definition, uint32_t revision) noexcept {
  const patches::Rack* definitions[PF_VOICE_PROFILES]; uint32_t revisions[PF_VOICE_PROFILES];
  for (int voice = 0; voice < PF_VOICE_PROFILES; ++voice) { definitions[voice] = &definition; revisions[voice] = revision; }
  return prepare_effects(definitions, revisions);
}
bool Program::prepare_effects(const patches::Rack* const* definitions, const uint32_t* revisions) noexcept {
  for (int id = 0; id < take_count_; ++id) for (const auto& playback : takes_[id].playback)
    if (playback && playback->state() != patches::PlaybackState::idle) return false;
  bool stale[PF_VOICE_PROFILES]{}, changed_graph[PF_VOICE_PROFILES]{};
  for (int voice = 0; voice < PF_VOICE_PROFILES; ++voice) {
    if (!definitions[voice]) return false;
    changed_graph[voice] = !voices_[voice] || !voices_[voice]->compatible(*definitions[voice]);
    stale[voice] = changed_graph[voice];
  }
  for (int id = 0; id < take_count_; ++id) for (int bank = 0; bank < 2; ++bank)
    if (bank != takes_[id].latest && (!takes_[id].cache[bank] || takes_[id].cache[bank]->revision() != revisions[takes_[id].profile])) stale[takes_[id].profile] = true;
  if (std::none_of(stale, stale + PF_VOICE_PROFILES, [](bool value) { return value; })) {
    std::copy(revisions, revisions + PF_VOICE_PROFILES, prepared_revision_); return true;
  }
  std::unique_ptr<patches::Rack> voices[PF_VOICE_PROFILES], tails[PF_VOICE_PROFILES];
  std::unique_ptr<patches::ProcessedTake> caches[PF_COMPILED_MAX_TAKES][2];
  std::unique_ptr<patches::Playback> players[PF_COMPILED_MAX_TAKES][2];
  auto scans = std::unique_ptr<std::unique_ptr<patches::Rack>[]>(new (std::nothrow) std::unique_ptr<patches::Rack>[window_count_ * 2]);
  auto checkpoints = std::unique_ptr<std::unique_ptr<patches::Rack>[]>(new (std::nothrow) std::unique_ptr<patches::Rack>[window_count_ * 2]);
  if (!checkpoints || !scans) return false;
  uint64_t estimated = 0;
  for (int id = 0; id < take_count_; ++id) for (int bank = 0; bank < 2; ++bank)
    if (takes_[id].cache[bank]) estimated += takes_[id].cache[bank]->memory_bytes() + takes_[id].playback[bank]->memory_bytes();
  for (int voice = 0; voice < PF_VOICE_PROFILES; ++voice) {
    if (voices_[voice]) estimated += voices_[voice]->memory_bytes();
    if (tails_[voice]) estimated += tails_[voice]->memory_bytes();
    if (!stale[voice]) continue;
    voices[voice] = definitions[voice]->snapshot(); tails[voice] = definitions[voice]->snapshot();
    if (!voices[voice] || !tails[voice]) return false;
    estimated += voices[voice]->memory_bytes() + tails[voice]->memory_bytes();
  }
  for (int id = 0; id < take_count_; ++id) for (int bank = 0; bank < 2; ++bank) {
    uint32_t revision = revisions[takes_[id].profile];
    if (takes_[id].latest == bank || (!changed_graph[takes_[id].profile] && takes_[id].cache[bank] && takes_[id].cache[bank]->revision() == revision)) continue;
    caches[id][bank] = patches::ProcessedTake::create(*definitions[takes_[id].profile], takes_[id].capacity, revision, 1);
    if (!caches[id][bank]) return false;
    players[id][bank] = patches::Playback::create(*caches[id][bank], patches::PlaybackMode::evolving);
    if (!players[id][bank]) return false;
    estimated += caches[id][bank]->memory_bytes() + players[id][bank]->memory_bytes();
    if (estimated > 200ULL * 1024 * 1024) return false;
  }
  for (int id = 0; id < window_count_; ++id) for (int bank = 0; bank < 2; ++bank) {
    auto& window = selection_windows_[id];
    if (window.initial[bank]) estimated += window.initial[bank]->memory_bytes();
    if (window.scan_initial[bank]) estimated += window.scan_initial[bank]->memory_bytes();
    if (window.initial[bank] && !caches[window.take][bank]) continue;
    if (window.repeat_begin >= 0) continue;
    if (window.automatic) { scans[id * 2 + bank] = definitions[takes_[window.take].profile]->snapshot(); if (!scans[id * 2 + bank]) return false; }
    checkpoints[id * 2 + bank] = definitions[takes_[window.take].profile]->snapshot();
    if (!checkpoints[id * 2 + bank]) return false;
    estimated += checkpoints[id * 2 + bank]->memory_bytes();
    if (scans[id * 2 + bank]) estimated += scans[id * 2 + bank]->memory_bytes();
    if (estimated > 200ULL * 1024 * 1024) return false;
  }
  for (int voice = 0; voice < PF_VOICE_PROFILES; ++voice) {
    if (voices[voice]) { voices_[voice] = std::move(voices[voice]); tails_[voice] = std::move(tails[voice]); }
    prepared_revision_[voice] = revisions[voice];
  }
  for (int id = 0; id < take_count_; ++id) for (int bank = 0; bank < 2; ++bank) if (caches[id][bank]) {
    takes_[id].playback[bank].reset();
    takes_[id].cache[bank] = std::move(caches[id][bank]);
    takes_[id].playback[bank] = std::move(players[id][bank]);
  }
  for (int id = 0; id < window_count_; ++id) for (int bank = 0; bank < 2; ++bank) {
    if (scans[id * 2 + bank]) selection_windows_[id].scan_initial[bank] = std::move(scans[id * 2 + bank]);
    if (checkpoints[id * 2 + bank]) selection_windows_[id].initial[bank] = std::move(checkpoints[id * 2 + bank]);
  }
  return true;
}
void Program::start(int start_bar, int count_in_beats, double frame, double bpm, int end_bar) noexcept {
  stop(); reset_edge_pairs(); bpm_ = bpm; run_end_ = end_bar > 0 ? end_bar : end_; captures_cancelled_ = false;
  for (int id = 0; id < note_count_; ++id) notes_[id].played = false; start_ = start_bar; phase_ = count_in_beats ? PF_COUNT_IN : PF_PLAYING; bar_ = count_in_beats ? 0 : start_bar;
  anchor_frame_ = frame; anchor_position_ = (start_bar - 1) * beats_ - count_in_beats - 1;
  query_position_ = anchor_position_; query_frame_ = frame;
  for (int id = 0; id < cue_count_; ++id) { cues_[id].used = false; cues_[id].announced = false; cues_[id].occurred_frame = std::numeric_limits<double>::quiet_NaN(); }
  std::fill(suppressed_, suppressed_ + PF_VOICE_PROFILES, false);
  for (int voice = 0; voice < PF_CHANNELS; ++voice) { gated_[voice] = held_[voice] = -1; button_down_[voice] = false; input_owner_[voice] = 0; }

}
void Program::stop() noexcept {
  pause_tuning_bank();
  cancel_edge_capture();
  if (active_capture_.take >= 0) {
    Take& take = takes_[active_capture_.take];
    uint32_t period = 0;
    if (commit_period(active_capture_.take, period) && take.cache[active_capture_.bank]->commit(period)) {
      take.grid[active_capture_.bank].add(take.end, take.cache[active_capture_.bank]->length());
      take.grid[active_capture_.bank].add(take.loop_end, period);
      take.latest = active_capture_.bank;
    } else take.cache[active_capture_.bank]->reset_for_capture();
  }
  for (auto& voice : external_playback_) voice = {};
  for (auto& launch : overlap_launch_) launch = {};
  active_capture_ = {}; live_route_ = -1; monitor_route_ = default_route; rotation_deadline_frame_ = -1; clear_gesture(); phase_ = PF_IDLE;

  for (int button = 0; button < PF_CHANNELS; ++button) { gated_[button] = held_[button] = -1; button_down_[button] = false; input_owner_[button] = 0; } error_ = PF_OK;
  for (int id = 0; id < cue_count_; ++id) pending_[id] = {};
  for (int voice = 0; voice < PF_VOICE_PROFILES; ++voice) { if (voices_[voice]) voices_[voice]->reset(); if (tails_[voice]) tails_[voice]->reset(); drain_[voice] = 0; detached_tail_[voice] = false; tail_generation_[voice] = 0; }
  drain_[default_route] = 0; drain_[backup_route] = 0;
  std::fill(handed_off_, handed_off_ + PF_VOICE_PROFILES, false);
  for (int id = 0; id < take_count_; ++id) for (auto& playback : takes_[id].playback) if (playback) playback->reset();
}
void Program::microphone_lost() noexcept {
  pause_tuning_bank();
  cancel_edge_capture();
  if (active_capture_.take >= 0) takes_[active_capture_.take].cache[active_capture_.bank]->reset_for_capture();
  active_capture_ = {}; live_route_ = -1; monitor_route_ = default_route; rotation_deadline_frame_ = -1; clear_gesture();
  for (int id = 0; id < cue_count_; ++id) pending_[id] = {};
  for (int voice = 0; voice < PF_VOICE_PROFILES; ++voice) { voices_[voice]->reset(); tails_[voice]->reset(); drain_[voice] = 0; detached_tail_[voice] = false; tail_generation_[voice] = 0; }
  drain_[default_route] = 0; drain_[backup_route] = 0;
  std::fill(handed_off_, handed_off_ + PF_VOICE_PROFILES, false);
}
double Program::cue_frame(const Cue& cue, double bpm) const noexcept {
  return std::isfinite(cue.occurred_frame) ? cue.occurred_frame : anchor_frame_ + ((cue.bar - 1) * beats_ + cue.cue - anchor_position_) * rate_ * 60 / bpm;
}
void Program::remember_cues(double frame, double bpm) noexcept {
  double now = position(frame, bpm);
  for (int id = 0; id < cue_count_; ++id) {
    Cue& cue = cues_[id]; double at = (cue.bar - 1) * beats_ + cue.cue;
    if (cue.cue >= 0 && cue_on_current_bar(cue) && at <= now && !std::isfinite(cue.occurred_frame)) cue.occurred_frame = cue_frame(cue, bpm);
  }
}
void Program::tempo_changed(double frame, double old_bpm, double new_bpm) noexcept {
  if (active_capture_.take >= 0 && std::abs(old_bpm - new_bpm) > epsilon) {
    auto& take = takes_[active_capture_.take];
    auto& grid = take.grid[active_capture_.bank];
    grid.add(position(frame, old_bpm), take.cache[active_capture_.bank]->length());
    grid.tempo_changed = true;
  }
  remember_cues(frame, old_bpm);
  if (rotation_deadline_frame_ > frame) rotation_deadline_frame_ = frame + (rotation_deadline_frame_ - frame) * old_bpm / new_bpm;
  anchor_position_ = position(frame, old_bpm); anchor_frame_ = frame;
  query_position_ = anchor_position_; query_frame_ = frame; bpm_ = new_bpm;
  if (rotation_deadline_frame_ > frame && gesture_window_ >= 0)
    rotation_deadline_frame_ = std::min(rotation_deadline_frame_, frame_at(rotation_windows_[gesture_window_].end));
}
double Program::loop_phase(const Take& take, int bank) const noexcept {
  const auto& clock = take.clock[bank];
  if (clock.warped) return clock.phase;
  if (!clock.frames || !clock.counts) return 0;
  const auto& grid = take.grid[bank];
  const double phase = clock.repeat_begin > 0 ? std::min(take.playback[bank]->phase(), clock.frames) : take.playback[bank]->phase() % clock.frames;
  return clock.wrap(grid.interpolate(clock.first_frame + phase, true, grid.initial_bpm / (rate_ * 60)) - clock.first_count);
}

bool Program::follows_changed_tempo(const Take& take, int bank, double bpm) const noexcept {
  const auto& grid = take.grid[bank];
  return take.clock[bank].counts > 0 &&
    (take.clock[bank].warped || grid.tempo_changed || std::abs(grid.initial_bpm - bpm) > epsilon);
}

bool Program::commit_period(int id, uint32_t& period) const noexcept {
  const Take& take = takes_[id];
  const auto& cache = take.cache[active_capture_.bank];
  const auto& grid = take.grid[active_capture_.bank];
  const double counts = take.loop_end - take.begin;
  const bool warped = grid.tempo_changed;
  if (warped && (std::abs(grid.points[0].count - take.begin) > grid.initial_bpm / (rate_ * 60) + epsilon ||
    query_position_ + bpm_ / (rate_ * 60) < take.end || !cache->length())) return false;
  const double expected = warped ? cache->length() + std::ceil((take.loop_end - take.end) * rate_ * 60 / bpm_)
    : std::ceil(counts * rate_ * 60 / grid.initial_bpm);
  if (expected < 1 || expected > std::numeric_limits<uint32_t>::max()) return false;
  period = uint32_t(expected);
  if (take.anchor != id) {
    const Take& anchor = takes_[take.anchor];
    if (anchor.latest < 0 || anchor.playback[anchor.latest]->state() != patches::PlaybackState::playing) return false;
    const auto& anchor_grid = anchor.grid[anchor.latest];
    if (warped || follows_changed_tempo(anchor, anchor.latest, bpm_) || std::abs(anchor_grid.initial_bpm - grid.initial_bpm) > epsilon) {
      const double recorded = std::fmod(take.end - take.begin, counts);
      const double delta = std::abs(loop_phase(anchor, anchor.latest) - recorded);
      if (std::min(delta, counts - delta) > 2 * bpm_ / (rate_ * 60)) return false;
    } else {
      period = anchor.cache[anchor.latest]->period();
      if (std::abs(double(period) - expected) > 1 || std::min(take.capture_start_phase, double(period) - take.capture_start_phase) > 1) return false;
      double actual = anchor.playback[anchor.latest]->phase() % period, joined = cache->length() % period;
      double delta = std::abs(actual - joined);
      if (std::min(delta, double(period) - delta) > 1) return false;
    }
  }
  const double expected_capture = (take.end - take.begin) * rate_ * 60 / grid.initial_bpm;
  return cache->length() <= period && (warped || std::abs(double(cache->length()) - expected_capture) <= 1);
}
double Program::position(double frame, double bpm) const noexcept { return anchor_position_ + (frame - anchor_frame_) * bpm / (rate_ * 60); }
double Program::frame_at(double position) const noexcept { return anchor_frame_ + (position - anchor_position_) * rate_ * 60 / bpm_; }
int Program::available_bank(int id) const noexcept {
  if (id < 0 || id >= take_count_) return -1;
  const Take& take = takes_[id];
  for (int bank = 0; bank < 2; ++bank) if (bank != take.latest && !(active_capture_.take == id && active_capture_.bank == bank) && take.cache[bank] && take.cache[bank]->revision() == prepared_revision_[take.profile] && take.playback[bank] && take.playback[bank]->state() == patches::PlaybackState::idle) return bank;
  return -1;
}
bool Program::cue_on_current_bar(const Cue& cue) const noexcept {
  return cue.bar == bar_ && (cue.bar == 0 ? start_ == 1 : cue.bar >= start_);
}
bool Program::cue_visible(const Cue& cue, int end_bar) const noexcept {
  if (cue.used || cue.bar > end_bar) return false;
  if (cue.cue < 0) return cue_on_current_bar(cue);
  const double at = (cue.bar - 1) * beats_ + cue.cue;
  return cue.bar >= start_ && query_position_ >= at - 2 && query_position_ <= at;
}
bool Program::cue_warning(int end_bar, uint32_t rows) const noexcept {
  if (phase_ != PF_COUNT_IN && phase_ != PF_PLAYING) return false;
  for (int id = 0; id < cue_count_; ++id)
    if ((rows & (1u << cues_[id].button)) && cue_visible(cues_[id], end_bar)) return true;
  return false;
}
void Program::publish_cue_entries(int end_bar) noexcept {
  if (!cue_entry_ || (phase_ != PF_COUNT_IN && phase_ != PF_PLAYING)) return;
  for (int id = 0; id < cue_count_; ++id) {
    Cue& cue = cues_[id];
    if (cue.announced || !cue_visible(cue, end_bar)) continue;
    cue.announced = true;
    const double target_frame = cue.cue < 0 ? query_frame_ : cue_frame(cue, bpm_);
    cue_entry_(cue_context_, query_frame_, target_frame, cue.button, id);
  }
}
bool Program::has_capture() const noexcept {
  if (active_capture_.take >= 0 || edge_capture_.pair >= 0) return true;
  for (int id = 0; id < cue_count_; ++id) if (pending_[id].reserved_take >= 0) return true;
  return false;
}
void Program::discard_capture() noexcept {
  captures_cancelled_ = true;
  cancel_edge_capture();
  const int recording = active_capture_.take;
  for (int id = 0; id < cue_count_; ++id) {
    const auto& pending = pending_[id];
    if (pending.reserved_take >= 0 || (recording >= 0 && pending.cue >= 0 && cues_[pending.cue].commit == recording))
      pending_[id] = {};
  }
  if (recording >= 0) discard_invalid_draft(cues_[takes_[recording].commit_cue]);
}
bool Program::recording_rows(uint32_t rows) const noexcept {
  if (active_capture_.take < 0) return false;
  for (int button = 0; button < PF_CHANNELS; ++button)
    if ((rows & (1u << button)) && takes_[active_capture_.take].voice == binding_[button]) return true;
  return false;
}
bool Program::reservation_available(int id, int button, int committing) const noexcept {
  const Take& requested = takes_[id];
  auto overlaps = [&](int other) { return other >= 0 && requested.begin < takes_[other].end && takes_[other].begin < requested.end; };
  if (active_capture_.take != committing && overlaps(active_capture_.take)) return false;
  for (int other = 0; other < cue_count_; ++other) if (cues_[other].button != button && overlaps(pending_[other].reserved_take)) return false;
  return true;
}
void Program::switch_route(int voice, bool history_handed_off) noexcept {
  if (history_handed_off && live_route_ >= 0 && monitor_route_ == live_route_) handed_off_[live_route_] = true;
  live_route_ = voice;
}
bool Program::rotation_eligible() const noexcept {
  if (phase_ != PF_PLAYING) return false;
  for (int id = 0; id < rotation_count_; ++id) if (query_frame_ >= frame_at(rotation_windows_[id].begin) && query_frame_ < frame_at(rotation_windows_[id].end)) return true;
  return false;
}
double Program::rotation_remaining() const noexcept {
  if (!rotation_eligible() || rotation_deadline_frame_ < 0) return 0;
  double frames = rotation_deadline_frame_ - query_frame_;
  return frames > 0 ? frames * bpm_ / (rate_ * 60) : 0;
}
void Program::clear_gesture() noexcept {
  tuning_turn_armed_ = false;
  gesture_direction_ = 0; gesture_window_ = -1; gesture_travel_ = gesture_reversal_ = 0; gesture_bucket_end_ = -1;
}
void Program::jiggle_thresholds(int travel, int reversal) noexcept {
  minimum_travel_ = travel; minimum_reversal_ = reversal; clear_gesture();
}
bool Program::meaningful_motion(double value, double frame) noexcept {
  if (gesture_bucket_end_ < 0 || frame >= frame_at(gesture_bucket_end_)) {
    gesture_travel_ = gesture_reversal_ = 0;
    gesture_bucket_end_ = query_position_ + rotation_inactivity_;
  }
  int direction = value > 0 ? 1 : -1;
  if (!gesture_direction_) gesture_direction_ = direction;
  double distance = std::abs(value);
  bool accepted;
  if (direction == gesture_direction_) {
    gesture_travel_ = std::min(double(minimum_travel_), gesture_travel_ + std::min(distance, double(minimum_travel_)));
    accepted = gesture_travel_ >= minimum_travel_;
  } else {
    gesture_reversal_ = std::min(double(minimum_reversal_), gesture_reversal_ + std::min(distance, double(minimum_reversal_)));
    accepted = gesture_reversal_ >= minimum_reversal_;
  }
  if (accepted) {
    gesture_direction_ = direction; gesture_travel_ = gesture_reversal_ = 0; gesture_bucket_end_ = -1;
  }
  return accepted;
}
int Program::rotate(double value, double frame, double bpm) noexcept {
  if (!std::isfinite(value)) return PF_INVALID_KNOB;
  bpm_ = bpm; query_position_ = position(frame, bpm); query_frame_ = frame;
  if (phase_ != PF_PLAYING) return PF_OK;
  double elapsed = last_motion_frame_ >= 0 ? (frame - last_motion_frame_) / rate_ : 1.0 / 60;
  if (elapsed > 0) motion_velocity_ = value / elapsed;
  last_motion_frame_ = frame;
  for (int button = 0; button < PF_CHANNELS; ++button) if (button_down_[button] && held_[button] >= 0) {
    double semitones = std::clamp((motion_velocity_ - bend_baseline_[button]) / bend_velocity_per_semitone_, -3.0, 3.0);
    int selection = cues_[held_[button]].selection;
    for (int member = 0; member < member_count_; ++member) if (members_[member].selection == selection) {
      Take& take = takes_[members_[member].take];
      if (take.latest >= 0) take.playback[take.latest]->set_semitones(semitones);
    }
    return PF_OK;
  }
  if (!value) return PF_OK;
  for (int id = 0; id < rotation_count_; ++id) if (frame >= frame_at(rotation_windows_[id].begin) && frame < frame_at(rotation_windows_[id].end)) {
    if (gesture_window_ != id) { clear_gesture(); gesture_window_ = id; }
    if (meaningful_motion(value, frame)) rotation_deadline_frame_ = std::min(frame + rotation_inactivity_ * rate_ * 60 / bpm, frame_at(rotation_windows_[id].end));
    return PF_OK;
  }
  clear_gesture();
  return PF_OK;
}
int Program::profile_activity(int profile) const noexcept {
  int selected = rotation_remaining() > 0 ? backup_route : live_route_ < 0 ? default_route : live_route_;
  int selected_profile = selected == default_route ? PF_DEFAULT_PROFILE : selected == backup_route ? PF_BACKUP_PROFILE : selected;
  if ((phase_ == PF_COUNT_IN || phase_ == PF_PLAYING) && profile == selected_profile) return PF_VOICE_LIVE;
  if (active_capture_.take >= 0 && takes_[active_capture_.take].profile == profile) return PF_VOICE_CAPTURE;
  bool draining = profile >= 0 && profile < PF_VOICE_PROFILES && drain_[profile];
  if (profile == PF_DEFAULT_PROFILE) draining = draining || drain_[default_route];
  if (profile == PF_BACKUP_PROFILE) draining = draining || drain_[backup_route];
  return draining ? PF_VOICE_TAIL : PF_VOICE_STANDBY;
}
int Program::resolve(int button, double frame, double bpm) noexcept {
  if (button < 0 || button >= PF_CHANNELS || phase_ == PF_IDLE || phase_ == PF_ENDED) return -PF_INVALID_CHANNEL;
  error_ = PF_OK;
  remember_cues(frame, bpm);
  double best = std::numeric_limits<double>::infinity(); int found = -1; bool tied = false;
  for (int id = 0; id < cue_count_; ++id) {
    const Cue& cue = cues_[id];
    if (cue.button != button || cue.edge_capture || cue.bar > run_end_ || (cue.bar != 0 && cue.bar < start_)
      || (cue.used && !cue.playback_intent())) continue;
    double at = cue_frame(cue, bpm), delta = frame - at;
    const double word_offset = query_position_ - ((cue.bar - 1) * beats_ + cue.cue);
    bool applicable = cue.cue < 0 ? cue_on_current_bar(cue) : phase_ == PF_PLAYING && (cue.word_window
      ? std::abs(word_offset) <= edge_playback_tolerance + epsilon
      : delta >= -early_ * rate_ / 1000 - epsilon && delta <= late_ * rate_ / 1000 + epsilon);
    if (!applicable) continue;
    double distance = cue.cue < 0 ? 0 : std::abs(delta);
    if (distance < best - epsilon) { found = id; best = distance; tied = false; }
    else if (std::abs(distance - best) <= epsilon && !(cue.group >= 0 && found >= 0 && cues_[found].group == cue.group)) tied = true;
  }
  if (tied) return -PF_CUE_AMBIGUOUS;
  return found < 0 ? -PF_CUE_LATE : found;
}
int Program::recoverable_playback(int button, double frame, double bpm) const noexcept {
  if (phase_ != PF_PLAYING) return -1;
  const double now = position(frame, bpm);
  int latest = -1;
  double latest_at = -1;
  bool tied = false;
  for (int id = 0; id < cue_count_; ++id) {
    const Cue& cue = cues_[id];
    if (cue.button != button || cue.bar < start_ || cue.bar > bar_ || !cue.playback_intent()) continue;
    const double at = (cue.bar - 1) * beats_ + std::max(0., cue.cue);
    if (at > now + epsilon || at < latest_at) continue;
    if (at > latest_at) { latest = id; latest_at = at; tied = false; }
    else if (cue.group < 0 || cue.group != cues_[latest].group) tied = true;
  }
  if (latest < 0) return -1;
  if (tied) return -PF_CUE_AMBIGUOUS;
  const int group = cues_[latest].group;
  for (int id = 0; id < cue_count_; ++id) {
    const Cue& cue = cues_[id];
    if ((id == latest || (group >= 0 && cue.group == group)) && cue.recoverable() && !cue.used) return id;
  }
  return -1;
}
int Program::press(int button, double frame, double bpm, bool microphone) noexcept {
  if (button < 0 || button >= PF_CHANNELS) return PF_INVALID_CHANNEL;
  return press_buttons(1u << button, uint64_t(button + 1), frame, bpm, microphone, false, uint64_t(button + 1));
}
int Program::press_current(double frame, double bpm, bool microphone) noexcept {
  return press_rows(15, 5, frame, bpm, microphone, 5);
}
int Program::press_rows(uint32_t rows, uint64_t owner, double frame, double bpm, bool microphone, uint64_t source) noexcept {
  if (!rows || (rows & ~15u) || !owner) return PF_INVALID_INPUT;
  return press_buttons(rows, owner, frame, bpm, microphone, true, source);
}
double Program::edge_deadline(const EdgeCapturePair& pair) const noexcept {
  return std::min(takes_[pair.takes[1]].end + edge_capture_grace, double(run_end_ * beats_));
}
void Program::reset_edge_pairs() noexcept {
  for (int id = 0; id < edge_capture_count_; ++id) edge_capture_pairs_[id].used = false;
  for (int id = 0; id < edge_playback_count_; ++id) {
    auto& pair = edge_playback_pairs_[id];
    pair.fired[0] = pair.fired[1] = false;
  }
}
void Program::cancel_edge_capture() noexcept {
  if (edge_capture_.pair < 0) return;
  const int take = edge_capture_pairs_[edge_capture_.pair].takes[edge_capture_.step];
  edge_capture_ = {};
  if (active_capture_.take == take) discard_invalid_draft(cues_[takes_[take].commit_cue]);
}
int Program::arm_edge_capture(int pair, int step, uint64_t owner, uint64_t source, bool microphone) noexcept {
  if (!microphone) return PF_MICROPHONE_REQUIRED;
  const int take = edge_capture_pairs_[pair].takes[step];
  if (active_capture_.take >= 0 || !reservation_available(take, edge_capture_pairs_[pair].button, -1)) return PF_CAPTURE_BUSY;
  if (available_bank(take) < 0) return PF_TAKE_UNAVAILABLE;
  edge_capture_ = {pair, step, source, owner};
  cues_[edge_capture_pairs_[pair].arms[step]].used = true;
  return PF_OK;
}
int Program::edge_press(int button, uint64_t owner, uint64_t source, double frame, bool microphone) noexcept {
  if (!source || phase_ != PF_PLAYING) return -1;
  if (edge_capture_.pair >= 0) {
    const auto& pair = edge_capture_pairs_[edge_capture_.pair];
    if (pair.button == button) {
      if (source != edge_capture_.source || edge_capture_.hold) return PF_OK;
      if (query_position_ >= edge_deadline(pair)) { cancel_edge_capture(); return PF_OK; }
      const int pair_id = edge_capture_.pair, step = edge_capture_.step, take = pair.takes[step];
      if (active_capture_.take != take) return PF_NO_RECORDING;
      const Cue& cut = cues_[takes_[take].commit_cue];
      observe_windows(frame);
      CommitPlan plan;
      const int result = preflight_commit(cut, plan);
      if (result != PF_OK) { cancel_edge_capture(); return result; }
      edge_capture_ = {};
      const int finished = finish_capture(cut, plan, false);
      if (finished != PF_OK) return finished;
      edge_capture_pairs_[pair_id].used = true;
      cues_[takes_[take].commit_cue].used = true;
      if (step == 0) return arm_edge_capture(pair_id, 1, owner, source, microphone);
      return PF_OK;
    }
  }
  for (int id = 0; id < edge_capture_count_; ++id) {
    const auto& pair = edge_capture_pairs_[id];
    const double guide = takes_[pair.takes[0]].begin;
    if (pair.button != button || guide < (start_ - 1) * beats_ || takes_[pair.takes[1]].end > run_end_ * beats_
      || query_position_ < guide - edge_arm_early || query_position_ > guide + edge_arm_late) continue;
    if (pair.used || captures_cancelled_) return PF_OK;
    if (edge_capture_.pair >= 0) return PF_CAPTURE_BUSY;
    return arm_edge_capture(id, 0, owner, source, microphone);
  }
  for (int id = 0; id < edge_playback_count_; ++id) {
    auto& pair = edge_playback_pairs_[id];
    if (pair.button != button || pair.at < (start_ - 1) * beats_ || pair.at + 1 >= run_end_ * beats_) continue;
    const int slot = word_playback_slot(query_position_ - pair.at);
    if (slot < 0) continue;
    if (pair.fired[slot]) return PF_OK;
    if (!select(binding_[button], pair.selections[slot], false, PF_ONESHOT_MODE, true, true)) return PF_NO_SAMPLE;
    pair.fired[slot] = true;
    return PF_OK;
  }
  return -1;
}
int Program::release_input(uint64_t owner, uint64_t source, double frame, double bpm, bool microphone) noexcept {
  release_owner(owner);
  if (edge_capture_.pair < 0 || !owner || owner != edge_capture_.hold || source != edge_capture_.source) return PF_OK;
  bpm_ = bpm; query_position_ = position(frame, bpm); query_frame_ = frame;
  const auto& pair = edge_capture_pairs_[edge_capture_.pair];
  if (!microphone || phase_ != PF_PLAYING || query_position_ >= edge_deadline(pair)) { cancel_edge_capture(); return PF_OK; }
  const auto& cue = cues_[pair.arms[edge_capture_.step]];
  int bank = -1;
  const int ready = preflight_start(cue, nullptr, 0, bank);
  if (ready != PF_OK) { cancel_edge_capture(); return ready; }
  const int result = begin_capture(cue, bank, frame);
  if (result != PF_OK) { cancel_edge_capture(); return result; }
  edge_capture_.hold = 0;
  return PF_OK;
}
void Program::cancel_input(uint64_t source) noexcept {
  if (edge_capture_.source == source) cancel_edge_capture();
}
int Program::press_buttons(uint32_t rows, uint64_t owner, double frame, double bpm, bool microphone, bool report_rows, uint64_t source) noexcept {
  query_position_ = position(frame, bpm); query_frame_ = frame;
  int selected[PF_CHANNELS]{-1, -1, -1, -1}, result = PF_OK;
  bool recovering[PF_CHANNELS]{};
  auto admit = [&](int button, int cue = -1) {
    input_owner_[button] = owner; button_down_[button] = true;
    if (cue >= 0 && pending_[cue].cue >= 0) pending_[cue].owner = owner;
    bend_baseline_[button] = last_motion_frame_ >= 0 && frame - last_motion_frame_ <= rate_ * bend_stale_ms_ / 1000 ? motion_velocity_ : 0;
  };
  auto report = [&](int button, int cue, int code) {
    if (report_rows && outcome_) outcome_(outcome_context_, frame, button, cue, code);
    if (code != PF_OK && result == PF_OK) result = code;
  };
  for (int button = 0; button < PF_CHANNELS; ++button) if (rows & (1u << button)) {
    const int edge = edge_press(button, owner, source, frame, microphone);
    if (edge >= 0) { rows &= ~(1u << button); report(button, -1, edge); continue; }
    selected[button] = resolve(button, frame, bpm);
    if (selected[button] == -PF_CUE_LATE) {
      const int recovered = recoverable_playback(button, frame, bpm);
      if (recovered != -1) { selected[button] = recovered; recovering[button] = recovered >= 0; }
    }
  }
  for (int pass = 0; pass < 2; ++pass) for (int id = 0; id < cue_count_; ++id) {
    const Cue& cue = cues_[id]; int chosen = selected[cue.button];
    if (chosen < 0 || (chosen != id && (cue.group < 0 || cue.group != cues_[chosen].group))) continue;
    if (recovering[cue.button] && !cue.recoverable()) continue;
    bool commits = cue.kind == PF_COMMIT || cue.kind == PF_COMMIT_ARM;
    if (commits != (pass == 0)) continue;
    const bool fresh = !cue.used && pending_[id].cue != id;
    int code = press_selected(id, frame, bpm, microphone, recovering[cue.button]);
    if (fresh && code == PF_OK && cue.kind == PF_PLAY && (cue.mode == PF_HELD_MODE || cue.mode == PF_GATED_MODE)) admit(cue.button, id);
    report(cue.button, id, code);
  }
  for (int button = 0; button < PF_CHANNELS; ++button) if ((rows & (1u << button)) && selected[button] < 0) {
    if (selected[button] != -PF_CUE_LATE) {
      report(button, -1, -selected[button]);
      continue;
    }
    const bool gated = gated_[button] >= 0;
    int code = gated ? gate_press(button, frame, microphone) : play_note(button);
    if (gated && code == PF_OK) admit(button);
    if (!report_rows && !gated && code == PF_OK) for (int id = 0; id < cue_count_; ++id)
      if (cues_[id].button == button && !cues_[id].used && cues_[id].playback_intent() && !cues_[id].recoverable()
        && cue_on_current_bar(cues_[id])) { code = PF_CUE_LATE; break; }
    report(button, -1, code);
  }
  return result;
}
void Program::release_owner(uint64_t owner) noexcept {
  if (!owner) return;
  for (int id = 0; id < cue_count_; ++id) if (pending_[id].cue >= 0 && pending_[id].owner == owner) pending_[id] = {};
  for (int button = 0; button < PF_CHANNELS; ++button) if (input_owner_[button] == owner) release(button);
}
void Program::stop_selection(int selection, bool hard) noexcept {
  for (auto& launch : overlap_launch_) if (launch.selection == selection) launch = {};
  for (int member = 0; member < member_count_; ++member) if (members_[member].selection == selection) {
    for (auto& playback : takes_[members_[member].take].playback) {
      playback->set_semitones(0);
      if (hard) playback->reset(); else playback->stop();
    }
  }
}
void Program::release(int button) noexcept {
  if (button < 0 || button >= PF_CHANNELS) return;
  button_down_[button] = false; input_owner_[button] = 0;
  if (held_[button] >= 0) { stop_selection(cues_[held_[button]].selection); held_[button] = -1; }
  if (gated_[button] >= 0) {
    const Cue& cue = cues_[gated_[button]];
    if (cue.selection >= 0) stop_selection(cue.selection);

  }
  for (int id = 0; id < cue_count_; ++id) if (pending_[id].cue >= 0 && cues_[id].button == button
    && cues_[id].kind == PF_PLAY && (cues_[id].mode == PF_HELD_MODE || cues_[id].mode == PF_GATED_MODE)) pending_[id] = {};
}
int Program::gate_press(int button, double frame, bool) noexcept {
  if (gated_[button] < 0) return PF_OK;
  const Cue& cue = cues_[gated_[button]];
  if (cue.selection < 0) return PF_NO_SAMPLE;
  if (!select(cue.voice, cue.selection, false, PF_HELD_MODE, true)) return PF_NO_SAMPLE;
  for (int other = 0; other < PF_CHANNELS; ++other) if (other != button && held_[other] >= 0) release(other);
  held_[button] = gated_[button];
  query_frame_ = frame;
  return PF_OK;
}
int Program::press_selected(int found, double frame, double bpm, bool microphone, bool recovering) noexcept {
  int button = cues_[found].button;
  double now = position(frame, bpm);
  Cue& cue = cues_[found];
  if (cue.used || (pending_[found].cue == found && !pending_[found].automatic)) return PF_OK;
  for (int id = 0; id < cue_count_; ++id) if (pending_[id].cue >= 0 && !pending_[id].automatic && cues_[id].button == button && (cue.group < 0 || cues_[id].group != cue.group)) return PF_CAPTURE_BUSY;
  if (cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM) {
    if (captures_cancelled_) return PF_OK;
    if (!microphone) return PF_MICROPHONE_REQUIRED;
    if (cue.kind == PF_COMMIT_ARM && active_capture_.take != cue.commit) return PF_NO_RECORDING;
    if (!reservation_available(cue.take, button, cue.kind == PF_COMMIT_ARM ? cue.commit : -1)) return PF_CAPTURE_BUSY;
    if (available_bank(cue.take) < 0) return PF_TAKE_UNAVAILABLE;
  }
  if (cue.kind == PF_COMMIT && active_capture_.take != cue.commit) return PF_NO_RECORDING;
  if (cue.kind == PF_PLAY && cue.selection >= 0 && !selection_ready(cue.selection, cue.voice) && cue.group < 0) return PF_NO_SAMPLE;
  double target = now;
  if (cue.timing == 1) target = cue.bar * beats_;
  if (cue.timing == 2) target = (cue.bar - 1 + cue.bar_offset) * beats_ + cue.execute;
  if (cue.kind == PF_PLAY && cue.mode == PF_LOOP_MODE && cue.timing == 0 && cue.selection >= 0) {
    for (int member = 0; member < member_count_; ++member) if (members_[member].selection == cue.selection) {
      const Take& take = takes_[members_[member].take];
      const double measure = recovering ? cue.bar - 1 : std::floor(now / beats_);
      bool starts_intro = false;
      for (int window = 0; window < window_count_; ++window)
        if (selection_windows_[window].selection == cue.selection && selection_windows_[window].repeat_begin >= 0) starts_intro = true;
      if (starts_intro) break;
      double origin = measure * beats_ + take.begin - std::floor(take.begin / beats_) * beats_;
      if (cue.cue >= 0 && origin > (cue.bar - 1) * beats_ + cue.cue) origin -= beats_;
      if (origin > now) target = origin;
      break;
    }
  }
  if (target < now - epsilon) {
    if (!cue.recoverable()) return PF_CUE_LATE;
    target = now;
  }
  if (cue.kind == PF_ARM && target <= now + epsilon && active_capture_.take >= 0) return PF_CAPTURE_BUSY;
  if (cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM) {
    const Take& take = takes_[cue.take]; const Take& anchor = takes_[take.anchor];
    double maximum_source_frames = std::ceil((take.end - target) * rate_ * 60 / minimum_bpm);
    if (maximum_source_frames <= 0 || maximum_source_frames > take.capacity) return PF_LOOP_MISMATCH;
    if (take.anchor != cue.take && !(cue.kind == PF_COMMIT_ARM && cue.commit == take.anchor)) {
      if (anchor.latest < 0 || anchor.playback[anchor.latest]->state() != patches::PlaybackState::playing) return PF_LOOP_MISMATCH;
      double period = anchor.cache[anchor.latest]->period();
      double advance = std::max(0.0, boundary_frame(frame_at(target)) - frame);
      if (follows_changed_tempo(anchor, anchor.latest, bpm)) {
        const auto& clock = anchor.clock[anchor.latest];
        const double phase = clock.wrap(loop_phase(anchor, anchor.latest) + advance * bpm / (rate_ * 60));
        if (std::min(phase, clock.counts - phase) > 2 * bpm / (rate_ * 60)) return PF_LOOP_MISMATCH;
      } else {
        double phase = std::fmod(anchor.playback[anchor.latest]->phase() + advance, period);
        if (std::min(phase, period - phase) > 1) return PF_LOOP_MISMATCH;
      }
    }
  }
  if (cue.kind == PF_COMMIT_ARM && target <= now + epsilon) {
    CommitPlan plan; int bank = -1;
    int result = preflight_commit(cue, plan);
    if (result == PF_OK) result = preflight_start(cue, &cue, plan.period, bank);
    if (result != PF_OK) { if (plan.invalid_draft) discard_invalid_draft(cue); return result; }
  }
  if (cue.tempo_hint && !recovering && (!tempo_hit_ || tempo_hit_(tempo_context_, cue.tempo_hint) != PF_OK)) return PF_TEMPO_REJECTED;
  if (cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM) { switch_route(takes_[cue.take].profile); if (error_ != PF_OK) return error_; }
  if (target <= now + epsilon) {
    int result = execute(found, frame);
    if (result != PF_OK) { error_ = PF_OK; return result; }
  } else { pending_[found].cue = found; pending_[found].position = target; pending_[found].reserved_take = cue.take; pending_[found].automatic = false; }
  cue.used = true; return PF_OK;
}
bool Program::selections_overlap(int first, int second) const noexcept {
  for (int a = 0; a < member_count_; ++a) if (members_[a].selection == first)
    for (int b = 0; b < member_count_; ++b) if (members_[b].selection == second && members_[a].take == members_[b].take) return true;
  return false;
}
bool Program::selection_profiles_overlap(int first, int second) const noexcept {
  for (int member = 0; member < member_count_; ++member)
    if (members_[member].selection == first && selection_profile(second, takes_[members_[member].take].profile)) return true;
  return false;
}
bool Program::selection_profile(int selection, int profile) const noexcept {
  for (int member = 0; member < member_count_; ++member)
    if (members_[member].selection == selection && takes_[members_[member].take].profile == profile) return true;
  return false;
}
bool Program::selection_ready(int selection, int voice) const noexcept {
  for (int id = 0; id < window_count_; ++id) if (selection_windows_[id].selection == selection) {
    const auto& window = selection_windows_[id]; int bank = takes_[window.take].latest;
    if (bank < 0 || window.cut[bank] < 0 || (window.repeat_begin >= 0 && window.repeat_frame[bank] < 0)) return false;
  }
  bool found = false;
  for (int id = 0; id < member_count_; ++id) if (members_[id].selection == selection) {
    const Take& take = takes_[members_[id].take];
    if (take.voice != voice || take.latest < 0) return false;
    found = true;
  }
  return found;
}
bool Program::play_take(int id, double gain) noexcept {
  Take& take = takes_[id];
  if (take.latest < 0 || !take.playback[take.latest]->start(true)) return false;
  take.clock[take.latest] = {take.begin, take.loop_end - take.begin, 0, 0, take.cache[take.latest]->period(), false};
  take.playback_gain[take.latest] = take.gain * gain;
  return true;
}
void Program::stop_voice(int voice, bool hard) noexcept {
  overlap_launch_[voice] = {};
  for (int id = 0; id < take_count_; ++id) if (takes_[id].voice == voice) for (auto& playback : takes_[id].playback) {
    if (hard) playback->reset(); else playback->stop();
  }
}
bool Program::start_intro_loop(Take& take, const SelectionWindow& window, bool capture_handoff) noexcept {
  const int bank = take.latest;
  if (window.repeat_frame[bank] < 0 || window.cut[bank] <= window.repeat_frame[bank]
    || (window.overlap_final_eighth && window.finish[bank] <= window.repeat_frame[bank])) return false;
  const uint32_t pickup_end = window.overlap_final_eighth ? uint32_t(window.finish[bank]) : 0;
  return take.playback[bank]->start_intro_loop(uint32_t(window.repeat_frame[bank]), uint32_t(window.cut[bank]), capture_handoff, pickup_end);
}
bool Program::select(int voice, int selection, bool automatic, int mode, bool retrigger, bool additive) noexcept {
  if (!selection_ready(selection, voice)) return false;
  if (!automatic) overlap_launch_[voice] = {};
  if (automatic) for (int profile = 0; profile < PF_VOICE_PROFILES; ++profile) if (selection_profile(selection, profile) && suppressed_[profile]) return false;
  bool playing = false;
  for (int id = 0; id < take_count_; ++id) if (takes_[id].voice == voice && selection_profile(selection, takes_[id].profile)) for (const auto& playback : takes_[id].playback) if (playback->state() == patches::PlaybackState::playing) playing = true;
  if (automatic && !playing) { selection_[voice] = selection; return true; }
  for (int id = 0; id < take_count_; ++id) if (!additive && takes_[id].voice == voice && selection_profile(selection, takes_[id].profile)) {
    bool selected = false;
    for (int member = 0; member < member_count_; ++member) if (members_[member].selection == selection && members_[member].take == id) selected = true;
    if (!selected) for (auto& playback : takes_[id].playback) playback->stop();
  }
  for (int member = 0; member < member_count_; ++member) if (members_[member].selection == selection) {
    Take& take = takes_[members_[member].take];
    auto& player = take.playback[take.latest];
    auto& clock = take.clock[take.latest];
    const bool continuing = !retrigger && player->state() == patches::PlaybackState::playing;
    const bool continue_warp = continuing && clock.warped;
    const double prior_phase = continue_warp ? clock.phase : 0;
    const bool follow_grid = mode == PF_LOOP_MODE && !(automatic && continuing && clock.counts == 0);
    double first_count = take.begin, duration = take.loop_end - take.begin;
    uint32_t first_frame = 0, period = take.cache[take.latest]->period();
    SelectionWindow* view = nullptr;
    for (int window = 0; window < window_count_; ++window) if (selection_windows_[window].selection == selection) view = &selection_windows_[window];
    if (view && view->repeat_begin >= 0) {
      const int bank = take.latest;
      duration = view->end;
      period = uint32_t(view->cut[bank]);
      if (!continuing || take.active_selection != selection) {
        if (!start_intro_loop(take, *view, false)) return false;
      }
    } else if (view) {
      const int bank = take.latest;
      if (view->start[bank] < 0 || view->cut[bank] < view->start[bank]) return false;
      bool parent_period = view->begin == 0 && view->period == take.loop_end - take.begin;
      if (!parent_period && view->finish[bank] <= view->start[bank]) return false;
      first_count = take.begin + view->begin;
      duration = view->period;
      first_frame = uint32_t(view->start[bank]);
      period = parent_period ? take.cache[bank]->period()
        : uint32_t(view->finish[bank] - view->start[bank]);
      if (!retrigger && player->state() == patches::PlaybackState::playing) {
        if (!player->set_window(uint32_t(view->start[bank]), uint32_t(view->cut[bank]), period)) return false;
      } else if (!player->start_window(mode != PF_ONESHOT_MODE, uint32_t(view->start[bank]), uint32_t(view->cut[bank]), period, *view->initial[bank])) return false;
    } else {
      if ((retrigger || player->state() != patches::PlaybackState::playing) && !player->start(mode != PF_ONESHOT_MODE)) return false;
      player->set_window(0, take.cache[take.latest]->length(), take.cache[take.latest]->period());
      player->clear_source_end();
    }
    clock = follow_grid ? LoopClock{first_count, duration, 0, first_frame, period, continue_warp} : LoopClock{};
    if (view && view->repeat_begin >= 0) clock.repeat_begin = view->repeat_begin;
    if (continue_warp && follow_grid) clock.phase = clock.wrap(prior_phase);
    if (retrigger && follow_grid && (!view || view->repeat_begin < 0)) {
      const double counts = query_position_ - take.begin;
      if (follows_changed_tempo(take, take.latest, bpm_)) {
        clock.phase = clock.wrap(counts);
        clock.warped = true;
        const auto& grid = take.grid[take.latest];
        const double source_phase = grid.interpolate(clock.first_count + clock.phase, false, rate_ * 60 / grid.initial_bpm)
          - clock.first_frame;
        player->seek_phase(uint32_t(std::clamp(source_phase + epsilon, 0.0, double(clock.frames - 1))));
      } else {
        double phase = std::fmod(counts * take.cache[take.latest]->period() / (take.loop_end - take.begin), double(take.cache[take.latest]->period()));
        if (phase < 0) phase += take.cache[take.latest]->period();
        player->seek_phase(uint32_t(std::floor(phase)));
      }
    }
    take.active_selection = selection;
    take.playback_gain[take.latest] = take.gain * members_[member].gain;
  }
  selection_[voice] = selection; return true;
}
int Program::preflight_commit(const Cue& cue, CommitPlan& plan) const noexcept {
  if (active_capture_.take != cue.commit) return PF_NO_RECORDING;
  const Take& draft = takes_[cue.commit];
  if (draft.cache[active_capture_.bank]->state() != patches::TakeState::capturing) return PF_ACTION_FAILED;
  if (draft.edge_capture) {
    plan.period = draft.cache[active_capture_.bank]->length();
    plan.invalid_draft = !plan.period;
    return plan.invalid_draft ? PF_LOOP_MISMATCH : PF_OK;
  }
  if (!commit_period(cue.commit, plan.period)) { plan.invalid_draft = true; return PF_LOOP_MISMATCH; }
  double joined_phase = draft.cache[active_capture_.bank]->length() % plan.period;
  for (int id = 0; id < member_count_; ++id) if (members_[id].selection == cue.selection && members_[id].take != cue.commit) {
    const Take& member = takes_[members_[id].take];
    if (member.latest < 0 || member.cache[member.latest]->state() != patches::TakeState::committed) return PF_NO_SAMPLE;
    if (draft.grid[active_capture_.bank].tempo_changed ||
        std::abs(draft.grid[active_capture_.bank].initial_bpm - member.grid[member.latest].initial_bpm) > epsilon ||
        follows_changed_tempo(member, member.latest, bpm_)) {
      const double counts = draft.loop_end - draft.begin;
      const double expected = std::fmod(draft.end - draft.begin, counts);
      const double actual = member.playback[member.latest]->state() == patches::PlaybackState::playing ? loop_phase(member, member.latest) : 0;
      const double delta = std::abs(actual - expected);
      if (std::min(delta, counts - delta) > 2 * bpm_ / (rate_ * 60)) return PF_LOOP_MISMATCH;
    } else {
      if (member.cache[member.latest]->period() != plan.period) return PF_LOOP_MISMATCH;
      double phase = member.playback[member.latest]->state() == patches::PlaybackState::playing ? member.playback[member.latest]->phase() % plan.period : 0;
      double delta = std::abs(phase - joined_phase);
      if (std::min(delta, double(plan.period) - delta) > 1) return PF_LOOP_MISMATCH;
    }
  }
  return PF_OK;
}
int Program::preflight_start(const Cue& cue, const Cue* staged_commit, uint32_t staged_period, int& bank) const noexcept {
  if (active_capture_.take >= 0 && (!staged_commit || staged_commit->commit != active_capture_.take)) return PF_CAPTURE_BUSY;
  if (edge_capture_.pair >= 0 && edge_capture_pairs_[edge_capture_.pair].takes[edge_capture_.step] != cue.take) return PF_CAPTURE_BUSY;
  bank = available_bank(cue.take);
  if (bank < 0) return PF_TAKE_UNAVAILABLE;
  const Take& take = takes_[cue.take];
  if (take.anchor == cue.take) return PF_OK;
  const Take& anchor = takes_[take.anchor];
  uint32_t period;
  double phase;
  if (staged_commit && take.anchor == staged_commit->commit) {
    period = staged_period; phase = anchor.cache[active_capture_.bank]->length() % period;
  } else {
    if (anchor.latest < 0 || anchor.playback[anchor.latest]->state() != patches::PlaybackState::playing) return PF_LOOP_MISMATCH;
    period = anchor.cache[anchor.latest]->period(); phase = anchor.playback[anchor.latest]->phase() % period;
    if (follows_changed_tempo(anchor, anchor.latest, bpm_)) {
      const auto& clock = anchor.clock[anchor.latest];
      const double count = loop_phase(anchor, anchor.latest);
      return std::min(count, clock.counts - count) <= 2 * bpm_ / (rate_ * 60) ? PF_OK : PF_LOOP_MISMATCH;
    }
  }
  if (staged_commit && take.anchor == staged_commit->commit && anchor.grid[active_capture_.bank].tempo_changed)
    return anchor.end == anchor.loop_end ? PF_OK : PF_LOOP_MISMATCH;
  double expected = std::ceil((take.loop_end - take.begin) * rate_ * 60 / bpm_);
  if (std::abs(double(period) - expected) > 1 || std::min(phase, double(period) - phase) > 1) return PF_LOOP_MISMATCH;
  return PF_OK;
}
void Program::discard_invalid_draft(const Cue& cue) noexcept {
  if (active_capture_.take != cue.commit) return;
  takes_[cue.commit].cache[active_capture_.bank]->reset_for_capture(); active_capture_ = {};
  if (live_route_ == takes_[cue.commit].profile && !has_capture()) switch_route(-1);
}
int Program::finish_capture(const Cue& cue, const CommitPlan& plan, bool starts_next) noexcept {
  Take& take = takes_[active_capture_.take];
  take.grid[active_capture_.bank].add(take.edge_capture ? query_position_ : take.end, take.cache[active_capture_.bank]->length());
  if (!take.edge_capture) take.grid[active_capture_.bank].add(take.loop_end, plan.period);
  if (!take.cache[active_capture_.bank]->commit(plan.period)) return error_ = PF_ACTION_FAILED;
  if (cue.launch == PF_AUTOPLAY && take.latest >= 0) take.playback[take.latest]->stop();
  uint64_t completed_generation = active_capture_.generation;
  take.latest = active_capture_.bank; take.clock[take.latest] = {}; active_capture_ = {};
  SelectionWindow* committed_view = nullptr;
  for (int window = 0; window < window_count_; ++window) if (selection_windows_[window].selection == cue.selection) committed_view = &selection_windows_[window];
  const bool delayed_launch = cue.launch == PF_AUTOPLAY && committed_view && committed_view->overlap_final_eighth;
  const bool play_now = cue.launch == PF_AUTOPLAY && !delayed_launch;
  if (delayed_launch) overlap_launch_[cue.voice] = {cue.selection, take.end + beats_ - .5};
  if (play_now && committed_view && committed_view->repeat_begin >= 0) {
    if (!start_intro_loop(take, *committed_view, true)) return error_ = PF_ACTION_FAILED;
    take.active_selection = cue.selection;
  } else if (play_now && committed_view) {
    int bank = take.latest;
    if (committed_view->start[bank] < 0 || committed_view->cut[bank] <= committed_view->start[bank]
      || committed_view->finish[bank] <= committed_view->start[bank]
      || !take.playback[bank]->start_window_at_capture_end(true, uint32_t(committed_view->start[bank]), uint32_t(committed_view->cut[bank]),
        uint32_t(committed_view->finish[bank] - committed_view->start[bank]))) return error_ = PF_ACTION_FAILED;
  } else if (play_now) {
    auto& player = *take.playback[take.latest];
    const auto& recording = *take.cache[take.latest];
    bool started;
    if (cue.mode == PF_ONESHOT_MODE) started = player.start(false);
    // A full capture reaches the musical loop boundary even if its rounded
    // source length is one frame shorter than its rounded period.
    else if (take.end == take.loop_end) started = player.start_window_at_capture_end(true, 0, recording.length(), recording.period());
    else started = player.start_at_capture_end(true);
    if (!started) return error_ = PF_ACTION_FAILED;
  }
  if (play_now && cue.mode == PF_LOOP_MODE) {
    const int bank = take.latest;
    take.clock[bank] = {take.begin, take.loop_end - take.begin, 0, 0, take.cache[bank]->period(), false};
  }
  // Immediate playback takes over the capture rack tail. A delayed launch keeps the monitor tail audible.
  if (!delayed_launch && tail_generation_[take.profile] == completed_generation) { drain_[take.profile] = 0; tail_generation_[take.profile] = 0; }
  voices_[take.profile]->reset();
  if (play_now && cue.selection >= 0) {
    if (!select(cue.voice, cue.selection, false, cue.mode)) return error_ = PF_ACTION_FAILED;
  } else if (play_now && !play_take(cue.commit)) return error_ = PF_ACTION_FAILED;
  if (!starts_next && live_route_ == take.profile && !has_capture()) switch_route(-1, true);
  return PF_OK;
}
int Program::begin_capture(const Cue& cue, int bank, double frame) noexcept {
  Take& take = takes_[cue.take];
  if (cue.replacement_capture) overlap_launch_[take.voice] = {};
  if (cue.replacement_capture) for (int previous = 0; previous < take_count_; ++previous)
    if (takes_[previous].profile == take.profile && previous != cue.commit) for (auto& playback : takes_[previous].playback) playback->stop();
  if (!take.cache[bank]->reset_for_capture() || !take.cache[bank]->begin(*voices_[take.profile])) return error_ = PF_ACTION_FAILED;
  take.grid[bank].begin(position(frame, bpm_), bpm_);
  const Take& anchor = takes_[take.anchor];
  take.capture_start_phase = take.anchor != cue.take && anchor.latest >= 0 ? anchor.playback[anchor.latest]->phase() % anchor.cache[anchor.latest]->period() : 0;
  uint64_t generation = ++capture_generation_;
  if (live_route_ != take.profile && drain_[take.profile] && !detached_tail_[take.profile]) {
    if (!tails_[take.profile]->copy_state(*voices_[take.profile])) return error_ = PF_ACTION_FAILED;
    detached_tail_[take.profile] = true; tail_generation_[take.profile] = generation;
  }
  active_capture_ = {cue.take, bank, generation};
  switch_route(take.profile);
  for (int window = 0; window < window_count_; ++window) if (selection_windows_[window].take == cue.take) {
    selection_windows_[window].quality[bank] = 0; selection_windows_[window].scan_begin[bank] = 0;
    selection_windows_[window].start[bank] = selection_windows_[window].cut[bank] = selection_windows_[window].finish[bank] = selection_windows_[window].repeat_frame[bank] = -1;
  }
  observe_windows(frame);
  return PF_OK;
}
int Program::execute(int id, double frame) noexcept {
  observe_windows(frame);
  const Cue& cue = cues_[id];
  bool commits = cue.kind == PF_COMMIT || cue.kind == PF_COMMIT_ARM;
  bool starts = cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM;
  CommitPlan plan; int bank = -1;
  int result = commits ? preflight_commit(cue, plan) : PF_OK;
  if (result == PF_OK && starts) result = preflight_start(cue, commits ? &cue : nullptr, plan.period, bank);
  if (result != PF_OK) {
    if (plan.invalid_draft) discard_invalid_draft(cue);
    return result;
  }
  if (commits) {
    result = finish_capture(cue, plan, starts);
    if (result != PF_OK) return result;
  }
  if (starts) {
    result = begin_capture(cue, bank, frame);
    if (result != PF_OK) return result;
  }
  if (cue.kind == PF_STOP || (cue.kind == PF_PLAY && cue.mode == PF_LOOP_MODE)) {
    for (int button = 0; button < PF_CHANNELS; ++button) {
      int active = gated_[button] >= 0 ? gated_[button] : held_[button];
      if (active >= 0 && cues_[active].voice == cue.voice
        && (cue.selection < 0 || (cue.kind == PF_PLAY ? selection_profiles_overlap(cues_[active].selection, cue.selection) : selections_overlap(cues_[active].selection, cue.selection)))) {
        release(button); gated_[button] = held_[button] = -1;
      }
    }
  }
  if (cue.kind == PF_STOP) {
    if (cue.selection >= 0) stop_selection(cue.selection); else stop_voice(cue.voice, false);
    gated_[cue.button] = -1; held_[cue.button] = -1;

    for (int profile = 0; profile < PF_VOICE_PROFILES; ++profile) {
      bool bound = false;
      for (int take = 0; take < take_count_; ++take) if (takes_[take].voice == cue.voice && takes_[take].profile == profile) bound = true;
      if ((cue.selection >= 0 && selection_profile(cue.selection, profile)) || (cue.selection < 0 && bound)) suppressed_[profile] = true;
    }
  }
  if (cue.kind == PF_PLAY) {
    if (cue.mode == PF_GATED_MODE) {
      if (!selection_ready(cue.selection, cue.voice)) return error_ = PF_NO_SAMPLE;
      for (int take = 0; take < take_count_; ++take) if (selection_profile(cue.selection, takes_[take].profile))
        for (auto& playback : takes_[take].playback) playback->stop();
      gated_[cue.button] = id;
      int result = gate_press(cue.button, frame, true);
      if (result != PF_OK) return error_ = result;
    } else {
      gated_[cue.button] = -1;

      if (cue.selection >= 0) {
        if (!select(cue.voice, cue.selection, false, cue.mode, true)) return error_ = PF_NO_SAMPLE;
      } else return error_ = PF_NO_SAMPLE;
      if (cue.mode == PF_HELD_MODE) { for (int other = 0; other < PF_CHANNELS; ++other) if (other != cue.button && held_[other] >= 0) release(other); held_[cue.button] = id; }
    }
    for (int profile = 0; profile < PF_VOICE_PROFILES; ++profile) if (selection_profile(cue.selection, profile)) suppressed_[profile] = false;
  }
  return error_ = PF_OK;
}
void Program::observe_sustain(SelectionWindow& window) noexcept {
  if (window.take != active_capture_.take) return;
  int bank = active_capture_.bank; const auto& cache = takes_[window.take].cache[bank];
  const uint32_t stride = std::max(1u, uint32_t(rate_ / 8000)), span = uint32_t(std::ceil(rate_ * .08));
  uint32_t end = cache->length(), begin = window.scan_begin[bank];
  if (!end) { window.scan_initial[bank]->copy_state(*voices_[takes_[window.take].profile]); return; }
  if (end - begin < span) return;
  const uint32_t samples = (end - begin) / stride, count = std::min(256u, samples / 2);
  double mean = 0; for (uint32_t i = 0; i < count; ++i) mean += cache->source_sample(begin + i * stride).left;
  mean /= std::max(1u, count);
  double energy = 0; for (uint32_t i = 0; i < count; ++i) { double x = cache->source_sample(begin + i * stride).left - mean; energy += x * x; }
  double best = 1; uint32_t period = 0;
  const uint32_t minimum = std::max(2u, uint32_t(std::ceil(rate_ / stride / 1200)));
  const uint32_t maximum = std::min(samples - count, uint32_t(rate_ / stride / 50));
  if (energy > count * .00001) for (uint32_t lag = minimum; lag <= maximum; ++lag) {
    double difference = 0; for (uint32_t i = 0; i < count; ++i) {
      double a = cache->source_sample(begin + i * stride).left, b = cache->source_sample(begin + (i + lag) * stride).left;
      difference += (a - b) * (a - b);
    }
    double error = difference / (2 * energy);
    if (error < best) { best = error; period = lag * stride; }
  }
  double quality = energy / std::max(1u, count) * (1 - best);
  if (period && best < .15 && quality > window.quality[bank]) {
    uint32_t cycles = (end - begin) / period;
    if (cycles >= 2 && window.initial[bank]->copy_state(*window.scan_initial[bank])) {
      window.start[bank] = begin; window.cut[bank] = window.finish[bank] = begin + cycles * period; window.quality[bank] = quality;
    }
  }
  window.scan_begin[bank] = end;
  window.scan_initial[bank]->copy_state(*voices_[takes_[window.take].profile]);
}
void Program::observe_windows(double frame) noexcept {
  if (active_capture_.take < 0) return;
  for (int id = 0; id < window_count_; ++id) {
    auto& window = selection_windows_[id];
    if (window.automatic) { observe_sustain(window); continue; }
    if (window.take == active_capture_.take && window.repeat_begin >= 0 && window.repeat_frame[active_capture_.bank] < 0
      && frame >= boundary_frame(frame_at(takes_[window.take].begin + window.repeat_begin)))
      window.repeat_frame[active_capture_.bank] = takes_[window.take].cache[active_capture_.bank]->length();
    if (window.repeat_begin < 0 && window.take == active_capture_.take && window.start[active_capture_.bank] < 0
      && frame >= boundary_frame(frame_at(takes_[window.take].begin + window.begin))) {
      window.start[active_capture_.bank] = takes_[window.take].cache[active_capture_.bank]->length();
      if (!window.initial[active_capture_.bank]->copy_state(*voices_[takes_[window.take].profile])) error_ = PF_ACTION_FAILED;
    }
    if (window.take == active_capture_.take && window.cut[active_capture_.bank] < 0
      && frame >= boundary_frame(frame_at(takes_[window.take].begin + window.end)))
      window.cut[active_capture_.bank] = takes_[window.take].cache[active_capture_.bank]->length();
    if ((window.repeat_begin < 0 || window.overlap_final_eighth) && window.take == active_capture_.take && window.finish[active_capture_.bank] < 0
      && frame >= boundary_frame(frame_at(takes_[window.take].begin + (window.overlap_final_eighth ? window.repeat_begin + .5 : window.begin + window.period))))
      window.finish[active_capture_.bank] = takes_[window.take].cache[active_capture_.bank]->length();
  }
}
void Program::apply_pending(double frame, double bpm, bool live) noexcept {
  observe_windows(frame);
  remember_cues(frame, bpm);
  double now = position(frame, bpm);
  query_position_ = now; query_frame_ = frame;
  if (edge_capture_.pair >= 0) {
    const auto& pair = edge_capture_pairs_[edge_capture_.pair];
    const int take = pair.takes[edge_capture_.step];
    if (!live || now >= edge_deadline(pair) || (active_capture_.take == take
      && takes_[take].cache[active_capture_.bank]->length() >= takes_[take].capacity)) cancel_edge_capture();
  }
  Due* due = due_.get();
  for (int id = 0; id < cue_count_; ++id) due[id] = {};
  const Cue* staged_commit = nullptr; uint32_t staged_period = 0; bool failed_commit = false;
  for (int button = 0; button < cue_count_; ++button) {
    Cue& arm = cues_[button];
    const bool lead_in_without_count = arm.bar == 0 && arm.timing == 1 && start_ == 1 && bar_ == 1 && phase_ == PF_PLAYING
      && frame == boundary_frame(frame_at(0));
    if (live && !captures_cancelled_ && arm.kind == PF_ARM && !arm.edge_capture && !arm.used && pending_[button].cue < 0
      && (cue_on_current_bar(arm) || lead_in_without_count)) {
      const double admission = (arm.bar - 1) * beats_ + std::max(0., arm.cue);
      const double boundary = takes_[arm.take].begin;
      const bool pickup = arm.bar == 0 && arm.timing == 2;
      const bool can_arm = pickup ? phase_ == PF_COUNT_IN && frame <= boundary_frame(frame_at(boundary))
        : arm.bar == 0 || frame >= boundary_frame(frame_at(admission));
      if (can_arm && takes_[arm.take].end <= run_end_ * beats_)
        pending_[button] = {button, arm.take, boundary, 0, true};
    }
    if (pending_[button].cue < 0 || frame < boundary_frame(frame_at(pending_[button].position))) continue;
    const Cue& pending_cue = cues_[pending_[button].cue];
    if (pending_cue.kind == PF_PLAY && (pending_cue.mode == PF_HELD_MODE || pending_cue.mode == PF_GATED_MODE)
      && pending_[button].owner != input_owner_[pending_cue.button]) { pending_[button] = {}; continue; }
    Due& action = due[button]; action.cue = pending_[button].cue; action.owner = pending_[button].owner;
    const Cue& cue = cues_[action.cue];
    if (cue.kind != PF_COMMIT && cue.kind != PF_COMMIT_ARM) continue;
    action.result = preflight_commit(cue, action.commit);
    if (action.result == PF_OK && cue.kind == PF_COMMIT_ARM && takes_[cue.take].begin < run_end_ * beats_)
      action.result = preflight_start(cue, &cue, action.commit.period, action.bank);
    if (action.result == PF_OK) { staged_commit = &cue; staged_period = action.commit.period; }
    else failed_commit = true;
  }
  Due automatic;
  int automatic_start = PF_OK;
  bool chain_capture = false;
  if (active_capture_.take >= 0 && !takes_[active_capture_.take].edge_capture && frame >= boundary_frame(frame_at(takes_[active_capture_.take].end))
    && (!staged_commit || staged_commit->commit != active_capture_.take)) {
    automatic.cue = takes_[active_capture_.take].commit_cue;
    const Cue& cue = cues_[automatic.cue];
    automatic.result = preflight_commit(cue, automatic.commit);
    failed_commit = automatic.result != PF_OK;
    if (!failed_commit) {
      staged_commit = &cue; staged_period = automatic.commit.period;
      chain_capture = cue.kind == PF_COMMIT_ARM && takes_[cue.take].end <= run_end_ * beats_;
      if (chain_capture) automatic_start = preflight_start(cue, &cue, automatic.commit.period, automatic.bank);
    }
  }
  // Preflight incoming resources against the valid staged release, before it is
  // published. Independent failed starts do not roll back that valid commit.
  for (int button = 0; button < cue_count_; ++button) if (due[button].cue >= 0) {
    Due& action = due[button]; const Cue& cue = cues_[action.cue];
    if (cue.kind == PF_ARM) action.result = failed_commit ? PF_CAPTURE_BUSY : preflight_start(cue, staged_commit, staged_period, action.bank);
  }
  // All releases precede starts. A failed release never creates a vacant slot
  // that a dependent incoming cue may silently consume at this boundary.
  for (int pass = 0; pass < 2; ++pass) {
    if (pass == 1 && automatic.cue >= 0) {
      Cue& cue = cues_[automatic.cue];
      int result = automatic.result;
      if (result == PF_OK) {
        result = chain_capture && automatic_start == PF_OK
          ? execute(automatic.cue, frame) : finish_capture(cue, automatic.commit, false);
        if (result != PF_OK) { stop(); error_ = PF_ACTION_FAILED; return; }
        result = automatic_start;
      } else discard_invalid_draft(cue);
      cue.used = true;
      if (pending_[automatic.cue].cue == automatic.cue) pending_[automatic.cue] = {};
      error_ = PF_OK;
      if (result != PF_OK && outcome_) outcome_(outcome_context_, frame, cue.button, automatic.cue, result);
      else if (observer_) observer_(observer_context_, frame);
    }
    for (int button = 0; button < cue_count_; ++button) {
      Due& action = due[button]; if (action.cue < 0) continue;
      const Cue& cue = cues_[action.cue];
      bool commits = cue.kind == PF_COMMIT || cue.kind == PF_COMMIT_ARM;
      if (commits != (pass == 0)) continue;
      if (pending_[button].automatic) cues_[action.cue].used = true;
      pending_[button] = {};
      if (cue.kind == PF_PLAY && (cue.mode == PF_HELD_MODE || cue.mode == PF_GATED_MODE)
        && (!action.owner || action.owner != input_owner_[cue.button])) continue;
      int result = action.result;
      if (cue.kind == PF_ARM && failed_commit) result = PF_CAPTURE_BUSY;
      if (result == PF_OK) {
        result = cue.kind == PF_COMMIT_ARM && takes_[cue.take].begin >= run_end_ * beats_
          ? finish_capture(cue, action.commit, false) : execute(action.cue, frame);
      } else if (action.commit.invalid_draft && automatic.cue < 0) discard_invalid_draft(cue);
      if (result != PF_OK) {
        bool admission = result == PF_CAPTURE_BUSY || result == PF_TAKE_UNAVAILABLE || result == PF_NO_RECORDING || result == PF_NO_SAMPLE || result == PF_LOOP_MISMATCH;
        if (!admission) { stop(); error_ = PF_ACTION_FAILED; return; }
        if (commits && automatic.cue < 0) failed_commit = true;
        error_ = PF_OK;
        if (outcome_ && automatic.cue != action.cue) outcome_(outcome_context_, frame, cue.button, action.cue, result);
      } else if (observer_) observer_(observer_context_, frame);
    }
  }
  if (phase_ == PF_PLAYING) for (int voice = 0; voice < PF_CHANNELS; ++voice) {
    const auto launch = overlap_launch_[voice];
    if (launch.selection < 0 || launch.position >= run_end_ * beats_ || frame < boundary_frame(frame_at(launch.position))) continue;
    overlap_launch_[voice] = {};
    if (!select(voice, launch.selection, false)) { stop(); error_ = PF_ACTION_FAILED; return; }
    if (observer_) observer_(observer_context_, frame);
  }
}
void Program::beat(int phase, int bar, int beat, int count_remaining, double frame, double bpm, bool live) noexcept {
  remember_cues(frame, bpm);
  double next_position = (bar - 1) * beats_ + beat - 1;
  bool wrap = phase == PF_PLAYING && phase_ == PF_PLAYING && next_position + epsilon < anchor_position_;
  if (wrap) {
    cancel_edge_capture(); reset_edge_pairs();
    for (int id = 0; id < note_count_; ++id) notes_[id].played = false;
    rotation_deadline_frame_ = -1;
    apply_pending(boundary_frame(frame), bpm, live);
    captures_cancelled_ = false;
    if (active_capture_.take >= 0) {
      int cue = takes_[active_capture_.take].commit_cue;
      discard_invalid_draft(cues_[cue]);
      if (outcome_) outcome_(outcome_context_, boundary_frame(frame), cues_[cue].button, cue, PF_LOOP_MISMATCH);
    }
    for (int id = 0; id < cue_count_; ++id) pending_[id] = {};
    for (int id = 0; id < cue_count_; ++id) { cues_[id].used = false; cues_[id].announced = false; cues_[id].occurred_frame = std::numeric_limits<double>::quiet_NaN(); }
  }
  phase_ = phase; bar_ = phase == PF_COUNT_IN ? 0 : bar;
  bpm_ = bpm; anchor_frame_ = frame; anchor_position_ = phase == PF_COUNT_IN ? (start_ - 1) * beats_ - count_remaining : (bar - 1) * beats_ + beat - 1;
  query_position_ = anchor_position_;
  if (active_capture_.take >= 0) {
    auto& take = takes_[active_capture_.take];
    take.grid[active_capture_.bank].add(anchor_position_, take.cache[active_capture_.bank]->length());
  }
  apply_pending(boundary_frame(frame), bpm, live);
  if (phase == PF_PLAYING && beat == 1) for (int id = 0; id < playback_count_; ++id) if (playback_[id].bar == bar) select(playback_[id].voice, playback_[id].selection, true);
}
void Program::render(const float* input, float* left, float* right, float* live_left, float* live_right,
  uint32_t frames, double frame, double bpm, bool live, patches::Rack& default_rack, patches::Rack& backup_rack) noexcept {
  bpm_ = bpm;
  for (uint32_t offset = 0; offset < frames; ++offset) {
    apply_pending(frame + offset, bpm, live);
    float source = input && std::isfinite(input[offset]) ? input[offset] : 0;
    patches::Stereo current{}, monitor{};
    if (live && (phase_ == PF_COUNT_IN || phase_ == PF_PLAYING)) {
      int recording_voice = active_capture_.take >= 0 ? takes_[active_capture_.take].profile : -1;
      auto rack_for = [&](int profile) -> patches::Rack& { return profile == default_route ? default_rack : profile == backup_route ? backup_rack : *voices_[profile]; };
      int desired = rotation_remaining() > 0 ? backup_route : live_route_ < 0 ? default_route : live_route_;
      if (desired != monitor_route_) {
        int outgoing = monitor_route_;
        bool handed_off = outgoing < PF_VOICE_PROFILES && handed_off_[outgoing];
        if (!handed_off) {
          if (outgoing < PF_VOICE_PROFILES) {
            detached_tail_[outgoing] = recording_voice == outgoing;
            tail_generation_[outgoing] = detached_tail_[outgoing] ? active_capture_.generation : 0;
            if (detached_tail_[outgoing] && !tails_[outgoing]->copy_state(*voices_[outgoing])) { stop(); error_ = PF_ACTION_FAILED; break; }
          }
          drain_[outgoing] = rack_for(outgoing).maximum_tail_frames();
        }
        if (outgoing < PF_VOICE_PROFILES) handed_off_[outgoing] = false;
        monitor_route_ = desired; drain_[desired] = 0;
        if (desired < PF_VOICE_PROFILES) { detached_tail_[desired] = false; tail_generation_[desired] = 0; handed_off_[desired] = false; }
      }
      current = rack_for(desired).process({source, source}); monitor = current;
      patches::Stereo captured = current;
      if (recording_voice >= 0 && recording_voice != desired) captured = voices_[recording_voice]->process({source, source});
      for (int profile = 0; profile < route_count; ++profile) if (profile != desired && drain_[profile]) {
        patches::Rack& rack = profile < PF_VOICE_PROFILES && detached_tail_[profile] ? *tails_[profile] : rack_for(profile);
        patches::Stereo tail = rack.process({}); --drain_[profile]; monitor.left += tail.left; monitor.right += tail.right;
      }
      if (active_capture_.take >= 0) {
        auto& cache = takes_[active_capture_.take].cache[active_capture_.bank];
        if (!cache->append_processed(*voices_[recording_voice], &source, &source, &captured.left, &captured.right, 1)) { stop(); error_ = PF_ACTION_FAILED; }
      }
    }
    for (auto& voice : external_playback_) if (voice.slot >= 0) {
      const auto& sample = external_samples_[voice.slot];
      const auto& value = sample.pcm[voice.frame++];
      if (left) left[offset] += value.left;
      if (right) right[offset] += value.right;
      if (voice.frame >= sample.frames) voice = {};
    }
    if (live_left) live_left[offset] += monitor.left;
    if (live_right) live_right[offset] += monitor.right;
    for (int id = 0; id < take_count_; ++id) for (int bank = 0; bank < 2; ++bank) {
      auto& take = takes_[id];
      auto& player = *take.playback[bank];
      if (player.state() == patches::PlaybackState::idle) continue;
      auto& clock = take.clock[bank];
      patches::Stereo value;
      if (player.state() == patches::PlaybackState::playing && follows_changed_tempo(take, bank, bpm)) {
        if (!clock.warped) {
          clock.phase = loop_phase(take, bank);
          clock.warped = true;
        }
        const auto& grid = take.grid[bank];
        const double phase = grid.interpolate(clock.first_count + clock.phase, false, rate_ * 60 / grid.initial_bpm) - clock.first_frame;
        value = player.next_warped(std::clamp(phase, 0.0, std::nextafter(double(clock.frames), 0.0)), uint32_t(std::ceil(rate_ * .024)));
        clock.phase += bpm / (rate_ * 60);
        if (clock.phase + epsilon >= clock.counts) clock.phase = clock.wrap(clock.phase);
      } else value = player.next();
      const int voice = take.voice;
      double gain = take.playback_gain[bank] * (muted_[voice] ? 0 : gain_[voice]);
      if (left) left[offset] += float(value.left * gain);
      if (right) right[offset] += float(value.right * gain);
    }
  }
  query_position_ = position(frame + frames, bpm); query_frame_ = frame + frames;
}
bool Program::prepare_tuning_bank(uint32_t profile, const double* slots, uint32_t count, uint32_t clip_frames,
  uint32_t stable_frames, double confidence, double tolerance_cents) noexcept {
  if (phase_ != PF_IDLE || has_capture() || profile >= PF_VOICE_PROFILES || !slots || !count || count > 13
    || !clip_frames || clip_frames > rate_ * 2 || !stable_frames || stable_frames > rate_ * 2
    || !std::isfinite(confidence) || confidence < 0 || confidence > 1
    || !std::isfinite(tolerance_cents) || tolerance_cents <= 0 || tolerance_cents > 100) return false;
  bool selected[64]{};
  for (uint32_t id = 0; id < count; ++id) {
    if (!whole(slots[id], 63) || selected[uint32_t(slots[id])]) return false;
    for (int window = 0; window < external_count_; ++window) if (external_windows_[window].slot == uint32_t(slots[id])) return false;
    selected[uint32_t(slots[id])] = true;
  }
  uint64_t total = uint64_t(clip_frames) * count;
  for (uint32_t id = 0; id < 64; ++id) if (!selected[id]) total += external_samples_[id].capacity;
  if (total * sizeof(patches::Stereo) > 64ULL * 1024 * 1024) return false;
  std::unique_ptr<patches::Stereo[]> prepared[13];
  auto scratch = std::unique_ptr<patches::Stereo[]>(new (std::nothrow) patches::Stereo[clip_frames]);
  if (!scratch) return false;
  for (uint32_t id = 0; id < count; ++id) {
    prepared[id].reset(new (std::nothrow) patches::Stereo[clip_frames]);
    if (!prepared[id]) return false;
  }
  for (uint32_t id = 0; id < count; ++id) {
    note_capture_slots_[id] = uint32_t(slots[id]);
    auto& sample = external_samples_[note_capture_slots_[id]];
    sample.pcm = std::move(prepared[id]); sample.frames = 0; sample.capacity = clip_frames; sample.midi = -1;
  }
  note_capture_scratch_ = std::move(scratch); note_capture_count_ = count; note_capture_step_ = 0;
  note_capture_profile_ = profile; note_capture_frames_ = clip_frames; note_capture_minimum_ = stable_frames;
  note_capture_confidence_ = confidence; note_capture_tolerance_ = tolerance_cents;
  pause_tuning_bank(); voices_[profile]->reset();
  return true;
}
void Program::pause_tuning_bank() noexcept {
  note_capture_listening_ = false; note_capture_filled_ = note_capture_write_ = note_capture_stable_ = 0;
  clear_gesture();
}
void Program::process_tuning_bank(const float* input, uint32_t frames, bool eligible, double confidence,
  double pitch_midi, double target_midi, uint32_t step) noexcept {
  if (!note_capture_count_ || note_capture_step_ >= note_capture_count_) return;
  bool stable = phase_ == PF_IDLE && input && eligible && step == note_capture_step_
    && confidence >= note_capture_confidence_ && std::abs(pitch_midi - target_midi) * 100 <= note_capture_tolerance_;
  if (!stable) { pause_tuning_bank(); return; }
  note_capture_listening_ = true;
  auto& sample = external_samples_[note_capture_slots_[note_capture_step_]];
  for (uint32_t frame = 0; frame < frames; ++frame) {
    float source = std::isfinite(input[frame]) ? input[frame] : 0;
    sample.pcm[note_capture_write_] = voices_[note_capture_profile_]->process({source, source});
    note_capture_write_ = (note_capture_write_ + 1) % note_capture_frames_;
    if (note_capture_filled_ < note_capture_frames_) ++note_capture_filled_;
    if (note_capture_stable_ < note_capture_minimum_) ++note_capture_stable_;
  }
}
bool Program::tuning_bank_ready(uint32_t step) const noexcept {
  return phase_ == PF_IDLE && step == note_capture_step_ && step < note_capture_count_ && note_capture_listening_
    && note_capture_filled_ == note_capture_frames_ && note_capture_stable_ >= note_capture_minimum_;
}
bool Program::lock_tuning_note(uint32_t step, double midi) noexcept {
  if (!tuning_bank_ready(step)) return false;
  auto& sample = external_samples_[note_capture_slots_[step]];
  for (uint32_t frame = 0; frame < note_capture_frames_; ++frame)
    note_capture_scratch_[frame] = sample.pcm[(note_capture_write_ + frame) % note_capture_frames_];
  std::copy(note_capture_scratch_.get(), note_capture_scratch_.get() + note_capture_frames_, sample.pcm.get());
  sample.frames = note_capture_frames_; sample.midi = midi; ++note_capture_step_;
  pause_tuning_bank(); voices_[note_capture_profile_]->reset();
  return true;
}
bool Program::tuning_motion(double value, double frame, bool require_reversal) noexcept {
  if (!value || !tuning_bank_ready(note_capture_step_)) return false;
  query_frame_ = frame; query_position_ = position(frame, bpm_);
  if (!require_reversal) return meaningful_motion(value, frame) && value > 0;
  if (!tuning_turn_armed_ && value < 0) {
    clear_gesture();
    return false;
  }
  if (!meaningful_motion(value, frame)) return false;
  if (value < 0) return tuning_turn_armed_;
  tuning_turn_armed_ = true;
  return false;
}
void Program::discard_tuning_bank() noexcept {
  for (uint32_t id = 0; id < note_capture_count_; ++id) {
    auto& sample = external_samples_[note_capture_slots_[id]];
    sample.frames = 0;
    sample.midi = -1;
  }
  cancel_tuning_bank();
}
void Program::tuning_bank_info(double* out) const noexcept {
  if (!out) return;
  out[0] = note_capture_count_; out[1] = note_capture_step_; out[2] = note_capture_frames_;
  out[3] = note_capture_filled_; out[4] = note_capture_stable_; out[5] = tuning_bank_ready(note_capture_step_);
  for (uint32_t id = 0; id < 13; ++id) {
    out[6 + id] = id < note_capture_count_ ? external_samples_[note_capture_slots_[id]].frames : 0;
    out[19 + id] = id < note_capture_count_ ? external_samples_[note_capture_slots_[id]].midi : -1;
  }
}
bool Program::set_bend_parameters(double velocity_per_semitone, double stale_ms) noexcept {
  if (phase_ != PF_IDLE || !std::isfinite(velocity_per_semitone) || velocity_per_semitone <= 0
    || !std::isfinite(stale_ms) || stale_ms <= 0 || stale_ms > 1000) return false;
  bend_velocity_per_semitone_ = velocity_per_semitone; bend_stale_ms_ = stale_ms;
  return true;
}
int Program::play_note(int button) noexcept {
  if (phase_ != PF_PLAYING) return PF_OK;
  for (int id = 0; id < note_count_; ++id) {
    auto& note = notes_[id]; if (note.button != button || note.played) continue;
    double tolerance = note.tolerance * bpm_ / 60000;
    if (note.at + tolerance < query_position_) { note.played = true; continue; }
    if (note.at - tolerance > query_position_) return PF_OK;
    int result = launch_external(note.slot);
    if (result == PF_OK) note.played = true;
    return result;
  }
  return PF_OK;
}
bool Program::prepare_external_sample(uint32_t slot, const float* left, const float* right, uint32_t frames) noexcept {
  if (phase_ != PF_IDLE || slot >= 64 || !left || !frames || frames > rate_ * 30) return false;
  if (note_capture_step_ < note_capture_count_) for (uint32_t id = 0; id < note_capture_count_; ++id) if (note_capture_slots_[id] == slot) return false;
  uint64_t total = frames;
  for (uint32_t id = 0; id < 64; ++id) if (id != slot) total += external_samples_[id].capacity;
  if (total * sizeof(patches::Stereo) > 64ULL * 1024 * 1024) return false;
  for (uint32_t frame = 0; frame < frames; ++frame) if (!std::isfinite(left[frame]) || (right && !std::isfinite(right[frame]))) return false;
  auto prepared = std::unique_ptr<patches::Stereo[]>(new (std::nothrow) patches::Stereo[frames]);
  if (!prepared) return false;
  for (uint32_t frame = 0; frame < frames; ++frame) prepared[frame] = {left[frame], right ? right[frame] : left[frame]};
  external_samples_[slot].pcm = std::move(prepared); external_samples_[slot].frames = frames; external_samples_[slot].capacity = frames;
  return true;
}
int Program::trigger_external(uint32_t slot) noexcept {
  if (slot >= 64 || phase_ != PF_PLAYING) return PF_CUE_LATE;
  bool eligible = false;
  for (int id = 0; id < external_count_; ++id) {
    const auto& window = external_windows_[id];
    if (window.slot == slot && query_position_ >= window.begin && query_position_ < window.end) eligible = true;
  }
  if (!eligible) return PF_CUE_LATE;
  return launch_external(slot);
}
int Program::audition_external(uint32_t slot) noexcept {
  for (int id = 0; id < external_count_; ++id)
    if (external_windows_[id].slot == slot) return launch_external(slot, true);
  return PF_NO_SAMPLE;
}
void Program::end_external_audition() noexcept {
  for (auto& voice : external_playback_) if (voice.audition) voice = {};
}
bool Program::external_audition_active() const noexcept {
  for (const auto& voice : external_playback_) if (voice.audition) return true;
  return false;
}
int Program::launch_external(uint32_t slot, bool audition) noexcept {
  if (!external_samples_[slot].pcm || !external_samples_[slot].frames) return PF_NO_SAMPLE;
  for (auto& voice : external_playback_) if (voice.slot < 0) { voice = {int(slot), 0, audition}; return PF_OK; }
  return PF_TAKE_UNAVAILABLE;
}
void Program::set_channel(int button, double gain, bool muted) noexcept {
  if (button < 0 || button >= PF_CHANNELS) return;
  int voice = binding_[button]; gain_[voice] = gain; muted_[voice] = muted;
}
VoiceInfo Program::channel_info(int button, double bpm) const noexcept {
  VoiceInfo info; if (button < 0 || button >= PF_CHANNELS) return info;
  int voice = binding_[button];
  info.gain = gain_[voice]; info.muted = muted_[voice];
  for (int id = 0; id < take_count_; ++id) if (takes_[id].voice == voice) {
    info.ready = info.ready || takes_[id].latest >= 0;
    for (const auto& playback : takes_[id].playback) {
      info.looping = info.looping || playback->state() == patches::PlaybackState::playing;
      info.release_ms = std::max(info.release_ms, playback->release_remaining_frames() * 1000.0 / rate_);
    }
  }
  info.status = info.looping ? PF_LOOPING : info.release_ms > 0 ? PF_STOPPING : info.ready ? PF_READY : PF_EMPTY;
  if (active_capture_.take >= 0 && takes_[active_capture_.take].voice == voice) info.status = PF_RECORDING;
  if (edge_capture_.pair >= 0 && edge_capture_.hold && edge_capture_pairs_[edge_capture_.pair].button == button) {
    info.pending = PF_ARM; info.status = PF_ARMED;
  }
  for (int id = 0; id < cue_count_; ++id) if (cues_[id].button == button && pending_[id].cue >= 0) {
    info.pending = cues_[id].kind;
    if (info.pending == PF_ARM || info.pending == PF_COMMIT_ARM) info.status = PF_ARMED;
    if (info.pending == PF_STOP) {
      info.status = PF_STOPPING;
      if (info.looping) {
        double stop_frame = boundary_frame(anchor_frame_ + (pending_[id].position - anchor_position_) * rate_ * 60 / bpm);
        info.release_ms = std::max(info.release_ms, std::max(0.0, stop_frame - query_frame_) * 1000 / rate_);
      }
    }
  }
  info.light = info.looping || info.status == PF_RECORDING || info.status == PF_ARMED ? PF_STEADY : PF_OFF;
  if (info.release_ms > 0 && info.status == PF_STOPPING) info.light = PF_RELEASING;
  if (info.light == PF_OFF && (phase_ == PF_COUNT_IN || phase_ == PF_PLAYING)) for (int id = 0; id < cue_count_; ++id) {
    const Cue& cue = cues_[id];
    if (cue.button != button || cue.used) continue;
    double delta = query_frame_ - cue_frame(cue, bpm);
    const double word_offset = query_position_ - ((cue.bar - 1) * beats_ + cue.cue);
    const bool timed = cue.word_window ? phase_ == PF_PLAYING && std::abs(word_offset) <= edge_playback_tolerance + epsilon
      : delta >= -early_ * rate_ / 1000 && delta <= late_ * rate_ / 1000;
    if ((cue.cue < 0 && cue_on_current_bar(cue)) || (cue.cue >= 0 && timed)) { info.light = PF_CUE; break; }
  }
  if (info.light == PF_OFF && phase_ == PF_PLAYING) for (int id = 0; id < edge_playback_count_; ++id) {
    const auto& pair = edge_playback_pairs_[id];
    const int slot = word_playback_slot(query_position_ - pair.at);
    if (pair.button == button && slot >= 0 && !pair.fired[slot]
      && pair.at >= (start_ - 1) * beats_ && pair.at + 1 < run_end_ * beats_) {
      info.light = PF_CUE; break;
    }
  }
  return info;
}
int Program::copy_take_audio(uint32_t id, uint32_t offset, uint32_t frames, float* stereo) const noexcept {
  if (!stereo || !frames || frames > 4096 || id >= uint32_t(take_count_) || active_capture_.take == int(id)) return -1;
  const Take& take = takes_[id];
  if (take.latest < 0) return -1;
  const auto& cache = *take.cache[take.latest];
  if (offset > cache.length() || frames > cache.length() - offset) return -1;
  for (uint32_t i = 0; i < frames; ++i) {
    const auto sample = cache.sample(offset + i);
    stereo[i * 2] = sample.left; stereo[i * 2 + 1] = sample.right;
  }
  return int(frames);
}
void Program::take_info(uint32_t id, double* out) const noexcept {
  if (!out) return;
  std::fill(out, out + PF_TAKE_FIELDS, 0);
  out[PF_TAKE_SOURCE_END] = out[PF_TAKE_SELECTION] = -1;
  if (id >= uint32_t(take_count_)) return;
  const Take& take = takes_[id]; int bank = active_capture_.take == int(id) ? active_capture_.bank : take.latest >= 0 ? take.latest : 0;
  out[PF_TAKE_VOICE] = take.voice; out[PF_TAKE_READY] = take.latest >= 0;
  out[PF_TAKE_PERIOD] = take.cache[bank]->period();
  out[PF_TAKE_LENGTH] = take.cache[bank]->length(); out[PF_TAKE_CAPACITY] = take.capacity;
  out[PF_TAKE_REVISION] = double(take.cache[bank]->revision());
  out[PF_TAKE_SOURCE_END] = take.playback[bank]->source_end();
  out[PF_TAKE_PHASE] = take.playback[bank]->phase(); out[PF_TAKE_PLAYBACK_STATE] = int(take.playback[bank]->state());
  if (take.playback[bank]->state() == patches::PlaybackState::playing) {
    const int selected = take.active_selection;
    for (int member = 0; member < member_count_; ++member)
      if (members_[member].selection == selected && members_[member].take == int(id)) {
        out[PF_TAKE_SELECTION] = selected; break;
      }
  }
}
}
