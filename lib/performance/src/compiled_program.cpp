#include "compiled_program.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <new>

namespace compiled {
namespace {
constexpr double epsilon = 1e-8;
constexpr double minimum_bpm = 40, maximum_bpm = 240;
bool whole(double value, double maximum) { return std::isfinite(value) && value >= 0 && value <= maximum && std::floor(value) == value; }
bool index(double value, int count, bool optional = false) { return (optional && value == -1) || whole(value, count - 1); }
bool point(double value, int beats) { return std::isfinite(value) && value >= 0 && value < beats && std::floor(value * 960) == value * 960; }
double cue_boundary(int bar, double cue, int timing, double execute, int beats) {
  if (timing == 1) return bar * beats;
  return (std::max(1, bar) - 1) * beats + (timing == 2 ? execute : std::max(0.0, cue));
}
}
struct Program::Take {
  int voice = 0, latest = -1, anchor = -1, commit_cue = -1;
  double begin = 0, end = 0, loop_end = 0, gain = 1;
  double capture_start_phase = 0;
  uint32_t capacity = 0;
  double playback_gain[2]{1, 1};
  std::unique_ptr<patches::ProcessedTake> cache[2];
  std::unique_ptr<patches::Playback> playback[2];
};
struct Program::Cue {
  int button = 0, voice = 0, bar = 0, kind = PF_NONE, timing = 0, take = -1, commit = -1, selection = -1;
  double cue = -1, execute = 0, occurred_frame = std::numeric_limits<double>::quiet_NaN();
  int tempo_hint = 0;
  bool used = false;
};
struct Program::Member { int selection = 0, take = 0; double gain = 1; };
struct Program::PlaybackCue { int bar = 1, voice = 0, selection = 0; };
struct Program::Pending { int cue = -1, reserved_take = -1; double position = 0; };

Program::~Program() = default;
std::unique_ptr<Program> Program::create(const double* data, uint32_t fields, double rate, const patches::Rack& definition, uint32_t revision) noexcept {
  const patches::Rack* definitions[PF_CHANNELS]; uint32_t revisions[PF_CHANNELS];
  for (int voice = 0; voice < PF_CHANNELS; ++voice) { definitions[voice] = &definition; revisions[voice] = revision; }
  return create(data, fields, rate, definitions, revisions);
}
std::unique_ptr<Program> Program::create(const double* data, uint32_t fields, double rate, const patches::Rack* const* definitions, const uint32_t* revisions) noexcept {
  if (!data || fields < PF_COMPILED_HEADER_FIELDS || data[0] != PF_COMPILED_MAGIC || data[1] != PF_COMPILED_VERSION
    || !whole(data[2], 6) || (data[2] != 4 && data[2] != 6) || !whole(data[3], PF_MAX_BARS) || data[3] < 1
    || !std::isfinite(data[4]) || data[4] < minimum_bpm || data[4] > maximum_bpm || !whole(data[5], data[3]) || data[5] < 1
    || !std::isfinite(data[6]) || data[6] < 0 || data[6] > 100 || !std::isfinite(data[7]) || data[7] < 0 || data[7] > 100
    || !whole(data[8], PF_COMPILED_MAX_TAKES) || !whole(data[9], PF_MAX_EVENTS) || !whole(data[10], PF_MAX_EVENTS) || !whole(data[11], PF_MAX_EVENTS)) return nullptr;
  uint64_t needed = PF_COMPILED_HEADER_FIELDS + uint64_t(data[8]) * PF_COMPILED_TAKE_FIELDS + uint64_t(data[9]) * PF_COMPILED_CUE_FIELDS
    + uint64_t(data[10]) * PF_COMPILED_MEMBER_FIELDS + uint64_t(data[11]) * PF_COMPILED_PLAYBACK_FIELDS;
  if (needed > fields) return nullptr;
  int rotation_count = 0, window_count = 0; double rotation_grid = .25;
  uint64_t rotation_offset = 0, window_offset = 0, cursor = needed;
  while (cursor < fields) {
    if (data[cursor] == PF_COMPILED_ROTATION_MAGIC) {
      if (rotation_offset || window_offset || fields - cursor < PF_COMPILED_ROTATION_HEADER_FIELDS
        || !whole(data[cursor + 1], PF_MAX_EVENTS) || !whole(data[cursor + 2] * 960, 960) || data[cursor + 2] <= 0) return nullptr;
      rotation_offset = cursor; rotation_count = int(data[cursor + 1]); rotation_grid = data[cursor + 2];
      cursor += PF_COMPILED_ROTATION_HEADER_FIELDS + uint64_t(rotation_count) * PF_COMPILED_ROTATION_FIELDS;
    } else if (data[cursor] == PF_COMPILED_WINDOW_MAGIC) {
      if (window_offset || fields - cursor < PF_COMPILED_WINDOW_HEADER_FIELDS || !whole(data[cursor + 1], PF_MAX_EVENTS)) return nullptr;
      window_offset = cursor; window_count = int(data[cursor + 1]);
      cursor += PF_COMPILED_WINDOW_HEADER_FIELDS + uint64_t(window_count) * PF_COMPILED_WINDOW_FIELDS;
    } else return nullptr;
    if (cursor > fields) return nullptr;
  }
  for (int button = 0; button < PF_CHANNELS; ++button) {
    if (!index(data[12 + button], PF_CHANNELS)) return nullptr;
    for (int previous = 0; previous < button; ++previous) if (data[12 + previous] == data[12 + button]) return nullptr;
  }
  auto program = std::unique_ptr<Program>(new (std::nothrow) Program);
  if (!program) return nullptr;
  program->fields_ = fields; program->rate_ = rate; program->beats_ = int(data[2]); program->bars_ = int(data[3]); program->bpm_ = data[4]; program->end_ = int(data[5]);
  program->early_ = data[6]; program->late_ = data[7]; program->take_count_ = int(data[8]); program->cue_count_ = int(data[9]);
  program->member_count_ = int(data[10]); program->playback_count_ = int(data[11]);
  for (int button = 0; button < PF_CHANNELS; ++button) program->binding_[button] = int(data[12 + button]);
  program->rotation_count_ = rotation_count; program->rotation_grid_ = rotation_grid;
  program->rotation_windows_.reset(new (std::nothrow) RotationWindow[rotation_count]);
  if (!program->rotation_windows_) return nullptr;
  for (int id = 0; id < rotation_count; ++id) {
    const double* row = data + rotation_offset + PF_COMPILED_ROTATION_HEADER_FIELDS + id * PF_COMPILED_ROTATION_FIELDS;
    if (!whole(row[0], program->bars_) || row[0] < 1 || !point(row[1], program->beats_)
      || !whole(row[2], program->bars_ + 1) || row[2] < 1 || !point(row[3], program->beats_) || (row[2] == program->bars_ + 1 && row[3] != 0)) return nullptr;
    auto& window = program->rotation_windows_[id]; window.begin = (row[0] - 1) * program->beats_ + row[1]; window.end = (row[2] - 1) * program->beats_ + row[3];
    if (window.end <= window.begin || (id && window.begin < program->rotation_windows_[id - 1].end)) return nullptr;
  }
  program->table_.reset(new (std::nothrow) double[fields]);
  program->takes_.reset(new (std::nothrow) Take[program->take_count_]); program->cues_.reset(new (std::nothrow) Cue[program->cue_count_]);
  program->members_.reset(new (std::nothrow) Member[program->member_count_]); program->playback_.reset(new (std::nothrow) PlaybackCue[program->playback_count_]);
  program->pending_.reset(new (std::nothrow) Pending[PF_CHANNELS]);
  if (!program->table_ || !program->takes_ || !program->cues_ || !program->members_ || !program->playback_ || !program->pending_) return nullptr;
  std::copy(data, data + fields, program->table_.get());
  uint32_t offset = PF_COMPILED_HEADER_FIELDS;
  uint64_t pcm_bytes = 0;
  for (int id = 0; id < program->take_count_; ++id, offset += PF_COMPILED_TAKE_FIELDS) {
    const double* row = data + offset;
    if (!index(row[0], PF_CHANNELS) || !whole(row[1], program->bars_) || row[1] < 1 || !point(row[2], program->beats_)
      || !whole(row[3], program->bars_ + 1) || row[3] < 1 || !point(row[4], program->beats_) || (row[3] == program->bars_ + 1 && row[4] != 0) || !std::isfinite(row[5]) || row[5] < 0 || row[5] > 4
      || !whole(row[6], program->bars_ + 1) || row[6] < 1 || !point(row[7], program->beats_) || (row[6] == program->bars_ + 1 && row[7] != 0)
      || !index(row[8], program->take_count_)) return nullptr;
    Take& take = program->takes_[id]; take.voice = int(row[0]); take.begin = (row[1] - 1) * program->beats_ + row[2]; take.end = (row[3] - 1) * program->beats_ + row[4]; take.gain = row[5]; take.loop_end = (row[6] - 1) * program->beats_ + row[7]; take.anchor = int(row[8]);
    if (take.loop_end < take.end || std::ceil((take.loop_end - take.begin) * rate * 60 / minimum_bpm) > std::numeric_limits<uint32_t>::max()) return nullptr;
    double capacity = std::ceil((take.end - take.begin) * rate * 60 / minimum_bpm);
    if (capacity < 1 || capacity > std::numeric_limits<uint32_t>::max()) return nullptr;
    take.capacity = uint32_t(capacity); pcm_bytes += uint64_t(take.capacity) * (sizeof(patches::Stereo) + sizeof(float)) * 2;
  }
  for (int id = 0; id < program->take_count_; ++id) {
    const Take& take = program->takes_[id]; const Take& anchor = program->takes_[take.anchor];
    int64_t period = std::llround(take.loop_end * 960) - std::llround(take.begin * 960);
    if (period <= 0 || anchor.anchor != take.anchor || anchor.voice != take.voice
      || period != std::llround(anchor.loop_end * 960) - std::llround(anchor.begin * 960) || (take.anchor != id && (take.anchor > id || anchor.end > take.begin))
      || (std::llround(take.begin * 960) - std::llround(anchor.begin * 960)) % period != 0) return nullptr;
  }
  for (int id = 0; id < program->take_count_; ++id) for (int previous = 0; previous < id; ++previous) {
    const Take& a = program->takes_[id]; const Take& b = program->takes_[previous];
    if (a.begin < b.end && b.begin < a.end) return nullptr;
  }
  for (int id = 0; id < program->cue_count_; ++id, offset += PF_COMPILED_CUE_FIELDS) {
    const double* row = data + offset;
    if (!index(row[0], PF_CHANNELS) || !index(row[1], PF_CHANNELS) || !whole(row[2], program->bars_)
      || !(row[3] == -1 || point(row[3], program->beats_)) || !whole(row[4], PF_PLAY) || row[4] < PF_ARM
      || !whole(row[5], 2) || !point(row[6], program->beats_) || !index(row[7], program->take_count_, true) || !index(row[8], program->take_count_, true)
      || !whole(row[9] + 1, PF_MAX_EVENTS) || !whole(row[10], 1)) return nullptr;
    Cue& cue = program->cues_[id]; cue.button = int(row[0]); cue.voice = int(row[1]); cue.bar = int(row[2]); cue.cue = row[3]; cue.kind = int(row[4]);
    cue.timing = int(row[5]); cue.execute = row[6]; cue.take = int(row[7]); cue.commit = int(row[8]); cue.selection = int(row[9]); cue.tempo_hint = int(row[10]);
    if (cue.tempo_hint && (cue.kind != PF_PLAY || cue.timing != 0)) return nullptr;
    if (cue.voice != program->binding_[cue.button]) return nullptr;
    if ((cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM) && cue.bar == 0 && cue.timing != 1) return nullptr;
    if ((cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM) && (cue.take < 0 || program->takes_[cue.take].voice != cue.voice)) return nullptr;
    if ((cue.kind == PF_COMMIT || cue.kind == PF_COMMIT_ARM) && (cue.commit < 0 || program->takes_[cue.commit].voice != cue.voice)) return nullptr;
    if (cue.kind == PF_COMMIT_ARM && cue.take == cue.commit) return nullptr;
  }
  unsigned arms[PF_COMPILED_MAX_TAKES]{}, commits[PF_COMPILED_MAX_TAKES]{};
  for (int id = 0; id < program->cue_count_; ++id) {
    const Cue& cue = program->cues_[id];
    bool arms_take = cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM;
    bool commits_take = cue.kind == PF_COMMIT || cue.kind == PF_COMMIT_ARM;
    if ((!arms_take && cue.take != -1) || (!commits_take && cue.commit != -1)) return nullptr;
    double boundary = cue_boundary(cue.bar, cue.cue, cue.timing, cue.execute, program->beats_);
    if (arms_take) {
      if (++arms[cue.take] != 1 || program->takes_[cue.take].begin != boundary) return nullptr;
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
  if (pcm_bytes > 180ULL * 1024 * 1024) return nullptr;
  for (int id = 0; id < program->take_count_; ++id) if (arms[id] != 1 || commits[id] != 1) return nullptr;
  for (int id = 0; id < program->member_count_; ++id, offset += PF_COMPILED_MEMBER_FIELDS) {
    const double* row = data + offset;
    if (!whole(row[0], PF_MAX_EVENTS - 1) || !index(row[1], program->take_count_) || !std::isfinite(row[2]) || row[2] < 0 || row[2] > 4) return nullptr;
    Member& member = program->members_[id]; member.selection = int(row[0]); member.take = int(row[1]); member.gain = row[2];
    for (int previous = 0; previous < id; ++previous) if (program->members_[previous].selection == member.selection) {
      if (program->members_[previous].take == member.take || program->takes_[program->members_[previous].take].voice != program->takes_[member.take].voice || program->takes_[program->members_[previous].take].anchor != program->takes_[member.take].anchor) return nullptr;
    }
  }
  program->window_count_ = window_count;
  program->selection_windows_.reset(new (std::nothrow) SelectionWindow[window_count]);
  if (!program->selection_windows_) return nullptr;
  for (int id = 0; id < window_count; ++id) {
    const double* row = data + window_offset + PF_COMPILED_WINDOW_HEADER_FIELDS + id * PF_COMPILED_WINDOW_FIELDS;
    if (!whole(row[0], PF_MAX_EVENTS - 1) || !std::isfinite(row[1]) || !std::isfinite(row[2]) || !std::isfinite(row[3])
      || row[1] < 0 || row[2] <= row[1] || row[3] < row[2] - row[1]
      || std::floor(row[1] * 960) != row[1] * 960 || std::floor(row[2] * 960) != row[2] * 960 || std::floor(row[3] * 960) != row[3] * 960) return nullptr;
    auto& window = program->selection_windows_[id]; window.selection = int(row[0]); window.begin = row[1]; window.end = row[2]; window.period = row[3];
    for (int previous = 0; previous < id; ++previous) if (program->selection_windows_[previous].selection == window.selection) return nullptr;
    for (int member = 0; member < program->member_count_; ++member) if (program->members_[member].selection == window.selection) {
      if (window.take >= 0) return nullptr;
      window.take = program->members_[member].take;
    }
    if (window.take < 0 || window.end > program->takes_[window.take].end - program->takes_[window.take].begin
      || window.begin + window.period > program->takes_[window.take].loop_end - program->takes_[window.take].begin) return nullptr;
    for (int cue = 0; cue < program->cue_count_; ++cue) if (program->cues_[cue].selection == window.selection
      && (program->cues_[cue].kind == PF_COMMIT || program->cues_[cue].kind == PF_COMMIT_ARM)
      && (window.end != program->takes_[window.take].end - program->takes_[window.take].begin
        || window.begin != window.end - program->beats_ || window.period != program->beats_)) return nullptr;
  }
  for (int id = 0; id < program->playback_count_; ++id, offset += PF_COMPILED_PLAYBACK_FIELDS) {
    const double* row = data + offset;
    if (!whole(row[0], program->bars_) || row[0] < 1 || !index(row[1], PF_CHANNELS) || !whole(row[2], PF_MAX_EVENTS - 1)) return nullptr;
    PlaybackCue& cue = program->playback_[id]; cue.bar = int(row[0]); cue.voice = int(row[1]); cue.selection = int(row[2]);
  }
  for (int id = 0; id < program->cue_count_; ++id) {
    const Cue& cue = program->cues_[id];
    if ((cue.kind == PF_COMMIT || cue.kind == PF_COMMIT_ARM || cue.kind == PF_PLAY) && cue.selection < 0) return nullptr;
    if (cue.selection >= 0) {
      if (cue.kind == PF_ARM || cue.kind == PF_STOP) return nullptr;
      bool found = false, committed = false;
      for (int member = 0; member < program->member_count_; ++member) if (program->members_[member].selection == cue.selection) {
        const Take& take = program->takes_[program->members_[member].take];
        if (take.voice != cue.voice || take.end > cue_boundary(cue.bar, cue.cue, cue.timing, cue.execute, program->beats_)) return nullptr;
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
  if (!definitions || !revisions || !program->prepare_effects(definitions, revisions)) return nullptr;
  return program;
}

bool Program::prepare_effects(const patches::Rack& definition, uint32_t revision) noexcept {
  const patches::Rack* definitions[PF_CHANNELS]; uint32_t revisions[PF_CHANNELS];
  for (int voice = 0; voice < PF_CHANNELS; ++voice) { definitions[voice] = &definition; revisions[voice] = revision; }
  return prepare_effects(definitions, revisions);
}
bool Program::prepare_effects(const patches::Rack* const* definitions, const uint32_t* revisions) noexcept {
  for (int id = 0; id < take_count_; ++id) for (const auto& playback : takes_[id].playback)
    if (playback && playback->state() != patches::PlaybackState::idle) return false;
  bool stale[PF_CHANNELS]{}, changed_graph[PF_CHANNELS]{};
  for (int voice = 0; voice < PF_CHANNELS; ++voice) {
    if (!definitions[voice]) return false;
    changed_graph[voice] = !voices_[voice] || !voices_[voice]->compatible(*definitions[voice]);
    stale[voice] = changed_graph[voice];
  }
  for (int id = 0; id < take_count_; ++id) for (int bank = 0; bank < 2; ++bank)
    if (bank != takes_[id].latest && (!takes_[id].cache[bank] || takes_[id].cache[bank]->revision() != revisions[takes_[id].voice])) stale[takes_[id].voice] = true;
  if (std::none_of(stale, stale + PF_CHANNELS, [](bool value) { return value; })) {
    std::copy(revisions, revisions + PF_CHANNELS, prepared_revision_); return true;
  }
  std::unique_ptr<patches::Rack> voices[PF_CHANNELS], tails[PF_CHANNELS];
  std::unique_ptr<patches::ProcessedTake> caches[PF_COMPILED_MAX_TAKES][2];
  std::unique_ptr<patches::Playback> players[PF_COMPILED_MAX_TAKES][2];
  auto checkpoints = std::unique_ptr<std::unique_ptr<patches::Rack>[]>(new (std::nothrow) std::unique_ptr<patches::Rack>[window_count_ * 2]);
  if (!checkpoints) return false;
  uint64_t estimated = 0;
  for (int id = 0; id < take_count_; ++id) for (int bank = 0; bank < 2; ++bank)
    if (takes_[id].cache[bank]) estimated += takes_[id].cache[bank]->memory_bytes() + takes_[id].playback[bank]->memory_bytes();
  for (int voice = 0; voice < PF_CHANNELS; ++voice) {
    if (voices_[voice]) estimated += voices_[voice]->memory_bytes();
    if (tails_[voice]) estimated += tails_[voice]->memory_bytes();
    if (!stale[voice]) continue;
    voices[voice] = definitions[voice]->snapshot(); tails[voice] = definitions[voice]->snapshot();
    if (!voices[voice] || !tails[voice]) return false;
    estimated += voices[voice]->memory_bytes() + tails[voice]->memory_bytes();
  }
  for (int id = 0; id < take_count_; ++id) for (int bank = 0; bank < 2; ++bank) {
    uint32_t revision = revisions[takes_[id].voice];
    if (takes_[id].latest == bank || (!changed_graph[takes_[id].voice] && takes_[id].cache[bank] && takes_[id].cache[bank]->revision() == revision)) continue;
    caches[id][bank] = patches::ProcessedTake::create(*definitions[takes_[id].voice], takes_[id].capacity, revision, 1);
    if (!caches[id][bank]) return false;
    players[id][bank] = patches::Playback::create(*caches[id][bank], patches::PlaybackMode::evolving);
    if (!players[id][bank]) return false;
    estimated += caches[id][bank]->memory_bytes() + players[id][bank]->memory_bytes();
    if (estimated > 200ULL * 1024 * 1024) return false;
  }
  for (int id = 0; id < window_count_; ++id) for (int bank = 0; bank < 2; ++bank) {
    auto& window = selection_windows_[id];
    if (window.initial[bank]) estimated += window.initial[bank]->memory_bytes();
    if (window.initial[bank] && !caches[window.take][bank]) continue;
    checkpoints[id * 2 + bank] = definitions[takes_[window.take].voice]->snapshot();
    if (!checkpoints[id * 2 + bank]) return false;
    estimated += checkpoints[id * 2 + bank]->memory_bytes();
    if (estimated > 200ULL * 1024 * 1024) return false;
  }
  for (int voice = 0; voice < PF_CHANNELS; ++voice) {
    if (voices[voice]) { voices_[voice] = std::move(voices[voice]); tails_[voice] = std::move(tails[voice]); }
    prepared_revision_[voice] = revisions[voice];
  }
  for (int id = 0; id < take_count_; ++id) for (int bank = 0; bank < 2; ++bank) if (caches[id][bank]) {
    takes_[id].playback[bank].reset();
    takes_[id].cache[bank] = std::move(caches[id][bank]);
    takes_[id].playback[bank] = std::move(players[id][bank]);
  }
  for (int id = 0; id < window_count_; ++id) for (int bank = 0; bank < 2; ++bank)
    if (checkpoints[id * 2 + bank]) selection_windows_[id].initial[bank] = std::move(checkpoints[id * 2 + bank]);
  return true;
}
void Program::start(int start_bar, int count_in_beats, double frame, double bpm) noexcept {
  stop(); bpm_ = bpm; start_ = start_bar; phase_ = count_in_beats ? PF_COUNT_IN : PF_PLAYING; bar_ = count_in_beats ? 0 : start_bar;
  anchor_frame_ = frame; anchor_position_ = (start_bar - 1) * beats_ - count_in_beats - 1;
  query_position_ = anchor_position_; query_frame_ = frame;
  for (int id = 0; id < cue_count_; ++id) { cues_[id].used = false; cues_[id].occurred_frame = std::numeric_limits<double>::quiet_NaN(); }
  for (int voice = 0; voice < PF_CHANNELS; ++voice) suppressed_[voice] = false;
}
void Program::stop() noexcept {
  if (active_capture_.take >= 0) {
    Take& take = takes_[active_capture_.take];
    uint32_t period = 0;
    if (commit_period(active_capture_.take, period) && take.cache[active_capture_.bank]->commit(period)) take.latest = active_capture_.bank;
    else take.cache[active_capture_.bank]->reset_for_capture();
  }
  active_capture_ = {}; live_route_ = -1; monitor_route_ = PF_DEFAULT_PROFILE; rotation_deadline_ = -1; phase_ = PF_IDLE; error_ = PF_OK;
  for (int button = 0; button < PF_CHANNELS; ++button) pending_[button] = {};
  for (int voice = 0; voice < PF_CHANNELS; ++voice) { if (voices_[voice]) voices_[voice]->reset(); if (tails_[voice]) tails_[voice]->reset(); drain_[voice] = 0; detached_tail_[voice] = false; tail_generation_[voice] = 0; }
  drain_[PF_DEFAULT_PROFILE] = 0; drain_[PF_BACKUP_PROFILE] = 0;
  std::fill(handed_off_, handed_off_ + PF_CHANNELS, false);
  for (int id = 0; id < take_count_; ++id) for (auto& playback : takes_[id].playback) if (playback) playback->reset();
}
void Program::microphone_lost() noexcept {
  if (active_capture_.take >= 0) takes_[active_capture_.take].cache[active_capture_.bank]->reset_for_capture();
  active_capture_ = {}; live_route_ = -1; monitor_route_ = PF_DEFAULT_PROFILE; rotation_deadline_ = -1;
  for (int button = 0; button < PF_CHANNELS; ++button) pending_[button] = {};
  for (int voice = 0; voice < PF_CHANNELS; ++voice) { voices_[voice]->reset(); tails_[voice]->reset(); drain_[voice] = 0; detached_tail_[voice] = false; tail_generation_[voice] = 0; }
  drain_[PF_DEFAULT_PROFILE] = 0; drain_[PF_BACKUP_PROFILE] = 0;
  std::fill(handed_off_, handed_off_ + PF_CHANNELS, false);
}
double Program::cue_frame(const Cue& cue, double bpm) const noexcept {
  return std::isfinite(cue.occurred_frame) ? cue.occurred_frame : anchor_frame_ + ((cue.bar - 1) * beats_ + cue.cue - anchor_position_) * rate_ * 60 / bpm;
}
void Program::remember_cues(double frame, double bpm) noexcept {
  double now = position(frame, bpm);
  for (int id = 0; id < cue_count_; ++id) {
    Cue& cue = cues_[id]; double at = (cue.bar - 1) * beats_ + cue.cue;
    if (cue.cue >= 0 && cue.bar == bar_ && at <= now && !std::isfinite(cue.occurred_frame)) cue.occurred_frame = cue_frame(cue, bpm);
  }
}
void Program::tempo_changed(double frame, double old_bpm, double new_bpm) noexcept {
  remember_cues(frame, old_bpm);
  anchor_position_ = position(frame, old_bpm); anchor_frame_ = frame;
  query_position_ = anchor_position_; query_frame_ = frame; bpm_ = new_bpm;
}
bool Program::commit_period(int id, uint32_t& period) const noexcept {
  const Take& take = takes_[id]; const auto& cache = take.cache[active_capture_.bank];
  double expected = std::ceil((take.loop_end - take.begin) * rate_ * 60 / capture_bpm_);
  if (expected < 1 || expected > std::numeric_limits<uint32_t>::max()) return false;
  period = uint32_t(expected);
  if (take.anchor != id) {
    const Take& anchor = takes_[take.anchor];
    if (anchor.latest < 0 || anchor.playback[anchor.latest]->state() != patches::PlaybackState::playing) return false;
    period = anchor.cache[anchor.latest]->period();
    if (std::abs(double(period) - expected) > 1 || std::min(take.capture_start_phase, double(period) - take.capture_start_phase) > 1) return false;
    double actual = anchor.playback[anchor.latest]->phase() % period, joined = cache->length() % period;
    double delta = std::abs(actual - joined);
    if (std::min(delta, double(period) - delta) > 1) return false;
  }
  double expected_capture = (take.end - take.begin) * rate_ * 60 / capture_bpm_;
  return cache->length() <= period && std::abs(double(cache->length()) - expected_capture) <= 1;
}
double Program::position(double frame, double bpm) const noexcept { return anchor_position_ + (frame - anchor_frame_) * bpm / (rate_ * 60); }
double Program::frame_at(double position) const noexcept { return anchor_frame_ + (position - anchor_position_) * rate_ * 60 / bpm_; }
int Program::available_bank(int id) const noexcept {
  if (id < 0 || id >= take_count_) return -1;
  const Take& take = takes_[id];
  for (int bank = 0; bank < 2; ++bank) if (bank != take.latest && !(active_capture_.take == id && active_capture_.bank == bank) && take.cache[bank] && take.cache[bank]->revision() == prepared_revision_[take.voice] && take.playback[bank] && take.playback[bank]->state() == patches::PlaybackState::idle) return bank;
  return -1;
}
bool Program::has_capture() const noexcept {
  if (active_capture_.take >= 0) return true;
  for (int button = 0; button < PF_CHANNELS; ++button) if (pending_[button].reserved_take >= 0) return true;
  return false;
}
bool Program::reservation_available(int id, int button, int committing) const noexcept {
  const Take& requested = takes_[id];
  auto overlaps = [&](int other) { return other >= 0 && requested.begin < takes_[other].end && takes_[other].begin < requested.end; };
  if (active_capture_.take != committing && overlaps(active_capture_.take)) return false;
  for (int other = 0; other < PF_CHANNELS; ++other) if (other != button && overlaps(pending_[other].reserved_take)) return false;
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
  if (!rotation_eligible() || rotation_deadline_ < 0) return 0;
  double frames = frame_at(rotation_deadline_) - query_frame_;
  return frames > 0 ? frames * bpm_ / (rate_ * 60) : 0;
}
int Program::rotate(double value, double frame, double bpm) noexcept {
  if (!std::isfinite(value)) return PF_INVALID_KNOB;
  bpm_ = bpm; query_position_ = position(frame, bpm); query_frame_ = frame;
  if (!value || phase_ != PF_PLAYING) return PF_OK;
  for (int id = 0; id < rotation_count_; ++id) if (frame >= frame_at(rotation_windows_[id].begin) && frame < frame_at(rotation_windows_[id].end)) {
    double grid = std::floor(query_position_ / rotation_grid_);
    double next = (grid + 1) * rotation_grid_;
    // Correct either rounding direction in count conversion without merging
    // distinct source frames at a strict grid boundary.
    if (frame_at(grid * rotation_grid_) > frame) next = grid * rotation_grid_;
    else if (frame_at(next) <= frame) next = (grid + 2) * rotation_grid_;
    rotation_deadline_ = std::min(next, rotation_windows_[id].end); break;
  }
  return PF_OK;
}
int Program::profile_activity(int profile) const noexcept {
  int selected = rotation_remaining() > 0 ? PF_BACKUP_PROFILE : live_route_ < 0 ? PF_DEFAULT_PROFILE : live_route_;
  if ((phase_ == PF_COUNT_IN || phase_ == PF_PLAYING) && profile == selected) return PF_VOICE_LIVE;
  if (profile < PF_CHANNELS && active_capture_.take >= 0 && takes_[active_capture_.take].voice == profile) return PF_VOICE_CAPTURE;
  return profile >= 0 && profile < PF_VOICE_PROFILES && drain_[profile] ? PF_VOICE_TAIL : PF_VOICE_STANDBY;
}
int Program::press(int button, double frame, double bpm, bool microphone) noexcept {
  if (button < 0 || button >= PF_CHANNELS || phase_ == PF_IDLE || phase_ == PF_ENDED) return PF_INVALID_CHANNEL;
  error_ = PF_OK;
  remember_cues(frame, bpm);
  double now = position(frame, bpm), best = std::numeric_limits<double>::infinity(); int found = -1; bool tied = false;
  for (int id = 0; id < cue_count_; ++id) {
    const Cue& cue = cues_[id]; if (cue.button != button) continue;
    double at = cue_frame(cue, bpm), delta = frame - at;
    bool applicable = cue.cue < 0 ? cue.bar == bar_ : phase_ == PF_PLAYING && delta >= -early_ * rate_ / 1000 - epsilon && delta <= late_ * rate_ / 1000 + epsilon;
    if (!applicable) continue;
    double distance = cue.cue < 0 ? 0 : std::abs(delta);
    if (distance < best - epsilon) { found = id; best = distance; tied = false; }
    else if (std::abs(distance - best) <= epsilon) tied = true;
  }
  if (tied) return PF_CUE_AMBIGUOUS;
  if (found < 0) {
    for (int id = 0; id < cue_count_; ++id) if (cues_[id].button == button && cues_[id].bar == bar_) return PF_CUE_LATE;
    return PF_OK;
  }
  Cue& cue = cues_[found]; if (cue.used || pending_[button].cue == found) return PF_OK;
  if (pending_[button].cue >= 0) return PF_CAPTURE_BUSY;
  if (cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM) {
    if (!microphone) return PF_MICROPHONE_REQUIRED;
    if (cue.kind == PF_COMMIT_ARM && active_capture_.take != cue.commit) return PF_NO_RECORDING;
    if (!reservation_available(cue.take, button, cue.kind == PF_COMMIT_ARM ? cue.commit : -1)) return PF_CAPTURE_BUSY;
    if (available_bank(cue.take) < 0) return PF_TAKE_UNAVAILABLE;
  }
  if (cue.kind == PF_COMMIT && active_capture_.take != cue.commit) return PF_NO_RECORDING;
  if (cue.kind == PF_PLAY && cue.selection >= 0 && !selection_ready(cue.selection, cue.voice)) return PF_NO_SAMPLE;
  double target = now;
  if (cue.timing == 1) target = phase_ == PF_COUNT_IN ? (start_ - 1) * beats_ : (std::floor(now / beats_) + 1) * beats_;
  if (cue.timing == 2) target = (cue.bar - 1) * beats_ + cue.execute;
  if (target < now - epsilon) return PF_CUE_LATE;
  if (cue.kind == PF_ARM && target <= now + epsilon && active_capture_.take >= 0) return PF_CAPTURE_BUSY;
  if (cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM) {
    const Take& take = takes_[cue.take]; const Take& anchor = takes_[take.anchor];
    double maximum_source_frames = std::ceil((take.end - target) * rate_ * 60 / minimum_bpm);
    if (maximum_source_frames <= 0 || maximum_source_frames > take.capacity) return PF_LOOP_MISMATCH;
    if (take.anchor != cue.take && !(cue.kind == PF_COMMIT_ARM && cue.commit == take.anchor)) {
      if (anchor.latest < 0 || anchor.playback[anchor.latest]->state() != patches::PlaybackState::playing) return PF_LOOP_MISMATCH;
      double period = anchor.cache[anchor.latest]->period();
      double advance = std::max(0.0, std::ceil(anchor_frame_ + (target - anchor_position_) * rate_ * 60 / bpm) - frame);
      double phase = std::fmod(anchor.playback[anchor.latest]->phase() + advance, period);
      if (std::min(phase, period - phase) > 1) return PF_LOOP_MISMATCH;
    }
  }
  if (cue.kind == PF_COMMIT_ARM && target <= now + epsilon) {
    CommitPlan plan; int bank = -1;
    int result = preflight_commit(cue, plan);
    if (result == PF_OK) result = preflight_start(cue, &cue, plan.period, bank);
    if (result != PF_OK) { if (plan.invalid_draft) discard_invalid_draft(cue); return result; }
  }
  if (cue.tempo_hint && (!tempo_hit_ || tempo_hit_(tempo_context_, cue.tempo_hint) != PF_OK)) return PF_TEMPO_REJECTED;
  if (cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM) { switch_route(cue.voice); if (error_ != PF_OK) return error_; }
  if (target <= now + epsilon) {
    int result = execute(found, frame);
    if (result != PF_OK) { error_ = PF_OK; return result; }
  } else { pending_[button].cue = found; pending_[button].position = target; pending_[button].reserved_take = cue.take; }
  cue.used = true; return PF_OK;
}
bool Program::selection_ready(int selection, int voice) const noexcept {
  for (int id = 0; id < window_count_; ++id) if (selection_windows_[id].selection == selection) {
    const auto& window = selection_windows_[id]; int bank = takes_[window.take].latest;
    if (bank < 0 || window.cut[bank] < 0) return false;
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
  take.playback_gain[take.latest] = take.gain * gain;
  return true;
}
void Program::stop_voice(int voice, bool hard) noexcept {
  for (int id = 0; id < take_count_; ++id) if (takes_[id].voice == voice) for (auto& playback : takes_[id].playback) {
    if (hard) playback->reset(); else playback->stop();
  }
}
bool Program::select(int voice, int selection, bool automatic) noexcept {
  if (!selection_ready(selection, voice) || (automatic && suppressed_[voice])) return false;
  bool playing = false;
  for (int id = 0; id < take_count_; ++id) if (takes_[id].voice == voice) for (const auto& playback : takes_[id].playback) if (playback->state() == patches::PlaybackState::playing) playing = true;
  if (automatic && !playing) { selection_[voice] = selection; return true; }
  for (int id = 0; id < take_count_; ++id) if (takes_[id].voice == voice) {
    bool selected = false;
    for (int member = 0; member < member_count_; ++member) if (members_[member].selection == selection && members_[member].take == id) selected = true;
    if (!selected) for (auto& playback : takes_[id].playback) playback->stop();
  }
  for (int member = 0; member < member_count_; ++member) if (members_[member].selection == selection) {
    Take& take = takes_[members_[member].take];
    auto& player = take.playback[take.latest];
    SelectionWindow* view = nullptr;
    for (int window = 0; window < window_count_; ++window) if (selection_windows_[window].selection == selection) view = &selection_windows_[window];
    if (view) {
      const int bank = take.latest;
      if (view->start[bank] < 0 || view->cut[bank] < view->start[bank]) return false;
      bool parent_period = view->begin == 0 && view->period == take.loop_end - take.begin;
      if (!parent_period && view->finish[bank] <= view->start[bank]) return false;
      uint32_t period = parent_period ? take.cache[bank]->period()
        : uint32_t(view->finish[bank] - view->start[bank]);
      if (player->state() == patches::PlaybackState::playing) {
        if (!player->set_window(uint32_t(view->start[bank]), uint32_t(view->cut[bank]), period)) return false;
      } else if (!player->start_window(true, uint32_t(view->start[bank]), uint32_t(view->cut[bank]), period, *view->initial[bank])) return false;
    } else {
      if (player->state() != patches::PlaybackState::playing && !play_take(members_[member].take, members_[member].gain)) return false;
      player->set_window(0, take.cache[take.latest]->length(), take.cache[take.latest]->period());
      player->clear_source_end();
    }
    take.playback_gain[take.latest] = take.gain * members_[member].gain;
  }
  selection_[voice] = selection; return true;
}
int Program::preflight_commit(const Cue& cue, CommitPlan& plan) const noexcept {
  if (active_capture_.take != cue.commit) return PF_NO_RECORDING;
  const Take& draft = takes_[cue.commit];
  if (draft.cache[active_capture_.bank]->state() != patches::TakeState::capturing) return PF_ACTION_FAILED;
  if (!commit_period(cue.commit, plan.period)) { plan.invalid_draft = true; return PF_LOOP_MISMATCH; }
  double joined_phase = draft.cache[active_capture_.bank]->length() % plan.period;
  for (int id = 0; id < member_count_; ++id) if (members_[id].selection == cue.selection && members_[id].take != cue.commit) {
    const Take& member = takes_[members_[id].take];
    if (member.latest < 0 || member.cache[member.latest]->state() != patches::TakeState::committed) return PF_NO_SAMPLE;
    if (member.cache[member.latest]->period() != plan.period) return PF_LOOP_MISMATCH;
    double phase = member.playback[member.latest]->state() == patches::PlaybackState::playing ? member.playback[member.latest]->phase() % plan.period : 0;
    double delta = std::abs(phase - joined_phase);
    if (std::min(delta, double(plan.period) - delta) > 1) return PF_LOOP_MISMATCH;
  }
  return PF_OK;
}
int Program::preflight_start(const Cue& cue, const Cue* staged_commit, uint32_t staged_period, int& bank) const noexcept {
  if (active_capture_.take >= 0 && (!staged_commit || staged_commit->commit != active_capture_.take)) return PF_CAPTURE_BUSY;
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
  }
  double expected = std::ceil((take.loop_end - take.begin) * rate_ * 60 / bpm_);
  if (std::abs(double(period) - expected) > 1 || std::min(phase, double(period) - phase) > 1) return PF_LOOP_MISMATCH;
  return PF_OK;
}
void Program::discard_invalid_draft(const Cue& cue) noexcept {
  if (active_capture_.take != cue.commit) return;
  takes_[cue.commit].cache[active_capture_.bank]->reset_for_capture(); active_capture_ = {};
  if (live_route_ == cue.voice && pending_[cue.button].reserved_take < 0) switch_route(-1);
}
int Program::finish_capture(const Cue& cue, const CommitPlan& plan, bool starts_next) noexcept {
  Take& take = takes_[active_capture_.take];
  if (!take.cache[active_capture_.bank]->commit(plan.period)) return error_ = PF_ACTION_FAILED;
  if (take.latest >= 0) take.playback[take.latest]->stop();
  uint64_t completed_generation = active_capture_.generation;
  take.latest = active_capture_.bank; active_capture_ = {};
  SelectionWindow* committed_view = nullptr;
  for (int window = 0; window < window_count_; ++window) if (selection_windows_[window].selection == cue.selection) committed_view = &selection_windows_[window];
  if (committed_view) {
    int bank = take.latest;
    if (committed_view->start[bank] < 0 || committed_view->cut[bank] <= committed_view->start[bank]
      || committed_view->finish[bank] <= committed_view->start[bank]
      || !take.playback[bank]->start_window_at_capture_end(true, uint32_t(committed_view->start[bank]), uint32_t(committed_view->cut[bank]),
        uint32_t(committed_view->finish[bank] - committed_view->start[bank]))) return error_ = PF_ACTION_FAILED;
  } else if (!take.playback[take.latest]->start_at_capture_end(true)) return error_ = PF_ACTION_FAILED;
  // END playback owns this source epoch. Related monitor clones retire, while
  // other voices and unrelated detached histories keep their own tails.
  if (tail_generation_[cue.voice] == completed_generation) { drain_[cue.voice] = 0; tail_generation_[cue.voice] = 0; }
  voices_[cue.voice]->reset();
  if (cue.selection >= 0) {
    if (!select(cue.voice, cue.selection, false)) return error_ = PF_ACTION_FAILED;
  } else if (!play_take(cue.commit)) return error_ = PF_ACTION_FAILED;
  if (!starts_next && live_route_ == cue.voice && pending_[cue.button].reserved_take < 0) switch_route(-1, true);
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
  if (cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM) {
    Take& take = takes_[cue.take];
    if (!take.cache[bank]->reset_for_capture() || !take.cache[bank]->begin(*voices_[cue.voice])) return error_ = PF_ACTION_FAILED;
    capture_bpm_ = bpm_;
    const Take& anchor = takes_[take.anchor];
    take.capture_start_phase = take.anchor != cue.take && anchor.latest >= 0 ? anchor.playback[anchor.latest]->phase() % anchor.cache[anchor.latest]->period() : 0;
    uint64_t generation = ++capture_generation_;
    if (live_route_ != cue.voice && drain_[cue.voice] && !detached_tail_[cue.voice]) {
      if (!tails_[cue.voice]->copy_state(*voices_[cue.voice])) return error_ = PF_ACTION_FAILED;
      detached_tail_[cue.voice] = true; tail_generation_[cue.voice] = generation;
    }
    active_capture_ = {cue.take, bank, generation};
    for (int window = 0; window < window_count_; ++window) if (selection_windows_[window].take == cue.take) {
      selection_windows_[window].start[bank] = selection_windows_[window].cut[bank] = selection_windows_[window].finish[bank] = -1;
    }
    observe_windows(frame);
  }
  if (cue.kind == PF_STOP) { stop_voice(cue.voice, false); suppressed_[cue.voice] = true; }
  if (cue.kind == PF_PLAY) {
    if (cue.selection >= 0) { if (!select(cue.voice, cue.selection, false)) return error_ = PF_NO_SAMPLE; }
    else {
      bool found = false;
      for (int take = take_count_ - 1; take >= 0; --take) if (takes_[take].voice == cue.voice && takes_[take].latest >= 0) { found = play_take(take); break; }
      if (!found) return error_ = PF_NO_SAMPLE;
    }
    suppressed_[cue.voice] = false;
  }
  return error_ = PF_OK;
}
void Program::observe_windows(double frame) noexcept {
  if (active_capture_.take < 0) return;
  for (int id = 0; id < window_count_; ++id) {
    auto& window = selection_windows_[id];
    if (window.take == active_capture_.take && window.start[active_capture_.bank] < 0
      && frame >= std::ceil(frame_at(takes_[window.take].begin + window.begin))) {
      window.start[active_capture_.bank] = takes_[window.take].cache[active_capture_.bank]->length();
      if (!window.initial[active_capture_.bank]->copy_state(*voices_[takes_[window.take].voice])) error_ = PF_ACTION_FAILED;
    }
    if (window.take == active_capture_.take && window.cut[active_capture_.bank] < 0
      && frame >= std::ceil(frame_at(takes_[window.take].begin + window.end)))
      window.cut[active_capture_.bank] = takes_[window.take].cache[active_capture_.bank]->length();
    if (window.take == active_capture_.take && window.finish[active_capture_.bank] < 0
      && frame >= std::ceil(frame_at(takes_[window.take].begin + window.begin + window.period)))
      window.finish[active_capture_.bank] = takes_[window.take].cache[active_capture_.bank]->length();
  }
}
void Program::apply_pending(double frame, double bpm) noexcept {
  observe_windows(frame);
  remember_cues(frame, bpm);
  double now = position(frame, bpm);
  query_position_ = now; query_frame_ = frame;
  struct Due { int cue = -1, result = PF_OK, bank = -1; CommitPlan commit; };
  Due due[PF_CHANNELS];
  const Cue* staged_commit = nullptr; uint32_t staged_period = 0; bool failed_commit = false;
  for (int button = 0; button < PF_CHANNELS; ++button) {
    if (pending_[button].cue < 0 || frame < std::ceil(anchor_frame_ + (pending_[button].position - anchor_position_) * rate_ * 60 / bpm)) continue;
    Due& action = due[button]; action.cue = pending_[button].cue;
    const Cue& cue = cues_[action.cue];
    if (cue.kind != PF_COMMIT && cue.kind != PF_COMMIT_ARM) continue;
    action.result = preflight_commit(cue, action.commit);
    if (action.result == PF_OK && cue.kind == PF_COMMIT_ARM) action.result = preflight_start(cue, &cue, action.commit.period, action.bank);
    if (action.result == PF_OK) { staged_commit = &cue; staged_period = action.commit.period; }
    else failed_commit = true;
  }
  Due automatic;
  int automatic_start = PF_OK;
  if (active_capture_.take >= 0 && frame >= std::ceil(frame_at(takes_[active_capture_.take].end))
    && (!staged_commit || staged_commit->commit != active_capture_.take)) {
    automatic.cue = takes_[active_capture_.take].commit_cue;
    const Cue& cue = cues_[automatic.cue];
    automatic.result = preflight_commit(cue, automatic.commit);
    failed_commit = automatic.result != PF_OK;
    if (!failed_commit) {
      staged_commit = &cue; staged_period = automatic.commit.period;
      if (cue.kind == PF_COMMIT_ARM) automatic_start = preflight_start(cue, &cue, automatic.commit.period, automatic.bank);
    }
  }
  // Preflight incoming resources against the valid staged release, before it is
  // published. Independent failed starts do not roll back that valid commit.
  for (int button = 0; button < PF_CHANNELS; ++button) if (due[button].cue >= 0) {
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
        result = cue.kind == PF_COMMIT_ARM && automatic_start == PF_OK
          ? execute(automatic.cue, frame) : finish_capture(cue, automatic.commit, false);
        if (result != PF_OK) { stop(); error_ = PF_ACTION_FAILED; return; }
        result = automatic_start;
      } else discard_invalid_draft(cue);
      cue.used = true;
      if (pending_[cue.button].cue == automatic.cue) pending_[cue.button] = {};
      error_ = PF_OK;
      if (result != PF_OK && outcome_) outcome_(outcome_context_, frame, cue.button, automatic.cue, result);
      else if (observer_) observer_(observer_context_, frame);
    }
    for (int button = 0; button < PF_CHANNELS; ++button) {
      Due& action = due[button]; if (action.cue < 0) continue;
      const Cue& cue = cues_[action.cue];
      bool commits = cue.kind == PF_COMMIT || cue.kind == PF_COMMIT_ARM;
      if (commits != (pass == 0)) continue;
      pending_[button] = {};
      int result = action.result;
      if (cue.kind == PF_ARM && failed_commit) result = PF_CAPTURE_BUSY;
      if (result == PF_OK) result = execute(action.cue, frame);
      else if (action.commit.invalid_draft && automatic.cue < 0) discard_invalid_draft(cue);
      if (result != PF_OK) {
        bool admission = result == PF_CAPTURE_BUSY || result == PF_TAKE_UNAVAILABLE || result == PF_NO_RECORDING || result == PF_NO_SAMPLE || result == PF_LOOP_MISMATCH;
        if (!admission) { stop(); error_ = PF_ACTION_FAILED; return; }
        if (commits && automatic.cue < 0) failed_commit = true;
        error_ = PF_OK;
        if (outcome_ && automatic.cue != action.cue) outcome_(outcome_context_, frame, button, action.cue, result);
      } else if (observer_) observer_(observer_context_, frame);
    }
  }
}
void Program::beat(int phase, int bar, int beat, int count_remaining, double frame, double bpm) noexcept {
  remember_cues(frame, bpm);
  double next_position = (bar - 1) * beats_ + beat - 1;
  bool wrap = phase == PF_PLAYING && phase_ == PF_PLAYING && next_position < anchor_position_;
  if (wrap) {
    rotation_deadline_ = -1;
    apply_pending(std::ceil(frame), bpm);
    if (active_capture_.take >= 0) {
      int cue = takes_[active_capture_.take].commit_cue;
      discard_invalid_draft(cues_[cue]);
      if (outcome_) outcome_(outcome_context_, std::ceil(frame), cues_[cue].button, cue, PF_LOOP_MISMATCH);
    }
    for (int button = 0; button < PF_CHANNELS; ++button) pending_[button] = {};
    for (int id = 0; id < cue_count_; ++id) { cues_[id].used = false; cues_[id].occurred_frame = std::numeric_limits<double>::quiet_NaN(); }
  }
  phase_ = phase; bar_ = phase == PF_COUNT_IN ? 0 : bar;
  bpm_ = bpm; anchor_frame_ = frame; anchor_position_ = phase == PF_COUNT_IN ? (start_ - 1) * beats_ - count_remaining : (bar - 1) * beats_ + beat - 1;
  query_position_ = anchor_position_;
  apply_pending(std::ceil(frame), bpm);
  if (phase == PF_PLAYING && beat == 1) for (int id = 0; id < playback_count_; ++id) if (playback_[id].bar == bar) select(playback_[id].voice, playback_[id].selection, true);
}
void Program::render(const float* input, float* left, float* right, float* live_left, float* live_right,
  uint32_t frames, double frame, double bpm, bool live, patches::Rack& default_rack, patches::Rack& backup_rack) noexcept {
  bpm_ = bpm;
  for (uint32_t offset = 0; offset < frames; ++offset) {
    apply_pending(frame + offset, bpm);
    float source = input && std::isfinite(input[offset]) ? input[offset] : 0;
    patches::Stereo current{}, monitor{};
    if (live && (phase_ == PF_COUNT_IN || phase_ == PF_PLAYING)) {
      int recording_voice = active_capture_.take >= 0 ? takes_[active_capture_.take].voice : -1;
      auto rack_for = [&](int profile) -> patches::Rack& { return profile == PF_DEFAULT_PROFILE ? default_rack : profile == PF_BACKUP_PROFILE ? backup_rack : *voices_[profile]; };
      int desired = rotation_remaining() > 0 ? PF_BACKUP_PROFILE : live_route_ < 0 ? PF_DEFAULT_PROFILE : live_route_;
      if (desired != monitor_route_) {
        int outgoing = monitor_route_;
        bool handed_off = outgoing < PF_CHANNELS && handed_off_[outgoing];
        if (!handed_off) {
          if (outgoing < PF_CHANNELS) {
            detached_tail_[outgoing] = recording_voice == outgoing;
            tail_generation_[outgoing] = detached_tail_[outgoing] ? active_capture_.generation : 0;
            if (detached_tail_[outgoing] && !tails_[outgoing]->copy_state(*voices_[outgoing])) { stop(); error_ = PF_ACTION_FAILED; break; }
          }
          drain_[outgoing] = rack_for(outgoing).maximum_tail_frames();
        }
        if (outgoing < PF_CHANNELS) handed_off_[outgoing] = false;
        monitor_route_ = desired; drain_[desired] = 0;
        if (desired < PF_CHANNELS) { detached_tail_[desired] = false; tail_generation_[desired] = 0; handed_off_[desired] = false; }
      }
      current = rack_for(desired).process({source, source}); monitor = current;
      patches::Stereo captured = current;
      if (recording_voice >= 0 && recording_voice != desired) captured = voices_[recording_voice]->process({source, source});
      for (int profile = 0; profile < PF_VOICE_PROFILES; ++profile) if (profile != desired && drain_[profile]) {
        patches::Rack& rack = profile < PF_CHANNELS && detached_tail_[profile] ? *tails_[profile] : rack_for(profile);
        patches::Stereo tail = rack.process({}); --drain_[profile]; monitor.left += tail.left; monitor.right += tail.right;
      }
      if (active_capture_.take >= 0) {
        auto& cache = takes_[active_capture_.take].cache[active_capture_.bank];
        if (!cache->append_processed(*voices_[recording_voice], &source, &source, &captured.left, &captured.right, 1)) { stop(); error_ = PF_ACTION_FAILED; }
      }
    }
    if (live_left) live_left[offset] += monitor.left;
    if (live_right) live_right[offset] += monitor.right;
    for (int id = 0; id < take_count_; ++id) for (int bank = 0; bank < 2; ++bank) {
      if (takes_[id].playback[bank]->state() == patches::PlaybackState::idle) continue;
      patches::Stereo value = takes_[id].playback[bank]->next(); int voice = takes_[id].voice;
      double gain = takes_[id].playback_gain[bank] * (muted_[voice] ? 0 : gain_[voice]);
      if (left) left[offset] += float(value.left * gain);
      if (right) right[offset] += float(value.right * gain);
    }
  }
  query_position_ = position(frame + frames, bpm); query_frame_ = frame + frames;
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
  if (pending_[button].cue >= 0) {
    info.pending = cues_[pending_[button].cue].kind;
    if (info.pending == PF_ARM || info.pending == PF_COMMIT_ARM) info.status = PF_ARMED;
    if (info.pending == PF_STOP) {
      info.status = PF_STOPPING;
      if (info.looping) {
        double stop_frame = std::ceil(anchor_frame_ + (pending_[button].position - anchor_position_) * rate_ * 60 / bpm);
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
    if ((cue.cue < 0 && cue.bar == bar_) || (cue.cue >= 0 && delta >= -early_ * rate_ / 1000 && delta <= late_ * rate_ / 1000)) { info.light = PF_CUE; break; }
  }
  return info;
}
void Program::take_info(uint32_t id, double* out) const noexcept {
  if (!out) return;
  std::fill(out, out + PF_TAKE_FIELDS, 0);
  out[PF_TAKE_SOURCE_END] = -1;
  if (id >= uint32_t(take_count_)) return;
  const Take& take = takes_[id]; int bank = active_capture_.take == int(id) ? active_capture_.bank : take.latest >= 0 ? take.latest : 0;
  out[PF_TAKE_VOICE] = take.voice; out[PF_TAKE_READY] = take.latest >= 0;
  out[PF_TAKE_PERIOD] = take.cache[bank]->period();
  out[PF_TAKE_LENGTH] = take.cache[bank]->length(); out[PF_TAKE_CAPACITY] = take.capacity;
  out[PF_TAKE_REVISION] = double(take.cache[bank]->revision());
  out[PF_TAKE_SOURCE_END] = take.playback[bank]->source_end();
  out[PF_TAKE_PHASE] = take.playback[bank]->phase(); out[PF_TAKE_PLAYBACK_STATE] = int(take.playback[bank]->state());
}
}
