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
bool point(double value, int beats) { return std::isfinite(value) && value >= 0 && value <= beats && std::floor(value * 960) == value * 960; }
double cue_boundary(int bar, double cue, int timing, double execute, int beats) {
  if (timing == 1) return bar * beats;
  return (std::max(1, bar) - 1) * beats + (timing == 2 ? execute : std::max(0.0, cue));
}
}
struct Program::Take {
  int voice = 0, latest = -1;
  double begin = 0, end = 0, gain = 1;
  uint32_t capacity = 0;
  double playback_gain[2]{1, 1};
  std::unique_ptr<patches::ProcessedTake> cache[2];
  std::unique_ptr<patches::Playback> playback[2];
};
struct Program::Cue {
  int button = 0, voice = 0, bar = 0, kind = PF_NONE, timing = 0, take = -1, commit = -1, selection = -1;
  double cue = -1, execute = 0;
  bool used = false;
};
struct Program::Member { int selection = 0, take = 0; double gain = 1; };
struct Program::PlaybackCue { int bar = 1, voice = 0, selection = 0; };
struct Program::Pending { int cue = -1; double position = 0; };

Program::~Program() = default;
std::unique_ptr<Program> Program::create(const double* data, uint32_t fields, double rate, const patches::Rack& definition, uint32_t revision) noexcept {
  if (!data || fields < PF_COMPILED_HEADER_FIELDS || data[0] != PF_COMPILED_MAGIC || data[1] != PF_COMPILED_VERSION
    || !whole(data[2], 6) || (data[2] != 4 && data[2] != 6) || !whole(data[3], PF_MAX_BARS) || data[3] < 1
    || !std::isfinite(data[4]) || data[4] < 40 || data[4] > 240 || !whole(data[5], data[3]) || data[5] < 1
    || !std::isfinite(data[6]) || data[6] < 0 || data[6] > data[2] || !std::isfinite(data[7]) || data[7] < 0 || data[7] > data[2]
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
      || !whole(row[3], program->bars_ + 1) || row[3] < 1 || !point(row[4], program->beats_) || (row[3] == program->bars_ + 1 && row[4] != 0) || !std::isfinite(row[5]) || row[5] < 0 || row[5] > 4) return nullptr;
    Take& take = program->takes_[id]; take.voice = int(row[0]); take.begin = (row[1] - 1) * program->beats_ + row[2]; take.end = (row[3] - 1) * program->beats_ + row[4]; take.gain = row[5];
    double capacity = std::ceil((take.end - take.begin) * rate * 60 / 40);
    if (capacity < 1 || capacity > rate * 30 || capacity > std::numeric_limits<uint32_t>::max()) return nullptr;
    take.capacity = uint32_t(capacity); pcm_bytes += uint64_t(take.capacity) * (sizeof(patches::Stereo) + sizeof(float)) * 2;
  }
  if (pcm_bytes > 180ULL * 1024 * 1024) return nullptr;
  for (int id = 0; id < program->cue_count_; ++id, offset += PF_COMPILED_CUE_FIELDS) {
    const double* row = data + offset;
    if (!index(row[0], PF_CHANNELS) || !index(row[1], PF_CHANNELS) || !whole(row[2], program->bars_)
      || !(row[3] == -1 || point(row[3], program->beats_)) || !whole(row[4], PF_PLAY) || row[4] < PF_ARM
      || !whole(row[5], 2) || !point(row[6], program->beats_) || !index(row[7], program->take_count_, true) || !index(row[8], program->take_count_, true)
      || !whole(row[9] + 1, PF_MAX_EVENTS)) return nullptr;
    Cue& cue = program->cues_[id]; cue.button = int(row[0]); cue.voice = int(row[1]); cue.bar = int(row[2]); cue.cue = row[3]; cue.kind = int(row[4]);
    cue.timing = int(row[5]); cue.execute = row[6]; cue.take = int(row[7]); cue.commit = int(row[8]); cue.selection = int(row[9]);
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
      if (program->members_[previous].take == member.take || program->takes_[program->members_[previous].take].voice != program->takes_[member.take].voice) return nullptr;
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
  std::unique_ptr<patches::Rack> voices[PF_CHANNELS];
  std::unique_ptr<patches::ProcessedTake> caches[PF_COMPILED_MAX_TAKES][2];
  std::unique_ptr<patches::Playback> players[PF_COMPILED_MAX_TAKES][2];
  uint64_t estimated = 0;
  for (int voice = 0; voice < PF_CHANNELS; ++voice) { voices[voice] = definition.snapshot(); if (!voices[voice]) return false; }
  for (int id = 0; id < take_count_; ++id) for (int bank = 0; bank < 2; ++bank) {
    if (takes_[id].latest == bank || (takes_[id].cache[bank] && takes_[id].cache[bank]->revision() == revision)) continue;
    caches[id][bank] = patches::ProcessedTake::create(definition, takes_[id].capacity, revision, 1);
    if (!caches[id][bank]) return false;
    players[id][bank] = patches::Playback::create(*caches[id][bank], patches::PlaybackMode::evolving);
    if (!players[id][bank]) return false;
    estimated += caches[id][bank]->memory_bytes() + players[id][bank]->memory_bytes();
    if (estimated > 200ULL * 1024 * 1024) return false;
  }
  for (int voice = 0; voice < PF_CHANNELS; ++voice) voices_[voice] = std::move(voices[voice]);
  for (int id = 0; id < take_count_; ++id) for (int bank = 0; bank < 2; ++bank) if (caches[id][bank]) {
    takes_[id].playback[bank].reset();
    takes_[id].cache[bank] = std::move(caches[id][bank]);
    takes_[id].playback[bank] = std::move(players[id][bank]);
  }
  prepared_revision_ = revision;
  return true;
}
void Program::start(int start_bar, int count_in_beats, double frame) noexcept {
  stop(); start_ = start_bar; phase_ = count_in_beats ? PF_COUNT_IN : PF_PLAYING; bar_ = count_in_beats ? 0 : start_bar;
  anchor_frame_ = frame; anchor_position_ = (start_bar - 1) * beats_ - count_in_beats - 1;
  query_position_ = anchor_position_; query_frame_ = frame;
  for (int id = 0; id < cue_count_; ++id) cues_[id].used = false;
  for (int voice = 0; voice < PF_CHANNELS; ++voice) suppressed_[voice] = false;
}
void Program::stop() noexcept {
  if (capturing_ >= 0) {
    Take& take = takes_[capturing_];
    if (take.cache[capture_bank_]->commit()) take.latest = capture_bank_;
    else take.cache[capture_bank_]->reset_for_capture();
  }
  owner_ = capturing_ = capture_bank_ = route_ = -1; phase_ = PF_IDLE; error_ = PF_OK;
  for (int button = 0; button < PF_CHANNELS; ++button) pending_[button].cue = -1;
  for (int voice = 0; voice < PF_CHANNELS; ++voice) { if (voices_[voice]) voices_[voice]->reset(); drain_[voice] = 0; }
  drain_[PF_CHANNELS] = 0;
  for (int id = 0; id < take_count_; ++id) for (auto& playback : takes_[id].playback) if (playback) playback->reset();
}
void Program::microphone_lost() noexcept {
  if (capturing_ >= 0) takes_[capturing_].cache[capture_bank_]->reset_for_capture();
  owner_ = capturing_ = capture_bank_ = route_ = -1;
  for (int button = 0; button < PF_CHANNELS; ++button) pending_[button].cue = -1;
  for (int voice = 0; voice < PF_CHANNELS; ++voice) { voices_[voice]->reset(); drain_[voice] = 0; }
  drain_[PF_CHANNELS] = 0;
}
double Program::position(double frame, double bpm) const noexcept { return anchor_position_ + (frame - anchor_frame_) * bpm / (rate_ * 60); }
int Program::available_bank(int id) const noexcept {
  if (id < 0 || id >= take_count_) return -1;
  const Take& take = takes_[id];
  for (int bank = 0; bank < 2; ++bank) if (bank != take.latest && !(capturing_ == id && capture_bank_ == bank) && take.cache[bank] && take.cache[bank]->revision() == prepared_revision_ && take.playback[bank] && take.playback[bank]->state() == patches::PlaybackState::idle) return bank;
  return -1;
}
void Program::switch_route(int voice) noexcept {
  if (route_ == voice) return;
  if (route_ >= 0) drain_[route_] = voices_[route_]->maximum_tail_frames();
  else drain_[PF_CHANNELS] = std::numeric_limits<uint64_t>::max();
  route_ = voice;
  if (voice >= 0) drain_[voice] = 0; else drain_[PF_CHANNELS] = 0;
}
int Program::press(int button, double frame, double bpm, bool microphone) noexcept {
  if (button < 0 || button >= PF_CHANNELS || phase_ == PF_IDLE || phase_ == PF_ENDED) return PF_INVALID_CHANNEL;
  error_ = PF_OK;
  double now = position(frame, bpm), best = std::numeric_limits<double>::infinity(); int found = -1;
  for (int id = 0; id < cue_count_; ++id) {
    const Cue& cue = cues_[id]; if (cue.button != button) continue;
    bool applicable = cue.cue < 0 ? cue.bar == bar_ : phase_ == PF_PLAYING && now >= (cue.bar - 1) * beats_ + cue.cue - early_ - epsilon && now <= (cue.bar - 1) * beats_ + cue.cue + late_ + epsilon;
    if (!applicable) continue;
    double distance = cue.cue < 0 ? 0 : std::abs(now - ((cue.bar - 1) * beats_ + cue.cue));
    if (distance < best) { found = id; best = distance; }
  }
  int voice = binding_[button];
  if (found < 0) {
    VoiceInfo info = channel_info(button, bpm);
    if (!info.ready) return PF_NO_SAMPLE;
    if (info.looping) { stop_voice(voice, false); suppressed_[voice] = true; return PF_OK; }
    suppressed_[voice] = false;
    if (selection_[voice] >= 0) return select(voice, selection_[voice], false) ? PF_OK : PF_NO_SAMPLE;
    for (int id = take_count_ - 1; id >= 0; --id) if (takes_[id].voice == voice && takes_[id].latest >= 0) return play_take(id) ? PF_OK : PF_NO_SAMPLE;
    return PF_NO_SAMPLE;
  }
  Cue& cue = cues_[found]; if (cue.used || pending_[button].cue == found) return PF_OK;
  if (cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM) {
    if (!microphone) return PF_MICROPHONE_REQUIRED;
    if (owner_ >= 0 && owner_ != cue.voice) return PF_CAPTURE_BUSY;
    if (cue.kind == PF_ARM && (owner_ >= 0 || capturing_ >= 0)) return PF_CAPTURE_BUSY;
    if (cue.kind == PF_COMMIT_ARM && (capturing_ != cue.commit || owner_ != cue.voice)) return PF_NO_RECORDING;
    if (available_bank(cue.take) < 0) return PF_TAKE_UNAVAILABLE;
  }
  if (cue.kind == PF_COMMIT && capturing_ != cue.commit) return PF_NO_RECORDING;
  if (cue.kind == PF_PLAY && cue.selection >= 0 && !selection_ready(cue.selection, cue.voice)) return PF_NO_SAMPLE;
  double target = now;
  if (cue.timing == 1) target = phase_ == PF_COUNT_IN ? (start_ - 1) * beats_ : (std::floor(now / beats_) + 1) * beats_;
  if (cue.timing == 2) target = (cue.bar - 1) * beats_ + cue.execute;
  if (target < now - epsilon) return PF_CUE_LATE;
  if (cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM) { owner_ = cue.voice; switch_route(cue.voice); }
  if (target <= now + epsilon) {
    int result = execute(found, frame);
    if (result != PF_OK) return result;
  } else { pending_[button].cue = found; pending_[button].position = target; }
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
  if ((cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM) && bank < 0) return error_ = PF_ACTION_FAILED;
  if ((cue.kind == PF_COMMIT || cue.kind == PF_COMMIT_ARM) && capturing_ != cue.commit) return error_ = PF_NO_RECORDING;
  if (cue.kind == PF_COMMIT || cue.kind == PF_COMMIT_ARM) {
    Take& take = takes_[capturing_];
    if (!take.cache[capture_bank_]->commit()) return error_ = PF_NO_RECORDING;
    if (take.latest >= 0) take.playback[take.latest]->stop();
    take.latest = capture_bank_; capturing_ = capture_bank_ = -1;
    if (cue.selection >= 0) {
      if (!select(cue.voice, cue.selection, false)) return error_ = PF_NO_SAMPLE;
    } else if (!play_take(cue.commit)) return error_ = PF_NO_SAMPLE;
    if (cue.kind == PF_COMMIT) { owner_ = -1; switch_route(-1); }
  }
  if (cue.kind == PF_ARM || cue.kind == PF_COMMIT_ARM) {
    Take& take = takes_[cue.take];
    if (!take.cache[bank]->reset_for_capture() || !take.cache[bank]->begin(*voices_[cue.voice])) return error_ = PF_ACTION_FAILED;
    capturing_ = cue.take; capture_bank_ = bank; owner_ = cue.voice; switch_route(cue.voice);
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
  double now = position(frame, bpm);
  query_position_ = now; query_frame_ = frame;
  for (int button = 0; button < PF_CHANNELS; ++button) if (pending_[button].cue >= 0
    && frame >= std::ceil(anchor_frame_ + (pending_[button].position - anchor_position_) * rate_ * 60 / bpm)) {
    int cue = pending_[button].cue; pending_[button].cue = -1;
    if (execute(cue, frame) != PF_OK) { stop(); error_ = PF_ACTION_FAILED; return; }
    if (observer_) observer_(observer_context_, frame);
  }
}
void Program::beat(int phase, int bar, int beat, int count_remaining, double frame, double bpm) noexcept {
  bool wrap = phase == PF_PLAYING && phase_ == PF_PLAYING && bar < bar_;
  if (wrap) {
    apply_pending(std::ceil(frame), bpm);
    for (int id = 0; id < cue_count_; ++id) cues_[id].used = false;
  }
  phase_ = phase; bar_ = phase == PF_COUNT_IN ? 0 : bar;
  anchor_frame_ = frame; anchor_position_ = phase == PF_COUNT_IN ? (start_ - 1) * beats_ - count_remaining : (bar - 1) * beats_ + beat - 1;
  query_position_ = anchor_position_;
  apply_pending(std::ceil(frame), bpm);
  if (phase == PF_PLAYING && beat == 1) for (int id = 0; id < playback_count_; ++id) if (playback_[id].bar == bar) select(playback_[id].voice, playback_[id].selection, true);
}
void Program::render(const float* input, float* left, float* right, float* live_left, float* live_right,
  uint32_t frames, double frame, double bpm, bool live, patches::Rack& default_rack) noexcept {
  for (uint32_t offset = 0; offset < frames; ++offset) {
    apply_pending(frame + offset, bpm);
    float source = input && std::isfinite(input[offset]) ? input[offset] : 0;
    patches::Stereo current{}, monitor{};
    if (live && (phase_ == PF_COUNT_IN || phase_ == PF_PLAYING)) {
      patches::Rack& rack = route_ < 0 ? default_rack : *voices_[route_];
      current = rack.process({source, source}); monitor = current;
      for (int voice = 0; voice < PF_CHANNELS; ++voice) if (voice != route_ && drain_[voice]) {
        patches::Stereo tail = voices_[voice]->process({}); --drain_[voice]; monitor.left += tail.left; monitor.right += tail.right;
      }
      if (route_ >= 0 && drain_[PF_CHANNELS]) {
        if (drain_[PF_CHANNELS] == std::numeric_limits<uint64_t>::max()) drain_[PF_CHANNELS] = default_rack.maximum_tail_frames();
        if (drain_[PF_CHANNELS]) { patches::Stereo tail = default_rack.process({}); --drain_[PF_CHANNELS]; monitor.left += tail.left; monitor.right += tail.right; }
      }
      if (capturing_ >= 0) {
        auto& cache = takes_[capturing_].cache[capture_bank_];
        if (!cache->append_processed(rack, &source, &source, &current.left, &current.right, 1)) { stop(); error_ = PF_ACTION_FAILED; }
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
  if (capturing_ >= 0 && takes_[capturing_].voice == voice) info.status = PF_RECORDING;
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
    double at = (cue.bar - 1) * beats_ + cue.cue;
    if ((cue.cue < 0 && cue.bar == bar_) || (cue.cue >= 0 && query_position_ >= at - early_ && query_position_ <= at + late_)) { info.light = PF_CUE; break; }
  }
  return info;
}
void Program::take_info(uint32_t id, double* out) const noexcept {
  if (!out) return;
  std::fill(out, out + PF_TAKE_FIELDS, 0);
  if (id >= uint32_t(take_count_)) return;
  const Take& take = takes_[id]; int bank = capturing_ == int(id) ? capture_bank_ : take.latest >= 0 ? take.latest : 0;
  out[PF_TAKE_VOICE] = take.voice; out[PF_TAKE_READY] = take.latest >= 0;
  out[PF_TAKE_LENGTH] = take.cache[bank]->length(); out[PF_TAKE_CAPACITY] = take.capacity;
  out[PF_TAKE_REVISION] = double(take.cache[bank]->revision());
  out[PF_TAKE_PHASE] = take.playback[bank]->phase(); out[PF_TAKE_PLAYBACK_STATE] = int(take.playback[bank]->state());
}
}
