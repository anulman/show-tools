#include "compiled_program.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <new>

namespace compiled {
namespace {
constexpr double epsilon = 1e-8;
bool whole(double value, double maximum) { return std::isfinite(value) && value >= 0 && value <= maximum && std::floor(value) == value; }
bool index(double value, int count, bool optional = false) { return (optional && value == -1) || whole(value, count - 1); }
bool point(double value, int beats) { return std::isfinite(value) && value >= 0 && value < beats && std::floor(value * 960) == value * 960; }
double cue_boundary(int bar, double cue, int timing, double execute, int beats) {
  if (timing == 1) return bar * beats;
  return (std::max(1, bar) - 1) * beats + (timing == 2 ? execute : std::max(0.0, cue));
}
}
struct Program::Take {
  int voice = 0, latest = -1, anchor = -1;
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
  if (!data || fields < PF_COMPILED_HEADER_FIELDS || data[0] != PF_COMPILED_MAGIC || data[1] != PF_COMPILED_VERSION
    || !whole(data[2], 6) || (data[2] != 4 && data[2] != 6) || !whole(data[3], PF_MAX_BARS) || data[3] < 1
    || !std::isfinite(data[4]) || data[4] < 40 || data[4] > 240 || !whole(data[5], data[3]) || data[5] < 1
    || !std::isfinite(data[6]) || data[6] < 0 || data[6] > 100 || !std::isfinite(data[7]) || data[7] < 0 || data[7] > 100
    || !whole(data[8], PF_COMPILED_MAX_TAKES) || !whole(data[9], PF_MAX_EVENTS) || !whole(data[10], PF_MAX_EVENTS) || !whole(data[11], PF_MAX_EVENTS)) return nullptr;
  uint64_t needed = PF_COMPILED_HEADER_FIELDS + uint64_t(data[8]) * PF_COMPILED_TAKE_FIELDS + uint64_t(data[9]) * PF_COMPILED_CUE_FIELDS
    + uint64_t(data[10]) * PF_COMPILED_MEMBER_FIELDS + uint64_t(data[11]) * PF_COMPILED_PLAYBACK_FIELDS;
  if (needed != fields) return nullptr;
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
    if (take.loop_end < take.end || std::ceil((take.loop_end - take.begin) * rate * 60 / 40) > std::numeric_limits<uint32_t>::max()) return nullptr;
    double capacity = std::ceil((take.end - take.begin) * rate * 60 / 40);
    if (capacity < 1 || capacity > rate * 30 || capacity > std::numeric_limits<uint32_t>::max()) return nullptr;
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
  if (pcm_bytes > 180ULL * 1024 * 1024) return nullptr;
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
    if (arms_take && (++arms[cue.take] != 1 || program->takes_[cue.take].begin != boundary)) return nullptr;
    if (commits_take && (++commits[cue.commit] != 1 || program->takes_[cue.commit].end != boundary)) return nullptr;
  }
  for (int id = 0; id < program->take_count_; ++id) if (arms[id] != 1 || commits[id] != 1) return nullptr;
  for (int id = 0; id < program->member_count_; ++id, offset += PF_COMPILED_MEMBER_FIELDS) {
    const double* row = data + offset;
    if (!whole(row[0], PF_MAX_EVENTS - 1) || !index(row[1], program->take_count_) || !std::isfinite(row[2]) || row[2] < 0 || row[2] > 4) return nullptr;
    Member& member = program->members_[id]; member.selection = int(row[0]); member.take = int(row[1]); member.gain = row[2];
    for (int previous = 0; previous < id; ++previous) if (program->members_[previous].selection == member.selection) {
      if (program->members_[previous].take == member.take || program->takes_[program->members_[previous].take].voice != program->takes_[member.take].voice || program->takes_[program->members_[previous].take].anchor != program->takes_[member.take].anchor) return nullptr;
    }
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
  if (!program->prepare_effects(definition, revision)) return nullptr;
  return program;
}

bool Program::prepare_effects(const patches::Rack& definition, uint32_t revision) noexcept {
  for (int id = 0; id < take_count_; ++id) for (const auto& playback : takes_[id].playback)
    if (playback && playback->state() != patches::PlaybackState::idle) return false;
  bool stale = !voices_[0] || !voices_[0]->compatible(definition);
  for (int id = 0; id < take_count_; ++id) for (int bank = 0; bank < 2; ++bank)
    if (bank != takes_[id].latest && (!takes_[id].cache[bank] || takes_[id].cache[bank]->revision() != revision)) stale = true;
  if (!stale) { prepared_revision_ = revision; return true; }
  std::unique_ptr<patches::Rack> voices[PF_CHANNELS], tails[PF_CHANNELS];
  std::unique_ptr<patches::ProcessedTake> caches[PF_COMPILED_MAX_TAKES][2];
  std::unique_ptr<patches::Playback> players[PF_COMPILED_MAX_TAKES][2];
  uint64_t estimated = 0;
  for (int id = 0; id < take_count_; ++id) for (int bank = 0; bank < 2; ++bank)
    if (takes_[id].cache[bank]) estimated += takes_[id].cache[bank]->memory_bytes() + takes_[id].playback[bank]->memory_bytes();
  for (int voice = 0; voice < PF_CHANNELS; ++voice) {
    if (voices_[voice]) estimated += voices_[voice]->memory_bytes();
    if (tails_[voice]) estimated += tails_[voice]->memory_bytes();
    voices[voice] = definition.snapshot(); tails[voice] = definition.snapshot();
    if (!voices[voice] || !tails[voice]) return false;
    estimated += voices[voice]->memory_bytes() + tails[voice]->memory_bytes();
  }
  for (int id = 0; id < take_count_; ++id) for (int bank = 0; bank < 2; ++bank) {
    if (takes_[id].latest == bank || (takes_[id].cache[bank] && takes_[id].cache[bank]->revision() == revision)) continue;
    caches[id][bank] = patches::ProcessedTake::create(definition, takes_[id].capacity, revision, 1);
    if (!caches[id][bank]) return false;
    players[id][bank] = patches::Playback::create(*caches[id][bank], patches::PlaybackMode::evolving);
    if (!players[id][bank]) return false;
    estimated += caches[id][bank]->memory_bytes() + players[id][bank]->memory_bytes();
    if (estimated > 200ULL * 1024 * 1024) return false;
  }
  for (int voice = 0; voice < PF_CHANNELS; ++voice) { voices_[voice] = std::move(voices[voice]); tails_[voice] = std::move(tails[voice]); }
  for (int id = 0; id < take_count_; ++id) for (int bank = 0; bank < 2; ++bank) if (caches[id][bank]) {
    takes_[id].playback[bank].reset();
    takes_[id].cache[bank] = std::move(caches[id][bank]);
    takes_[id].playback[bank] = std::move(players[id][bank]);
  }
  prepared_revision_ = revision;
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
  active_capture_ = {}; live_route_ = -1; phase_ = PF_IDLE; error_ = PF_OK;
  for (int button = 0; button < PF_CHANNELS; ++button) pending_[button] = {};
  for (int voice = 0; voice < PF_CHANNELS; ++voice) { if (voices_[voice]) voices_[voice]->reset(); if (tails_[voice]) tails_[voice]->reset(); drain_[voice] = 0; detached_tail_[voice] = false; tail_generation_[voice] = 0; }
  drain_[PF_CHANNELS] = 0;
  for (int id = 0; id < take_count_; ++id) for (auto& playback : takes_[id].playback) if (playback) playback->reset();
}
void Program::microphone_lost() noexcept {
  if (active_capture_.take >= 0) takes_[active_capture_.take].cache[active_capture_.bank]->reset_for_capture();
  active_capture_ = {}; live_route_ = -1;
  for (int button = 0; button < PF_CHANNELS; ++button) pending_[button] = {};
  for (int voice = 0; voice < PF_CHANNELS; ++voice) { voices_[voice]->reset(); tails_[voice]->reset(); drain_[voice] = 0; detached_tail_[voice] = false; tail_generation_[voice] = 0; }
  drain_[PF_CHANNELS] = 0;
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
int Program::available_bank(int id) const noexcept {
  if (id < 0 || id >= take_count_) return -1;
  const Take& take = takes_[id];
  for (int bank = 0; bank < 2; ++bank) if (bank != take.latest && !(active_capture_.take == id && active_capture_.bank == bank) && take.cache[bank] && take.cache[bank]->revision() == prepared_revision_ && take.playback[bank] && take.playback[bank]->state() == patches::PlaybackState::idle) return bank;
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
  if (live_route_ == voice) return;
  if (live_route_ >= 0 && !history_handed_off) {
    int outgoing = live_route_;
    detached_tail_[outgoing] = active_capture_.take >= 0 && takes_[active_capture_.take].voice == outgoing;
    tail_generation_[outgoing] = detached_tail_[outgoing] ? active_capture_.generation : 0;
    if (detached_tail_[outgoing] && !tails_[outgoing]->copy_state(*voices_[outgoing])) { error_ = PF_ACTION_FAILED; return; }
    drain_[outgoing] = voices_[outgoing]->maximum_tail_frames();
  } else if (live_route_ < 0) drain_[PF_CHANNELS] = std::numeric_limits<uint64_t>::max();
  live_route_ = voice;
  if (voice >= 0) { drain_[voice] = 0; detached_tail_[voice] = false; tail_generation_[voice] = 0; } else drain_[PF_CHANNELS] = 0;
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
    if (take.anchor != cue.take && !(cue.kind == PF_COMMIT_ARM && cue.commit == take.anchor)) {
      if (anchor.latest < 0 || anchor.playback[anchor.latest]->state() != patches::PlaybackState::playing) return PF_LOOP_MISMATCH;
      double period = anchor.cache[anchor.latest]->period();
      double advance = std::max(0.0, std::ceil(anchor_frame_ + (target - anchor_position_) * rate_ * 60 / bpm) - frame);
      double phase = std::fmod(anchor.playback[anchor.latest]->phase() + advance, period);
      if (std::min(phase, period - phase) > 1) return PF_LOOP_MISMATCH;
    }
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
    if (take.playback[take.latest]->state() != patches::PlaybackState::playing) {
      if (!play_take(members_[member].take, members_[member].gain)) return false;
    } else take.playback_gain[take.latest] = take.gain * members_[member].gain;
  }
  selection_[voice] = selection; return true;
}
int Program::execute(int id, double) noexcept {
  const Cue& cue = cues_[id];
  int bank = cue.take >= 0 ? available_bank(cue.take) : -1;
  if (cue.kind == PF_ARM && active_capture_.take >= 0) return PF_CAPTURE_BUSY;
  if ((cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM) && bank < 0) return PF_TAKE_UNAVAILABLE;
  if ((cue.kind == PF_COMMIT || cue.kind == PF_COMMIT_ARM) && active_capture_.take != cue.commit) return error_ = PF_NO_RECORDING;
  if (cue.kind == PF_COMMIT || cue.kind == PF_COMMIT_ARM) {
    Take& take = takes_[active_capture_.take];
    uint32_t period = 0;
    if (!commit_period(active_capture_.take, period)) {
      take.cache[active_capture_.bank]->reset_for_capture();
      active_capture_ = {}; if (live_route_ == cue.voice) switch_route(-1);
      return error_ = PF_LOOP_MISMATCH;
    }
    if (!take.cache[active_capture_.bank]->commit(period)) return error_ = PF_NO_RECORDING;
    if (take.latest >= 0) take.playback[take.latest]->stop();
    uint64_t completed_generation = active_capture_.generation;
    take.latest = active_capture_.bank; active_capture_ = {};
    if (!take.playback[take.latest]->start_at_capture_end(true)) return error_ = PF_ACTION_FAILED;
    // END playback owns this source epoch. Related monitor clones retire, while
    // other voices and unrelated detached histories keep their own tails.
    if (tail_generation_[cue.voice] == completed_generation) { drain_[cue.voice] = 0; tail_generation_[cue.voice] = 0; }
    voices_[cue.voice]->reset();
    if (cue.selection >= 0) {
      if (!select(cue.voice, cue.selection, false)) return error_ = PF_NO_SAMPLE;
    } else if (!play_take(cue.commit)) return error_ = PF_NO_SAMPLE;
    if (cue.kind == PF_COMMIT && live_route_ == cue.voice) switch_route(-1, true);
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
void Program::apply_pending(double frame, double bpm) noexcept {
  remember_cues(frame, bpm);
  double now = position(frame, bpm);
  query_position_ = now; query_frame_ = frame;
  // All releases at a shared frame precede every independent capture start.
  for (int pass = 0; pass < 2; ++pass) for (int button = 0; button < PF_CHANNELS; ++button) {
    if (pending_[button].cue < 0) continue;
    int cue = pending_[button].cue;
    bool commits = cues_[cue].kind == PF_COMMIT || cues_[cue].kind == PF_COMMIT_ARM;
    if (commits != (pass == 0) || frame < std::ceil(anchor_frame_ + (pending_[button].position - anchor_position_) * rate_ * 60 / bpm)) continue;
    pending_[button] = {};
    int result = execute(cue, frame);
    if (result != PF_OK) {
      bool admission = result == PF_CAPTURE_BUSY || result == PF_TAKE_UNAVAILABLE || result == PF_NO_RECORDING || result == PF_NO_SAMPLE || result == PF_LOOP_MISMATCH;
      if (!admission) { stop(); error_ = PF_ACTION_FAILED; return; }
      error_ = PF_OK;
      if (outcome_) outcome_(outcome_context_, frame, button, cue, result);
    } else if (observer_) observer_(observer_context_, frame);
  }
}
void Program::beat(int phase, int bar, int beat, int count_remaining, double frame, double bpm) noexcept {
  remember_cues(frame, bpm);
  bool wrap = phase == PF_PLAYING && phase_ == PF_PLAYING && bar < bar_;
  if (wrap) {
    apply_pending(std::ceil(frame), bpm);
    for (int id = 0; id < cue_count_; ++id) { cues_[id].used = false; cues_[id].occurred_frame = std::numeric_limits<double>::quiet_NaN(); }
  }
  phase_ = phase; bar_ = phase == PF_COUNT_IN ? 0 : bar;
  bpm_ = bpm; anchor_frame_ = frame; anchor_position_ = phase == PF_COUNT_IN ? (start_ - 1) * beats_ - count_remaining : (bar - 1) * beats_ + beat - 1;
  query_position_ = anchor_position_;
  apply_pending(std::ceil(frame), bpm);
  if (phase == PF_PLAYING && beat == 1) for (int id = 0; id < playback_count_; ++id) if (playback_[id].bar == bar) select(playback_[id].voice, playback_[id].selection, true);
}
void Program::render(const float* input, float* left, float* right, float* live_left, float* live_right,
  uint32_t frames, double frame, double bpm, bool live, patches::Rack& default_rack) noexcept {
  bpm_ = bpm;
  for (uint32_t offset = 0; offset < frames; ++offset) {
    apply_pending(frame + offset, bpm);
    float source = input && std::isfinite(input[offset]) ? input[offset] : 0;
    patches::Stereo current{}, monitor{};
    if (live && (phase_ == PF_COUNT_IN || phase_ == PF_PLAYING)) {
      int recording_voice = active_capture_.take >= 0 ? takes_[active_capture_.take].voice : -1;
      patches::Rack& monitor_rack = live_route_ < 0 ? default_rack : *voices_[live_route_];
      current = monitor_rack.process({source, source}); monitor = current;
      patches::Stereo captured = current;
      if (recording_voice >= 0 && recording_voice != live_route_) captured = voices_[recording_voice]->process({source, source});
      for (int voice = 0; voice < PF_CHANNELS; ++voice) if (voice != live_route_ && drain_[voice]) {
        patches::Rack& rack = detached_tail_[voice] ? *tails_[voice] : *voices_[voice];
        patches::Stereo tail = rack.process({}); --drain_[voice]; monitor.left += tail.left; monitor.right += tail.right;
      }
      if (live_route_ >= 0 && drain_[PF_CHANNELS]) {
        if (drain_[PF_CHANNELS] == std::numeric_limits<uint64_t>::max()) drain_[PF_CHANNELS] = default_rack.maximum_tail_frames();
        if (drain_[PF_CHANNELS]) { patches::Stereo tail = default_rack.process({}); --drain_[PF_CHANNELS]; monitor.left += tail.left; monitor.right += tail.right; }
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
  if (id >= uint32_t(take_count_)) return;
  const Take& take = takes_[id]; int bank = active_capture_.take == int(id) ? active_capture_.bank : take.latest >= 0 ? take.latest : 0;
  out[PF_TAKE_VOICE] = take.voice; out[PF_TAKE_READY] = take.latest >= 0;
  out[PF_TAKE_PERIOD] = take.cache[bank]->period();
  out[PF_TAKE_LENGTH] = take.cache[bank]->length(); out[PF_TAKE_CAPACITY] = take.capacity;
  out[PF_TAKE_REVISION] = double(take.cache[bank]->revision());
  out[PF_TAKE_PHASE] = take.playback[bank]->phase(); out[PF_TAKE_PLAYBACK_STATE] = int(take.playback[bank]->state());
}
}
