#include "performance_engine.h"
#include "patch_engine.h"
#include "../src/compiled_program.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <vector>

namespace {
bool watch_heap = false;
uint64_t heap_allocations = 0, heap_frees = 0;
}
void* operator new(std::size_t size) {
  if (watch_heap) ++heap_allocations;
  if (void* result = std::malloc(size ? size : 1)) return result;
  std::abort();
}
void* operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void* pointer) noexcept { if (watch_heap && pointer) ++heap_frees; std::free(pointer); }
void operator delete[](void* pointer) noexcept { ::operator delete(pointer); }

namespace {
void require(bool condition, const char* message) { if (!condition) { std::fprintf(stderr, "%s\n", message); std::abort(); } }
void ok(pf_engine* engine, int result) { if (result < 0) { double details[PF_FIELDS]; pf_snapshot(engine, details); std::fprintf(stderr, "bar %.0f beat %.0f frame %.0f: %s\n", details[PF_BAR_NUMBER], details[PF_BEAT_NUMBER], details[PF_FRAME], pf_error(engine)); std::abort(); } }
std::array<double, PF_FIELDS> state(pf_engine* engine) { std::array<double, PF_FIELDS> out{}; pf_snapshot(engine, out.data()); return out; }
std::array<double, PF_TAKE_FIELDS> take(pf_engine* engine, int id) { std::array<double, PF_TAKE_FIELDS> out{}; pf_compiled_take_info(engine, id, out.data()); return out; }
std::array<double, PF_CHANNEL_FIELDS> channel(pf_engine* engine, int id) { std::array<double, PF_CHANNEL_FIELDS> out{}; pf_channel_info(engine, id, out.data()); return out; }
struct Engine {
  pf_engine* value;
  explicit Engine(double rate = 8000) : value(pf_create(rate, PF_PRACTICE, 32, 30, 4)) { require(value, "engine creation"); ok(value, pf_set_jiggle_thresholds(value, 1, 1)); }
  ~Engine() { pf_destroy(value); }
  operator pf_engine*() { return value; }
};
std::vector<double> table(int beats = 4) {
  std::vector<double> data{PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, double(beats), 4, 120, 4, 25, 25, 3, 7, 4, 0, 0, 1, 2, 3};
  const double takes[] = {0, 1, 0, 2, 0, 1, 2, 0, 0, 0, 2, 0, 3, 0, 1, 3, 0, 0, 1, 3, 0, 4, 0, 1, 4, 0, 2};
  data.insert(data.end(), std::begin(takes), std::end(takes));
  const double cues[] = {
    0, 0, 0, -1, PF_ARM, 1, 0, 0, -1, -1, 0,
    0, 0, 1, -1, PF_COMMIT_ARM, 1, 0, 1, 0, 0, 0,
    0, 0, 2, -1, PF_COMMIT, 1, 0, -1, 1, 1, 0,
    1, 1, 2, -1, PF_ARM, 1, 0, 2, -1, -1, 0,
    0, 0, 3, 3, PF_STOP, 2, 3.25, -1, -1, -1, 0,
    1, 1, 3, -1, PF_COMMIT, 1, 0, -1, 2, 2, 0,
    0, 0, 4, -1, PF_PLAY, 0, 0, -1, -1, 0, 0
  };
  data.insert(data.end(), std::begin(cues), std::end(cues));
  const double members[] = {0, 0, 1, 1, 0, 1, 1, 1, 1, 2, 2, 1};
  data.insert(data.end(), std::begin(members), std::end(members));
  return data;
}
void prepare(pf_engine* engine, const std::vector<double>& data, uint32_t revision = 1) {
  pf_effect_definition effect{PF_EFFECT_SLAPBACK, 1, {{100, 0, .25}}};
  ok(engine, pf_prepare_live_effects(engine, &effect, 1, revision));
  ok(engine, pf_configure_compiled(engine, data.data(), uint32_t(data.size())));
  ok(engine, pf_set_click_gain(engine, 0)); ok(engine, pf_set_microphone(engine, 1));
}
struct Block { std::vector<float> left, right, live_left, live_right; };
Block render(pf_engine* engine, uint32_t frames, float input = .25f) {
  Block out{std::vector<float>(frames), std::vector<float>(frames), std::vector<float>(frames), std::vector<float>(frames)};
  std::vector<float> source(frames, input);
  ok(engine, pf_process_stems(engine, source.data(), out.left.data(), out.right.data(), out.live_left.data(), out.live_right.data(), frames));
  return out;
}
void until(pf_engine* engine, int bar, int beat = 1) {
  for (int count = 0; count < 2000000; ++count) {
    auto now = state(engine);
    if (now[PF_PHASE] == PF_PLAYING && now[PF_BAR_NUMBER] == bar && now[PF_BEAT_NUMBER] == beat) return;
    render(engine, 1);
  }
  require(false, "transport reached requested bar and beat");
}
int press(pf_engine* engine, int button) { return pf_control(engine, button, 0, nullptr, 0); }
void tambourine_audition_uses_sample_output() {
  Engine engine(48000);
  require(pf_audition_tambourine(engine, 0, -1) < 0, "audition needs a compiled song");
  const auto song = table();
  prepare(engine, song);
  ok(engine, pf_set_microphone(engine, 0));
  auto silent = [](const auto& pcm) {
    return std::all_of(pcm.begin(), pcm.end(), [](float sample) { return sample == 0; });
  };
  auto arm = [&] { ok(engine, pf_audition_tambourine(engine, 0, -1)); };
  auto hit = [&] { ok(engine, pf_audition_tambourine(engine, 96, -1)); };
  auto disarmed = [&] {
    require(pf_audition_tambourine(engine, 96, -1) < 0, "changes invalidate the previous audition");
    const auto out = render(engine, 128);
    require(silent(out.left) && silent(out.right), "changes cancel the pending hit and its tail");
  };
  require(!pf_audio_needed(engine) && pf_audition_tambourine(engine, 96, -1) < 0, "unarmed hit is rejected");
  arm();
  require(!pf_audio_needed(engine), "arming alone does not need audio");
  require(silent(render(engine, 128).left), "arming does not play a hit");
  require(pf_audition_tambourine(engine, -2, -1) < 0 && pf_audition_tambourine(engine, 128, -1) < 0, "out-of-range velocities reject");

  std::array<float, 128> left{}, right{}, live_left{}, live_right{};
  uint32_t song_offset = 128, song_frames = 128;
  heap_allocations = heap_frees = 0; watch_heap = true;
  hit();
  const bool needs_audio = pf_audio_needed(engine);
  const int result = pf_process_stems_with_song_span(engine, nullptr, left.data(), right.data(), live_left.data(), live_right.data(),
    left.size(), &song_offset, &song_frames);
  watch_heap = false;
  ok(engine, result);
  require(needs_audio, "a hit needs audio even without a microphone");
  require(heap_allocations == 0 && heap_frees == 0, "hits and rendering do no heap work");
  require(left.front() != 0 && right.front() != 0 && left != right, "a hit starts on the next rendered frame in stereo");
  require(silent(live_left) && silent(live_right) && song_offset == 0 && song_frames == 0, "the audition stays out of live input and the demo recording");
  require(state(engine)[PF_PHASE] == PF_IDLE && !take(engine, 0)[PF_TAKE_READY], "the audition leaves transport and capture idle");
  arm();
  require(!silent(render(engine, 128).left), "arming twice preserves a playing tail");
  ok(engine, pf_audition_tambourine(engine, -1, -1));
  disarmed();
  require(!pf_audio_needed(engine), "ending the audition releases idle audio");
  arm(); hit();
  require(!silent(render(engine, 12000).left) && !pf_audio_needed(engine) && silent(render(engine, 128).left),
    "once the hit ends, the armed audition releases idle audio");
  hit(); pf_stop(engine); disarmed();
  arm(); hit(); ok(engine, press(engine, 4)); disarmed();
  arm(); hit(); ok(engine, pf_configure_compiled(engine, song.data(), uint32_t(song.size()))); disarmed();
  arm(); hit(); ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0)); disarmed();
  heap_allocations = heap_frees = 0; watch_heap = true;
  arm(); hit();
  left.fill(0); right.fill(0);
  const int active_result = pf_process_stems_with_song_span(engine, nullptr, left.data(), right.data(), live_left.data(), live_right.data(),
    left.size(), &song_offset, &song_frames);
  ok(engine, pf_audition_tambourine(engine, -1, -1));
  watch_heap = false;
  ok(engine, active_result);
  require(!silent(left) && !silent(right), "audition mixes a hit during the count-in");
  require(heap_allocations == 0 && heap_frees == 0, "arming and ending a prepared audition during transport do no heap work");
  require(state(engine)[PF_PHASE] == PF_COUNT_IN, "ending the audition leaves the count-in running");
}
void committed_sample_exports_are_bounded_and_owned() {
  for (double rate : {8000., 48000.}) {
    Engine engine(rate); prepare(engine, table());
    std::array<float, 128> pcm{}; pcm.fill(-9);
    require(pf_copy_take_audio(engine, 0, 0, 64, pcm.data()) < 0, "uncaptured source cannot export");
    ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 1)); ok(engine, press(engine, 0));
    until(engine, 1); ok(engine, press(engine, 0)); until(engine, 2);
    require(pf_copy_take_audio(engine, 0, 0, 64, pcm.data()) < 0, "running export rejects without racing capture");
    pf_stop(engine);
    const auto retained = take(engine, 0);
    heap_allocations = heap_frees = 0; watch_heap = true;
    const int copied = pf_copy_take_audio(engine, 0, 0, 64, pcm.data());
    watch_heap = false;
    require(copied == 64 && heap_allocations == 0 && heap_frees == 0, "bounded committed export does no heap work");
    require(std::all_of(pcm.begin(), pcm.end(), [](float value) { return std::abs(value - .3125f) < 1e-6; }), "export copies committed stereo effects PCM exactly");
    const auto saved = pcm;
    require(pf_copy_take_audio(engine, 0, uint32_t(retained[PF_TAKE_LENGTH])-1, 64, pcm.data()) < 0 && pcm == saved,
      "out-of-range export preserves caller buffer");
    require(pf_copy_take_audio(engine, 0, 0, 4097, pcm.data()) < 0 && pcm == saved, "oversized chunk rejects before writing");
    require(pf_copy_take_audio(engine, 31, 0, 1, pcm.data()) < 0 && take(engine, 0) == retained, "unknown take export preserves native state");
    ok(engine, pf_start(engine, 120, 0, 1, 4, 0, 1)); render(engine, 128, .8f);
    require(pcm == saved, "exported storage belongs to caller across subsequent processing");
  }
}
void capture_layers_and_boundaries() {
  Engine engine; prepare(engine, table()); ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0));
  ok(engine, press(engine, 0));
  require(take(engine, 0)[PF_TAKE_LENGTH] == 0, "arming does not capture pre-boundary audio");
  until(engine, 1);
  auto start = state(engine)[PF_FRAME];
  ok(engine, press(engine, 0));
  until(engine, 2);
  require(take(engine, 0)[PF_TAKE_LENGTH] == 16000, "commit-arm retains exact complete first measure");
  require(take(engine, 0)[PF_TAKE_REVISION] == 1 && take(engine, 1)[PF_TAKE_LENGTH] <= 1, "warm take provenance and next capture boundary");
  auto first = render(engine, 1);
  require(std::abs(first.left[0] - .3125f) < 1e-6 && first.left == first.right, "commit autoplays processed mono-to-stereo take once");
  ok(engine, press(engine, 0));
  until(engine, 3);
  require(take(engine, 1)[PF_TAKE_LENGTH] == 16000, "second measure commits without overwriting first");
  auto layered = render(engine, 8);
  require(std::all_of(layered.left.begin(), layered.left.end(), [](float value) { return std::abs(value - .625f) < 1e-6; }), "explicit selection plays both processed layers");
  require(layered.left == layered.right, "layer playback preserves stereo");
  ok(engine, pf_set_microphone(engine, 0));
  auto lost = render(engine, 8);
  require(std::all_of(lost.left.begin(), lost.left.end(), [](float value) { return std::abs(value - .625f) < 1e-6; }), "microphone loss preserves existing cached loops");
  require(std::all_of(lost.live_left.begin(), lost.live_left.end(), [](float value) { return value == 0; }), "microphone loss gates only live input and capture");
  ok(engine, pf_set_microphone(engine, 1));
  auto restored = render(engine, 8);
  require(std::all_of(restored.live_left.begin(), restored.live_left.end(), [](float value) { return value == 0; }), "microphone readiness cannot reauthorize live processing");
  until(engine, 3, 4); ok(engine, press(engine, 0));
  auto clock = state(engine);
  auto remaining = uint32_t(compiled::boundary_frame(clock[PF_CLOCK_BEAT_FRAME] + 1000) - clock[PF_FRAME]);
  auto scheduled = channel(engine, 0);
  require(scheduled[PF_CHANNEL_LIGHT] == PF_RELEASING && scheduled[PF_CHANNEL_RELEASE_MS] > 0, "scheduled stop reports a diminishing release countdown");
  auto stop = render(engine, remaining + 1);
  require(std::abs(stop.left[remaining - 1] - .625f) < 1e-6, "fractional stop does not run before 4e");
  require(std::abs(stop.left[remaining] - .125f) < 1e-6, "fractional stop starts natural release exactly at 4e");
  auto releasing = channel(engine, 0);
  require(releasing[PF_CHANNEL_LIGHT] == PF_RELEASING && releasing[PF_CHANNEL_STATUS] == PF_STOPPING && !releasing[PF_CHANNEL_LOOPING] && releasing[PF_CHANNEL_RELEASE_MS] > 0, "audible layered tails retain release light after individual stop");
  auto half_tail = render(engine, 399);
  auto halfway = channel(engine, 0);
  require(half_tail.left.back() != 0 && halfway[PF_CHANNEL_LIGHT] == PF_RELEASING && halfway[PF_CHANNEL_RELEASE_MS] > 0 && halfway[PF_CHANNEL_RELEASE_MS] < releasing[PF_CHANNEL_RELEASE_MS], "release countdown decreases with rendered tail frames");
  auto ended = render(engine, 401);
  auto released = channel(engine, 0);
  require(ended.left.back() == 0 && released[PF_CHANNEL_LIGHT] == PF_OFF && released[PF_CHANNEL_RELEASE_MS] == 0, "effected playback tail drains and release light turns off");
  require(state(engine)[PF_FRAME] > start, "one native clock advances all operations");
  pf_stop(engine);
  auto silent = render(engine, 1000);
  require(std::all_of(silent.left.begin(), silent.left.end(), [](float value) { return value == 0; }) && std::all_of(silent.live_left.begin(), silent.live_left.end(), [](float value) { return value == 0; }), "global Stop gates cached and live audio");
  auto retained = take(engine, 0);
  pf_effect_definition edited{PF_EFFECT_SLAPBACK, 1, {{80, 0, .5}}};
  ok(engine, pf_prepare_live_effects(engine, &edited, 1, 2));
  require(take(engine, 0) == retained, "venue edit preserves latest committed PCM, phase and captured revision");
}
void authored_capture_end_finishes_without_finish_press() {
  for (double rate : {8000., 44100., 48000.}) {
    Engine engine(rate); prepare(engine, table());
    ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0));
    until(engine, 1);
    require(channel(engine, 0)[PF_CHANNEL_STATUS] == PF_RECORDING, "initial capture starts without a button press");
    until(engine, 2);
    require(take(engine, 0)[PF_TAKE_READY] && take(engine, 0)[PF_TAKE_LENGTH] == rate * 2,
      "missing finish press commits at the authored endpoint");
    require(!take(engine, 1)[PF_TAKE_READY] && channel(engine, 0)[PF_CHANNEL_STATUS] == PF_RECORDING,
      "missed commit-arm performs its written next capture at the exact boundary");
    until(engine, 3);
    require(take(engine, 1)[PF_TAKE_READY] && take(engine, 1)[PF_TAKE_LENGTH] == rate * 2,
      "automatically chained capture also finishes at its own written endpoint");
    require(state(engine)[PF_PHASE] == PF_PLAYING && !state(engine)[PF_ERROR],
      "a missed finish does not overflow or stop the transport");
  }
}
void missing_play_and_stop_remain_manual() {
  for (bool pressed_stop : {false, true}) {
    Engine engine; prepare(engine, table());
    ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0)); ok(engine, press(engine, 0)); until(engine, 3, 4);
    require(take(engine, 0)[PF_TAKE_READY] && take(engine, 1)[PF_TAKE_READY],
      "automatic commit-arm and commit produce the written two-layer phrase");
    if (pressed_stop) ok(engine, press(engine, 0));
    until(engine, 4); render(engine, 1000);
    require(bool(channel(engine, 0)[PF_CHANNEL_LOOPING]) == !pressed_stop,
      "missing stop keeps playback running and missing play never restarts explicitly stopped playback");
  }
}
void early_capture_admission_has_bounded_source_capacity() {
  for (double initial_bpm : {40., 240.}) {
    const double song[]{PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, 4, 3, 40, 3, 25, 25, 1, 2, 1, 0, 0, 1, 2, 3,
      0, 1, 1, 2, 1, 1, 2, 1, 0,
      0, 0, 1, 1, PF_ARM, 0, 0, 0, -1, -1, 0,
      0, 0, 2, 1, PF_COMMIT, 0, 0, -1, 0, 0, 0,
      0, 0, 1};
    auto rack = patches::Rack::create(nullptr, 0), backup = patches::Rack::create(nullptr, 0);
    auto program = compiled::Program::create(song, std::size(song), 8000, *rack, 1);
    require(bool(program), "early capture program prepares its bounded source window");
    program->start(1, 0, 0, initial_bpm); program->beat(PF_PLAYING, 1, 1, 0, 0, initial_bpm);
    int first = int(8000 * 60 / initial_bpm) - 160;
    require(program->press(0, first, initial_bpm, true) == PF_OK, "supported early timing-now capture remains admitted");
    program->tempo_changed(first, initial_bpm, 40);
    int endpoint = first + int(std::ceil((5 - first * initial_bpm / (8000 * 60)) * 8000 * 60 / 40));
    float source = .25f, left = 0, right = 0;
    heap_allocations = heap_frees = 0; watch_heap = true;
    for (int frame = first; frame <= endpoint; ++frame) {
      program->render(&source, &left, &right, nullptr, nullptr, 1, frame, 40, true, *rack, *backup);
      require(program->error() == PF_OK, "admitted early source cannot exhaust its buffer before the authored endpoint");
    }
    watch_heap = false;
    std::array<double, PF_TAKE_FIELDS> rejected{};
    program->take_info(0, rejected.data());
    require(heap_allocations == 0 && heap_frees == 0 && !program->has_capture() && !rejected[PF_TAKE_READY],
      "misaligned early capture is discarded recoverably at its written end without callback allocation");
  }
  const double long_song[]{PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, 4, 7, 40, 7, 25, 25, 1, 2, 1, 0, 0, 1, 2, 3,
    0, 1, 1, 6, 1, 1, 6, 1, 0,
    0, 0, 1, 1, PF_ARM, 0, 0, 0, -1, -1, 0,
    0, 0, 6, 1, PF_COMMIT, 0, 0, -1, 0, 0, 0,
    0, 0, 1};
  auto rack = patches::Rack::create(nullptr, 0);
  auto program = compiled::Program::create(long_song, std::size(long_song), 8000, *rack, 1);
  require(bool(program), "long authored source remains loadable within the explicit memory budget");
  program->start(1, 0, 0, 40); program->beat(PF_PLAYING, 1, 1, 0, 0, 40);
  require(program->press(0, 11840, 40, true) == PF_OK && program->has_capture(),
    "approved early timing fits its prepared allowance beyond thirty seconds");
  float source = .25f, output = 0;
  auto backup = patches::Rack::create(nullptr, 0);
  heap_allocations = heap_frees = 0; watch_heap = true;
  for (int frame = 11840; frame <= 252000; ++frame)
    program->render(&source, &output, &output, nullptr, nullptr, 1, frame, 40, true, *rack, *backup);
  watch_heap = false;
  require(!program->has_capture() && program->error() == PF_OK && !heap_allocations && !heap_frees,
    "long early capture reaches its authored cutoff without exhausting capacity or callback allocation");
}
void load_atomicity_and_six_counts() {
  Engine engine; auto data = table(); prepare(engine, data);
  auto before = state(engine);
  auto invalid = data; invalid[PF_COMPILED_HEADER_FIELDS] = 99;
  require(pf_configure_compiled(engine, invalid.data(), uint32_t(invalid.size())) < 0, "invalid take target rejects stopped replacement");
  require(state(engine)[PF_BAR_COUNT] == before[PF_BAR_COUNT] && state(engine)[PF_BPM] == before[PF_BPM], "failed replacement preserves usable old program");
  std::vector<uint8_t> bytes(data.size() * 8);
  for (size_t index = 0; index < data.size(); ++index) {
    uint64_t bits; std::memcpy(&bits, &data[index], 8);
    for (unsigned byte = 0; byte < 8; ++byte) bytes[index * 8 + byte] = uint8_t(bits >> (byte * 8));
  }
  ok(engine, pf_load_compiled_bytes(engine, bytes.data(), uint32_t(bytes.size())));
  data = table(6); ok(engine, pf_configure_compiled(engine, data.data(), uint32_t(data.size())));
  ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0));
  ok(engine, press(engine, 0)); until(engine, 1); ok(engine, press(engine, 0)); until(engine, 2);
  require(take(engine, 0)[PF_TAKE_LENGTH] == 24000 && state(engine)[PF_BEATS_PER_BAR] == 6, "six counted eighth-note pulses define complete 6/8 measure");
}
void malformed_capture_graphs_preserve_loaded_take() {
  Engine engine; const auto good = table(); prepare(engine, good);
  ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0)); ok(engine, press(engine, 0));
  until(engine, 1); ok(engine, press(engine, 0)); until(engine, 2); pf_stop(engine);
  const auto retained = take(engine, 0);
  require(retained[PF_TAKE_READY] && retained[PF_TAKE_LENGTH] == 16000, "graph rejection fixture retains real committed audio");
  const size_t cues = PF_COMPILED_HEADER_FIELDS + size_t(good[8]) * PF_COMPILED_TAKE_FIELDS;
  std::vector<std::vector<double>> invalid;
  for (int timing : {0, 2}) {
    auto lead_in = good;
    lead_in[cues + 5] = timing;
    invalid.push_back(lead_in);
  }
  auto changed = good;
  changed[cues + 7] = 1;
  invalid.push_back(changed);
  changed = good;
  changed.erase(changed.begin() + cues, changed.begin() + cues + PF_COMPILED_LEGACY_CUE_FIELDS); --changed[9];
  invalid.push_back(changed);
  changed = good;
  changed[cues + 7] = good[8];
  invalid.push_back(changed);
  changed = good;
  changed[PF_COMPILED_HEADER_FIELDS + 3] = 3;
  invalid.push_back(changed);
  changed = good;
  changed[PF_COMPILED_HEADER_FIELDS + PF_COMPILED_TAKE_FIELDS + 2] = 1;
  invalid.push_back(changed);
  changed = good;
  changed.erase(changed.begin() + cues + 2 * PF_COMPILED_LEGACY_CUE_FIELDS, changed.begin() + cues + 3 * PF_COMPILED_LEGACY_CUE_FIELDS); --changed[9];
  invalid.push_back(changed);
  changed = good;
  changed[cues + 2 * PF_COMPILED_LEGACY_CUE_FIELDS + 8] = 0;
  invalid.push_back(changed);
  changed = good;
  changed[cues + 2 * PF_COMPILED_LEGACY_CUE_FIELDS + 9] = 0;
  invalid.push_back(changed);
  changed = good;
  changed.insert(changed.begin() + cues, good.begin() + cues, good.begin() + cues + PF_COMPILED_LEGACY_CUE_FIELDS); ++changed[9];
  invalid.push_back(changed);
  const size_t members = cues + size_t(good[9]) * PF_COMPILED_LEGACY_CUE_FIELDS;
  changed = good;
  changed.insert(changed.begin() + members, {0, 1, 1}); ++changed[10];
  invalid.push_back(changed);
  changed = good;
  changed.insert(changed.begin() + members, {0, 0, 1, -1, PF_PLAY, 0, 0, -1, -1, 1, 0}); ++changed[9];
  invalid.push_back(changed);
  changed = good;
  changed.insert(changed.end(), {1, 0, 1}); ++changed[11];
  invalid.push_back(changed);
  changed = good;
  changed[cues + 9] = 0;
  invalid.push_back(changed);
  changed = good;
  changed[cues + 4 * PF_COMPILED_LEGACY_CUE_FIELDS + 9] = 0;
  invalid.push_back(changed);
  changed = good;
  changed[13] = changed[12];
  invalid.push_back(changed);
  changed = good;
  changed[PF_COMPILED_HEADER_FIELDS + 3] = good[3] + 1;
  changed[PF_COMPILED_HEADER_FIELDS + 4] = .25;
  invalid.push_back(changed);
  for (int cue : {1, 2}) {
    changed = good;
    changed[cues + cue * PF_COMPILED_LEGACY_CUE_FIELDS + 9] = -1;
    invalid.push_back(changed);
  }
  changed = good;
  changed.insert(changed.begin() + members, {0, 0, 3, -1, PF_PLAY, 0, 0, -1, -1, -1, 0}); ++changed[9];
  invalid.push_back(changed);
  for (const auto& data : invalid) {
    require(pf_configure_compiled(engine, data.data(), uint32_t(data.size())) < 0 && state(engine)[PF_ERROR] == PF_INVALID_PROGRAM, "inconsistent capture graph rejects before resource replacement");
    require(take(engine, 0) == retained, "invalid capture graph preserves committed PCM metadata and playback state");
  }
  ok(engine, pf_start(engine, 120, 0, 4, 4, 0, 0)); until(engine, 4); ok(engine, press(engine, 0));
  require(std::abs(render(engine, 1).left[0] - .3125f) < 1e-6, "old committed PCM remains audible after rejected replacements");
  pf_stop(engine);
  ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0));
  ok(engine, press(engine, 0));
  until(engine, 1);
  require(take(engine, 0)[PF_TAKE_LENGTH] <= 1, "old program can record again after rejected replacements");
}
void stale_bank_rejection_preserves_looping_transport() {
  const std::vector<double> song{
    PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, 4, 4, 120, 4, 25, 25, 1, 2, 1, 0, 0, 1, 2, 3,
    0, 1, 0, 2, 0, 1, 2, 0, 0,
    0, 0, 1, -1, PF_ARM, 0, 0, 0, -1, -1, 0,
    0, 0, 2, -1, PF_COMMIT, 0, 0, -1, 0, 0, 0,
    0, 0, 1
  };
  Engine engine; prepare(engine, song);
  ok(engine, pf_start(engine, 120, 0, 1, 4, 0, 0)); until(engine, 1); ok(engine, press(engine, 0));
  until(engine, 2); ok(engine, press(engine, 0)); pf_stop(engine);
  pf_effect_definition edited{PF_EFFECT_SLAPBACK, 1, {{80, 0, .5}}};
  ok(engine, pf_prepare_live_effects(engine, &edited, 1, 2));
  ok(engine, pf_start(engine, 120, 0, 1, 4, 1, 0)); until(engine, 1); ok(engine, press(engine, 0));
  until(engine, 2); ok(engine, press(engine, 0)); until(engine, 4, 4); until(engine, 1);
  std::array<double, PF_EVENT_CAPACITY * PF_EVENT_FIELDS> events{};
  const auto count = pf_drain_events(engine, events.data(), PF_EVENT_CAPACITY);
  bool rejected = false;
  for (uint32_t index = 0; index < count; ++index) {
    const auto* event = events.data() + index * PF_EVENT_FIELDS;
    rejected |= event[PF_EVENT_TYPE] == PF_CONTROL && event[PF_EVENT_ERROR] == PF_TAKE_UNAVAILABLE;
  }
  require(rejected, "default recapture reports the stale spare bank without stopping transport");
  const auto retained = take(engine, 0);
  const auto before = channel(engine, 0);
  std::array<float, 128> input{}, left{}, right{}, live_left{}, live_right{}; input.fill(.25f);
  heap_allocations = heap_frees = 0; watch_heap = true;
  ok(engine, press(engine, 0));
  require(take(engine, 0) == retained && channel(engine, 0) == before, "rejected recapture preserves committed playback, phase, pending action and lights");
  ok(engine, pf_process_stems(engine, input.data(), left.data(), right.data(), live_left.data(), live_right.data(), input.size()));
  watch_heap = false;
  require(heap_allocations == 0 && heap_frees == 0, "stale-bank rejection and continued playback require no callback heap operations");
  require(state(engine)[PF_PHASE] == PF_PLAYING && channel(engine, 0)[PF_CHANNEL_LOOPING], "rejected recapture never stops the running transport");
  require(std::all_of(left.begin(), left.end(), [](float value) { return std::abs(value - .375f) < 1e-6; }), "rejected recapture retains audible current-revision loop");
  require(std::all_of(live_left.begin(), live_left.end(), [](float value) { return std::abs(value - .375f) < 1e-6; }), "rejected recapture preserves default live routing");
  pf_stop(engine); ok(engine, pf_prepare_live_effects(engine, &edited, 1, 2));
  ok(engine, pf_start(engine, 120, 0, 1, 4, 1, 0)); until(engine, 1); ok(engine, press(engine, 0));
  render(engine, 128);
  require(channel(engine, 0)[PF_CHANNEL_STATUS] == PF_RECORDING, "stopped preparation refreshes spare bank and permits capture again");
}
std::array<double, PF_TEMPO_FIELDS> tempo(pf_engine* engine) { std::array<double, PF_TEMPO_FIELDS> out{}; pf_tempo_info(engine, out.data()); return out; }
std::array<double, BT_S_COUNT> tracker(pf_engine* engine) { std::array<double, BT_S_COUNT> out{}; bt_snapshot(pf_tracker(engine), out.data()); return out; }
std::vector<double> joined_table() {
  return {
    PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, 4, 6, 120, 6, 25, 25, 2, 3, 3, 0, 0, 1, 2, 3,
    0, 1, 0, 3, 0, 1, 3, 0, 0,
    0, 3, 0, 4, 2, 1, 5, 0, 0,
    0, 0, 0, -1, PF_ARM, 1, 0, 0, -1, -1, 0,
    0, 0, 2, -1, PF_COMMIT_ARM, 1, 0, 1, 0, 0, 0,
    0, 0, 4, 1, PF_COMMIT, 2, 2, -1, 1, 1, 0,
    0, 0, 1, 1, 0, 1, 1, 1, 1
  };
}
void joined_capture_suffix_and_phase() {
  Engine engine; prepare(engine, joined_table());
  ok(engine, pf_start(engine, 120, 1, 1, 6, 0, 0)); ok(engine, press(engine, 0));
  until(engine, 2); ok(engine, press(engine, 0)); until(engine, 3);
  until(engine, 4, 2); ok(engine, press(engine, 0)); until(engine, 4, 3);
  auto first = take(engine, 0), second = take(engine, 1);
  require(first[PF_TAKE_LENGTH] == 32000 && first[PF_TAKE_PERIOD] == 32000 && second[PF_TAKE_LENGTH] == 24000 && second[PF_TAKE_PERIOD] == 32000, "explicit six-count capture plus two-count zero-source suffix retains eight-count group period");
  const auto cursor = state(engine);
  const auto elapsed = uint32_t(cursor[PF_FRAME] - compiled::boundary_frame(cursor[PF_CLOCK_BEAT_FRAME]));
  require(first[PF_TAKE_PHASE] == 24000 + elapsed && second[PF_TAKE_PHASE] == first[PF_TAKE_PHASE],
    "new layer joins existing phrase phase without restarting either member");
  auto joined = render(engine, 1);
  require(std::abs(joined.left[0] - .375f) < 1e-6, "join outputs old loop plus new end-state tail, with no restarted note");
  require(std::abs(joined.live_left[0] - .25f) < 1e-6, "capture-end shadow is sole audible owner of outgoing voice tail");
  auto suffix = render(engine, 7999 - elapsed);
  require(std::abs(suffix.left.back() - .3125f) < 1e-6, "declared suffix consumes zero source after natural tail drains");
  auto wrapped = render(engine, 801);
  require(std::abs(wrapped.left.back() - .625f) < 1e-6 && take(engine, 0)[PF_TAKE_PHASE] == take(engine, 1)[PF_TAKE_PHASE], "both layers wrap in unison while effects history evolves");
  pf_stop(engine);
  auto invalid = joined_table(); invalid[PF_COMPILED_HEADER_FIELDS + PF_COMPILED_TAKE_FIELDS + 6] = 6;
  require(pf_configure_compiled(engine, invalid.data(), uint32_t(invalid.size())) < 0, "unequal explicit loop periods reject before replacement");
  require(take(engine, 0)[PF_TAKE_READY] && take(engine, 1)[PF_TAKE_READY], "period graph failure preserves prior audio");
}
void automatic_finish_matches_manual_pcm() {
  for (double rate : {8000., 44100., 48000.}) {
    Engine manual(rate), automatic(rate); prepare(manual, joined_table()); prepare(automatic, joined_table());
    ok(manual, pf_start(manual, 98, 1, 1, 6, 0, 0)); ok(automatic, pf_start(automatic, 98, 1, 1, 6, 0, 0));
    ok(manual, press(manual, 0)); ok(automatic, press(automatic, 0));
    bool armed_second = false, manual_finish = false;
    heap_allocations = heap_frees = 0; watch_heap = true;
    for (uint64_t frame = 0; frame < uint64_t(rate * 17); ++frame) {
      auto now = state(manual);
      if (!armed_second && now[PF_PHASE] == PF_PLAYING && now[PF_BAR_NUMBER] == 2) {
        ok(manual, press(manual, 0)); ok(automatic, press(automatic, 0)); armed_second = true;
      }
      if (!manual_finish && now[PF_PHASE] == PF_PLAYING && now[PF_BAR_NUMBER] == 4 && now[PF_BEAT_NUMBER] == 2) {
        ok(manual, press(manual, 0)); manual_finish = true;
      }
      float input = float(std::sin(double(frame) * .017) * .2);
      float a[4]{}, b[4]{};
      ok(manual, pf_process_stems(manual, &input, &a[0], &a[1], &a[2], &a[3], 1));
      ok(automatic, pf_process_stems(automatic, &input, &b[0], &b[1], &b[2], &b[3], 1));
      require(std::equal(std::begin(a), std::end(a), std::begin(b)),
        "automatic finish preserves sample-exact manual source, END tail, zero suffix and live routing");
    }
    watch_heap = false;
    require(heap_allocations == 0 && heap_frees == 0, "automatic endpoint completion allocates and releases no heap memory");
    auto result = take(automatic, 1);
    require(result[PF_TAKE_READY] && result[PF_TAKE_PERIOD] == std::ceil(8 * rate * 60 / 98)
      && std::abs(result[PF_TAKE_LENGTH] - 6 * rate * 60 / 98) <= 1,
      "automatic shortened prefix retains the full eight-count loop at real device rates");
  }
}
void loop_wrap_discards_unfinished_capture_and_preserves_latest() {
  for (int end_bar : {1, 2}) {
    Engine engine; prepare(engine, joined_table());
    ok(engine, pf_start(engine, 120, 1, 1, 6, 0, 0)); ok(engine, press(engine, 0));
    until(engine, 3); require(take(engine, 0)[PF_TAKE_READY], "wrap fixture retains an earlier complete take");
    pf_stop(engine); const auto retained = take(engine, 0);
    ok(engine, pf_start(engine, 120, 1, 1, end_bar, 1, 0)); ok(engine, press(engine, 0)); until(engine, 1);
    render(engine, uint32_t(end_bar * 16000 + 16000));
    require(state(engine)[PF_PHASE] == PF_PLAYING && !state(engine)[PF_ERROR]
      && (channel(engine, 0)[PF_CHANNEL_STATUS] == PF_RECORDING) == (end_bar == 2),
      "wrap starts a fresh capture only when its full source fits the selected range");
    pf_stop(engine);
    require(take(engine, 0)[PF_TAKE_READY] && take(engine, 0)[PF_TAKE_LENGTH] == retained[PF_TAKE_LENGTH],
      "canceling a partial lap preserves a complete take");
  }
}
void full_capture_plays_on_the_commit_frame() {
  for (double rate : {44100., 48000.}) {
    Engine engine(rate);
    const auto song = joined_table();
    ok(engine, pf_configure_compiled(engine, song.data(), uint32_t(song.size())));
    ok(engine, pf_set_click_gain(engine, 0));
    ok(engine, pf_set_microphone(engine, 1));
    ok(engine, pf_start(engine, 98, 1, 1, 6, 0, 0));
    ok(engine, press(engine, 0));

    const auto boundary = uint32_t(std::ceil(13 * rate * 60 / 98));
    const auto before = render(engine, boundary);
    require(before.left.back() == 0 && before.live_left.back() == .25f,
      "the final frame before the commit is monitored live");
    const auto after = render(engine, 128, 0);
    require(take(engine, 0)[PF_TAKE_READY] &&
      std::all_of(after.left.begin(), after.left.end(), [](float sample) { return sample == .25f; }),
      "a full capture plays from frame zero on its commit boundary even when its rounded loop period is longer");
  }
}
void actual_rate_quantization_join() {
  for (double rate : {44100.0, 48000.0}) {
    pf_engine* engine = pf_create(rate, PF_PRACTICE, 32, 30, 4); require(engine, "actual-rate engine creation");
    prepare(engine, joined_table());
    ok(engine, pf_start(engine, 98, 1, 1, 6, 0, 0)); ok(engine, press(engine, 0));
    until(engine, 2); ok(engine, press(engine, 0)); until(engine, 3);
    until(engine, 4, 2); ok(engine, press(engine, 0)); until(engine, 4, 3);
    const double period = std::ceil(8 * rate * 60 / 98);
    auto a = take(engine, 0), b = take(engine, 1);
    require(a[PF_TAKE_READY] && b[PF_TAKE_READY] && a[PF_TAKE_PERIOD] == period && b[PF_TAKE_PERIOD] == period, "98 BPM source endpoint quantization does not reject equal musical periods");
    require(std::abs(a[PF_TAKE_LENGTH] - 8 * rate * 60 / 98) <= 1 && std::abs(b[PF_TAKE_LENGTH] - 6 * rate * 60 / 98) <= 1, "real capture endpoints stay within one source frame of authored spans");
    for (int wrap = 0; wrap < 3; ++wrap) {
      render(engine, uint32_t(period));
      a = take(engine, 0); b = take(engine, 1);
      double delta = std::abs(a[PF_TAKE_PHASE] - b[PF_TAKE_PHASE]);
      require(std::min(delta, period - delta) <= 1, "quantized joins preserve phase within one frame across repeated wraps");
    }
    pf_destroy(engine);
  }
}
std::vector<double> tempo_table(int hint = 1, bool tied = false) {
  std::vector<double> song{
    PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, 4, 4, 120, 4, 25, 25, 1, double(tied ? 5 : 4), 1, 0, 0, 1, 2, 3,
    0, 1, 0, 2, 0, 1, 2, 0, 0,
    0, 0, 0, -1, PF_ARM, 1, 0, 0, -1, -1, 0,
    0, 0, 1, -1, PF_COMMIT, 1, 0, -1, 0, 0, 0,
    0, 0, 3, 0, PF_PLAY, 0, 0, -1, -1, 0, double(hint),
    0, 0, 3, 1, PF_STOP, 2, 1.5, -1, -1, -1, 0
  };
  if (tied) song.insert(song.end(), {0, 0, 3, 1.0625, PF_STOP, 2, 1.5, -1, -1, -1, 0});
  song.insert(song.end(), {0, 0, 1}); return song;
}
void ready_tempo_song(pf_engine* engine, int hint = 1, bool tied = false) {
  prepare(engine, tempo_table(hint, tied)); ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0));
  ok(engine, press(engine, 0)); until(engine, 1); ok(engine, press(engine, 0)); until(engine, 2); until(engine, 3);
}
void tempo_intent_proximity_and_ties() {
  Engine chart, pedal; ready_tempo_song(chart); ready_tempo_song(pedal, 0);
  auto prior = tracker(chart);
  ok(chart, press(chart, 0)); ok(pedal, press(pedal, 0)); ok(pedal, pf_control(pedal, 6, 0, nullptr, 0));
  auto hit = tempo(chart), other = tempo(pedal); auto after = tracker(chart);
  require(hit[PF_TEMPO_COUNT] == 1 && hit[PF_TEMPO_HINT] == 1 && hit[PF_TEMPO_SOURCE] == 1 && !hit[PF_TEMPO_ESTIMATED], "isolated starred play emits one hinted chart tempo hit without inventing BPM");
  require(other[PF_TEMPO_HINT] == 0 && other[PF_TEMPO_SOURCE] == 0 && other[PF_TEMPO_BPM] == hit[PF_TEMPO_BPM], "pedal and starred play share identical estimator baseline");
  require(after[BT_S_PHASE] == prior[BT_S_PHASE] && after[BT_S_BEAT_ID] == prior[BT_S_BEAT_ID] && after[BT_S_EPOCH] == prior[BT_S_EPOCH], "tempo hit never rephases, resets beat serial, or infers downbeat");
  ok(chart, pf_control(chart, 6, 0, nullptr, 0)); require(tempo(chart)[PF_TEMPO_COUNT] == 1, "same-frame pedal and star coalesce estimator evidence");
  render(chart, 4100); render(pedal, 4100);
  prior = tracker(chart); ok(chart, pf_control(chart, 6, 0, nullptr, 0)); ok(pedal, pf_control(pedal, 6, 0, nullptr, 0)); after = tracker(chart);
  require(tempo(chart)[PF_TEMPO_ESTIMATED] && std::abs(tempo(chart)[PF_TEMPO_BPM] - 480000.0 / 4100) < 1e-9 && tempo(chart)[PF_TEMPO_BPM] == tempo(pedal)[PF_TEMPO_BPM], "valid interval changes BPM through the shared bounded estimator");
  require(after[BT_S_PHASE] == prior[BT_S_PHASE] && after[BT_S_BEAT_ID] == prior[BT_S_BEAT_ID], "estimated BPM changes slope while retaining fractional phase");
  render(chart, 99);
  ok(chart, press(chart, 0));
  require(channel(chart, 0)[PF_CHANNEL_PENDING_KIND] == PF_STOP, "past cue retains actual frame across tempo change at the 25ms late edge");
  Engine miss; ready_tempo_song(miss); ok(miss, press(miss, 0)); render(miss, 4100); ok(miss, pf_control(miss, 6, 0, nullptr, 0)); render(miss, 100);
  ok(miss, press(miss, 0));
  require(channel(miss, 0)[PF_CHANNEL_PENDING_KIND] == PF_STOP,
    "late press honors the existing stop boundary even beyond the manual timing window");
  render(miss, 2400);
  require(!channel(miss, 0)[PF_CHANNEL_LOOPING], "queued late stop executes");
  ok(miss, press(miss, 0));
  require(!channel(miss, 0)[PF_CHANNEL_LOOPING], "repeated presses cannot replay superseded starts");
  Engine beyond; ready_tempo_song(beyond); until(beyond, 4);
  require(channel(beyond, 0)[PF_CHANNEL_LOOPING], "missed stop does not affect playback on its own");
  ok(beyond, press(beyond, 0));
  require(!channel(beyond, 0)[PF_CHANNEL_LOOPING] && tempo(beyond)[PF_TEMPO_COUNT] == 0,
    "next press applies the past stop immediately and never replays the superseded starred start");
  Engine ties; ready_tempo_song(ties, 0, true); render(ties, 4124); auto intact = channel(ties, 0);
  require(press(ties, 0) < 0 && state(ties)[PF_ERROR] == PF_CUE_AMBIGUOUS && channel(ties, 0) == intact, "equidistant eligible cues reject without selecting list order");
  Engine empty; prepare(empty, tempo_table()); ok(empty, pf_start(empty, 120, 0, 3, 4, 0, 0)); until(empty, 3);
  require(press(empty, 0) < 0 && state(empty)[PF_ERROR] == PF_NO_SAMPLE && tempo(empty)[PF_TEMPO_COUNT] == 0, "star preflights playback before applying any tempo effect");
}

void pedal_bar_boundary_preserves_capture_at_device_rate() {
  Engine engine(48000); prepare(engine, joined_table());
  std::array<double, PF_INPUT_INFO_FIELDS> routing{}; pf_input_info(engine, routing.data());
  const double generation = routing[PF_INPUT_GENERATION];
  ok(engine, pf_input_attach(engine, 0, 1, generation, PF_INPUT_PHYSICAL, 1u << 4, 0));
  ok(engine, pf_start(engine, 98, 1, 1, 6, 0, 0));
  render(engine, 6); ok(engine, press(engine, 0));
  render(engine, 168000 - 6); ok(engine, pf_input_event(engine, 0, 1, generation, 1, 4, 1));
  render(engine, 960); ok(engine, pf_input_event(engine, 0, 1, generation, 2, 4, 0));
  render(engine, 198636 - 168960); ok(engine, pf_input_event(engine, 0, 1, generation, 3, 4, 1));
  require(state(engine)[PF_BPM] == 98 && channel(engine, 0)[PF_CHANNEL_STATUS] == PF_RECORDING,
    "physical estimate queues while the original bar is still recording");
  until(engine, 3);
  const auto captured = take(engine, 0);
  require(std::abs(state(engine)[PF_BPM] - 2880000.0 / 30636) < 1e-9 && captured[PF_TAKE_READY]
    && std::abs(captured[PF_TAKE_LENGTH] - 240095) <= 1 && channel(engine, 0)[PF_CHANNEL_LOOPING],
    "a downbeat shared by the old and new tempo preserves capture and finishes the two-bar loop");
}
void tempo_change_preserves_layered_capture() {
  Engine engine; prepare(engine, joined_table());
  ok(engine, pf_start(engine, 120, 1, 1, 6, 0, 0)); ok(engine, press(engine, 0));
  until(engine, 2); ok(engine, press(engine, 0)); until(engine, 3);
  ok(engine, pf_control(engine, 6, 0, nullptr, 0)); render(engine, 4800); ok(engine, pf_control(engine, 6, 0, nullptr, 0));
  require(tempo(engine)[PF_TEMPO_BPM] == 100, "fixture changes tempo during the overdub");
  until(engine, 4, 2); ok(engine, press(engine, 0)); until(engine, 4, 3);
  auto first = take(engine, 0), second = take(engine, 1);
  require(first[PF_TAKE_READY] && second[PF_TAKE_READY] && first[PF_TAKE_LENGTH] == 32000
    && std::abs(second[PF_TAKE_LENGTH] - 27840) <= 1 && std::abs(second[PF_TAKE_PERIOD] - 37440) <= 1,
    "tempo change commits both takes with their measured source frames and shared musical period");
  require(state(engine)[PF_PHASE] == PF_PLAYING && !state(engine)[PF_ERROR] && channel(engine, 0)[PF_CHANNEL_LOOPING],
    "the mixed-tempo overdub joins playback without a cue error");
  require(std::abs(first[PF_TAKE_PHASE] - 24000) <= 2 && std::abs(second[PF_TAKE_PHASE] - second[PF_TAKE_LENGTH]) <= 2,
    "each source position maps to the same chart count at the join");
  until(engine, 5, 2);
  first = take(engine, 0); second = take(engine, 1);
  require(std::abs(first[PF_TAKE_PHASE] - 4000) <= 2 && std::abs(second[PF_TAKE_PHASE] - 4000) <= 2,
    "both layers wrap onto the same chart count after the tempo change");
}
void layer_can_join_after_returning_to_capture_tempo() {
  const double song[]{
    PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, 4, 17, 98, 17, 25, 25, 2, 4, 3, 0, 0, 1, 2, 3,
    0, 1, 0, 3, 0, 1, 3, 0, 0,
    0, 15, 0, 16, 2, 1, 17, 0, 0,
    0, 0, 0, -1, PF_ARM, 1, 0, 0, -1, -1, 0,
    0, 0, 2, -1, PF_COMMIT, 1, 0, -1, 0, 0, 0,
    0, 0, 14, -1, PF_ARM, 1, 0, 1, -1, -1, 0,
    0, 0, 16, 1, PF_COMMIT, 2, 2, -1, 1, 1, 0,
    0, 0, 1, 1, 0, 1, 1, 1, 1
  };
  auto rack = patches::Rack::create(nullptr, 0), backup = patches::Rack::create(nullptr, 0);
  auto program = compiled::Program::create(song, std::size(song), 8000, *rack, 1);
  require(bool(program), "returned-tempo fixture loads");
  constexpr double frames_per_minute = 8000 * 60;
  double bpm = 98;
  program->start(1, 4, 0, bpm);
  program->beat(PF_COUNT_IN, 0, 1, 4, 0, bpm);
  require(program->press(0, 0, bpm, true) == PF_OK, "arm the original two-bar loop");
  double frame = 4 * frames_per_minute / bpm;
  const float input = .25f;
  for (int bar = 1; bar <= 16; ++bar) for (int beat = 1; beat <= 4; ++beat) {
    if (beat == 1 && (bar == 11 || bar == 12)) {
      const double next_bpm = bar == 11 ? 100 : 98;
      program->tempo_changed(frame, bpm, next_bpm);
      bpm = next_bpm;
    }
    program->beat(PF_PLAYING, bar, beat, 0, frame, bpm);
    if (bar == 14 && beat == 1)
      require(program->press(0, std::ceil(frame), bpm, true) == PF_OK, "arm the overdub after restoring the original BPM");
    const double next_frame = frame + frames_per_minute / bpm;
    for (uint32_t at = std::ceil(frame); at < std::ceil(next_frame); ++at)
      program->render(&input, nullptr, nullptr, nullptr, nullptr, 1, at, bpm, true, *rack, *backup);
    frame = next_frame;
  }
  std::array<double, PF_TAKE_FIELDS> original{}, layer{};
  program->take_info(0, original.data());
  program->take_info(1, layer.data());
  require(original[PF_TAKE_READY] && layer[PF_TAKE_READY] && program->channel_info(0, bpm).looping,
    "restoring a recorded BPM keeps chart-phase validation for an already warped loop");
}
void joined_path_and_tempo_have_no_heap_work() {
  Engine engine; prepare(engine, joined_table());
  std::array<float, 128> input{}, left{}, right{}, live_left{}, live_right{}; input.fill(.25f);
  auto process = [&](uint32_t count) { left.fill(0); right.fill(0); live_left.fill(0); live_right.fill(0); ok(engine, pf_process_stems(engine, input.data(), left.data(), right.data(), live_left.data(), live_right.data(), count)); };
  auto advance = [&](int bar, int beat) {
    for (int frame = 0; frame < 200000; ++frame) {
      auto current = state(engine); if (current[PF_BAR_NUMBER] == bar && current[PF_BEAT_NUMBER] == beat) return;
      process(1);
    }
    require(false, "allocation fixture reaches capture boundary");
  };
  heap_allocations = heap_frees = 0; watch_heap = true;
  ok(engine, pf_start(engine, 120, 1, 1, 6, 0, 0)); ok(engine, press(engine, 0));
  advance(2, 1); ok(engine, press(engine, 0)); advance(3, 1);
  advance(4, 2); ok(engine, press(engine, 0)); advance(4, 3);
  for (int block = 0; block < 200; ++block) process(128);
  ok(engine, pf_control(engine, 6, 0, nullptr, 0));
  for (int block = 0; block < 38; ++block) process(128);
  ok(engine, pf_control(engine, 6, 0, nullptr, 0));
  for (int block = 0; block < 80; ++block) process(128);
  pf_stop(engine); watch_heap = false;
  require(heap_allocations == 0 && heap_frees == 0, "phase joins, virtual suffix, evolving wraps and tempo intent allocate or reclaim no callback memory");
}
void tempo_provenance_retry_and_blank_cell() {
  Engine engine; ready_tempo_song(engine);
  const uint16_t command[] = {'s', 't', 'a', 'r'};
  ok(engine, pf_control(engine, 0, 0, command, 4));
  auto prior = tempo(engine); ok(engine, pf_control(engine, 0, 0, command, 4));
  require(tempo(engine) == prior, "outer command retry does not emit a second tempo observation");
  std::array<double, PF_EVENT_CAPACITY * PF_EVENT_FIELDS> events{};
  uint32_t count = pf_drain_events(engine, events.data(), PF_EVENT_CAPACITY); int hits = 0;
  for (uint32_t event = 0; event < count; ++event) {
    const double* row = events.data() + event * PF_EVENT_FIELDS;
    if (row[PF_EVENT_TYPE] == PF_TEMPO_HIT) {
      ++hits;
      require(row[PF_EVENT_FRAME] == prior[PF_TEMPO_FRAME] && row[PF_EVENT_CONTROL] == 1 && row[PF_EVENT_VALUE] == 1 && row[PF_EVENT_APPLIED] == 0, "native tempo event exposes actual frame, chart source, beat hint and estimate availability");
    }
  }
  require(hits == 1, "isolated starred evidence remains observable exactly once");
  until(engine, 4); ok(engine, press(engine, 0));
  const auto stopped = channel(engine, 0);
  ok(engine, press(engine, 0));
  require(!stopped[PF_CHANNEL_LOOPING] && channel(engine, 0) == stopped && tempo(engine) == prior,
    "blank bar recovers the missed stop once without replaying the starred start");
}

void tempo_hits_require_active_practice() {
  Engine engine; prepare(engine, table());
  auto unchanged = tempo(engine); auto prior_clock = tracker(engine); const double bpm = state(engine)[PF_BPM];
  require(pf_control(engine, 6, 0, nullptr, 0) < 0 && state(engine)[PF_ERROR] == PF_TEMPO_REJECTED, "fresh compiled engine rejects pre-Start tempo evidence");
  require(state(engine)[PF_BPM] == bpm && tempo(engine) == unchanged && tracker(engine) == prior_clock, "pre-Start rejection preserves configured BPM, hit count and tracker state");
  ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0)); ok(engine, pf_control(engine, 6, 0, nullptr, 0));
  require(tempo(engine)[PF_TEMPO_COUNT] == 1, "active practice accepts tempo evidence");
  pf_stop(engine); unchanged = tempo(engine); prior_clock = tracker(engine);
  require(pf_control(engine, 6, 0, nullptr, 0) < 0 && state(engine)[PF_ERROR] == PF_TEMPO_REJECTED, "stopped practice rejects even a same-frame coalesced tempo input");
  require(state(engine)[PF_BPM] == bpm && tempo(engine) == unchanged && tracker(engine) == prior_clock, "after-Stop rejection preserves previous tempo evidence and clock state");
  pf_engine* performance = pf_create(8000, PF_PERFORMANCE, 32, 30, 4); require(performance, "nonpractice tempo guard fixture");
  ok(performance, pf_start(performance, 120, 0, 1, 1, 0, 0));
  prior_clock = tracker(performance);
  require(pf_control(performance, 6, 0, nullptr, 0) < 0 && state(performance)[PF_ERROR] == PF_TEMPO_REJECTED && tempo(performance)[PF_TEMPO_COUNT] == 0 && tracker(performance) == prior_clock, "nonpractice mode cannot submit the practice tempo intent");
  pf_destroy(performance);
}
void stopped_partial_capture_preserves_latest() {
  Engine engine; prepare(engine, table());
  ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0)); ok(engine, press(engine, 0));
  until(engine, 1); ok(engine, press(engine, 0)); until(engine, 2); pf_stop(engine);
  auto retained = take(engine, 0);
  ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0)); ok(engine, press(engine, 0));
  until(engine, 1); render(engine, 128, .75f); pf_stop(engine);
  require(take(engine, 0) == retained, "Stop discards an incompatible partial draft and preserves latest complete PCM/period/revision");
  ok(engine, pf_start(engine, 120, 0, 4, 4, 0, 0)); until(engine, 4); ok(engine, press(engine, 0));
  require(std::abs(render(engine, 1).left[0] - .3125f) < 1e-6, "retained complete audio remains playable after partial Stop");
  Engine empty; prepare(empty, table());
  ok(empty, pf_start(empty, 120, 1, 1, 4, 0, 0)); ok(empty, press(empty, 0)); until(empty, 1);
  render(empty, 128); pf_stop(empty);
  require(!take(empty, 0)[PF_TAKE_READY] && take(empty, 0)[PF_TAKE_LENGTH] == 0 && take(empty, 0)[PF_TAKE_PERIOD] == 0, "first incomplete capture cannot become a ready incompatible loop on Stop");
}
std::vector<double> disjoint_handoff_table(bool immediate_second = false) {
  return {
    PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, 4, 7, 120, 7, 25, 25, 2, 4, 2, 0, 0, 1, 2, 3,
    2, 3, 0, 5, 0, 1, 5, 0, 0,
    1, 5, 0, 7, 0, 1, 7, 0, 1,
    2, 2, 2, -1, PF_ARM, 1, 0, 0, -1, -1, 0,
    2, 2, 4, -1, PF_COMMIT, 1, 0, -1, 0, 0, 0,
    1, 1, double(immediate_second ? 5 : 4), -1, PF_ARM, double(immediate_second ? 0 : 1), 0, 1, -1, -1, 0,
    1, 1, 6, -1, PF_COMMIT, 1, 0, -1, 1, 1, 0,
    0, 0, 1, 1, 1, 1
  };
}
void disjoint_reservation_handoff_both_orders() {
  for (bool arm_first : {false, true}) {
    Engine engine; prepare(engine, disjoint_handoff_table());
    ok(engine, pf_start(engine, 120, 1, 1, 7, 0, 0)); until(engine, 2); ok(engine, press(engine, 2)); until(engine, 3); until(engine, 4);
    auto length = take(engine, 0)[PF_TAKE_LENGTH];
    if (arm_first) { ok(engine, press(engine, 1)); ok(engine, press(engine, 2)); }
    else { ok(engine, press(engine, 2)); ok(engine, press(engine, 1)); }
    require(channel(engine, 1)[PF_CHANNEL_STATUS] == PF_ARMED && channel(engine, 2)[PF_CHANNEL_STATUS] == PF_RECORDING, "future reservation coexists with prior active recording in either press order");
    render(engine, 128);
    require(take(engine, 0)[PF_TAKE_LENGTH] == length + 128 && take(engine, 1)[PF_TAKE_LENGTH] == 0, "detached old voice keeps capturing while future voice monitor warms without preroll capture");
    until(engine, 5);
    require(take(engine, 0)[PF_TAKE_READY] && take(engine, 0)[PF_TAKE_LENGTH] == 32000 && take(engine, 1)[PF_TAKE_LENGTH] <= 1, "shared boundary commits old higher-numbered button before starting new lower-numbered button");
    auto audio = render(engine, 128);
    require(std::all_of(audio.left.begin(), audio.left.end(), [](float value) { return std::abs(value - .3125f) < 1e-6; }), "old committed capture remains audible after handoff");
    require(std::all_of(audio.live_left.begin(), audio.live_left.end(), [](float value) { return std::abs(value - .3125f) < 1e-6; }), "old commit preserves already selected new live Rack history");
    until(engine, 6); ok(engine, press(engine, 1)); until(engine, 7);
    require(take(engine, 1)[PF_TAKE_READY] && take(engine, 1)[PF_TAKE_LENGTH] == 32000, "future reservation becomes an exact independent completed recording");
  }
}
std::array<double, PF_LIGHT_FIELDS> lights(pf_engine* engine) {
  std::array<double, PF_LIGHT_FIELDS> out{}; pf_light_output(engine, out.data()); return out;
}
double level(pf_engine* engine) { return lights(engine)[PF_LIGHT_SAMPLES + PF_LIGHT_SAMPLE_LEVEL]; }
void cue_warning_reads_preserve_state_without_heap_work() {
  Engine engine; prepare(engine, table()); ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0));
  const auto before = state(engine);
  const auto first = lights(engine);
  heap_allocations = heap_frees = 0; watch_heap = true;
  for (int count = 0; count < 100; ++count) require(lights(engine) == first, "unchanged cue light publication is immutable");
  watch_heap = false;
  require(heap_allocations == 0 && heap_frees == 0, "cue warning queries allocate and free no heap memory");
  require(state(engine) == before, "cue warning queries preserve transport and control state");
  ok(engine, pf_control(engine, 7, 1, nullptr, 0));
  ok(engine, pf_control(engine, 7, 0, nullptr, 0));
  require(level(engine) == 0, "observing warning does not consume the count-in arm cue");
}
void song_lead_in_cue_belongs_to_bar_one() {
  auto song = table();
  const auto timed = PF_COMPILED_HEADER_FIELDS + 3 * PF_COMPILED_TAKE_FIELDS + 4 * PF_COMPILED_LEGACY_CUE_FIELDS;
  song[timed + 3] = 0;
  song[timed + 6] = .25;
  for (int start : {1, 3}) {
    Engine engine; prepare(engine, song);
    ok(engine, pf_start(engine, 120, 1, start, 4, 0, 0));
    render(engine, 1);
    require(channel(engine, 0)[PF_CHANNEL_LIGHT] == (start == 1 ? PF_STEADY : PF_OFF),
      "the song intro is already armed only when counting in from bar one");
    ok(engine, press(engine, 0));
    ok(engine, pf_control(engine, 7, 1, nullptr, 0));
    ok(engine, pf_control(engine, 7, 0, nullptr, 0));
    until(engine, start);
    require(channel(engine, 0)[PF_CHANNEL_STATUS] == (start == 1 ? PF_RECORDING : PF_EMPTY),
      "intro presses arm bar one and leave later range starts empty");
    std::array<double, PF_EVENT_CAPACITY * PF_EVENT_FIELDS> events{};
    const auto count = pf_drain_events(engine, events.data(), PF_EVENT_CAPACITY);
    bool intro_warning = false, timed_warning = false;
    for (uint32_t index = 0; index < count; ++index) {
      const auto* event = events.data() + index * PF_EVENT_FIELDS;
      if (event[PF_EVENT_TYPE] != PF_CUE_ENTER) continue;
      intro_warning |= event[PF_EVENT_CUE] == 0;
      timed_warning |= event[PF_EVENT_CUE] == 4;
    }
    require(intro_warning == (start == 1), "cue entry announces only the actual song intro");
    require(timed_warning == (start == 3), "the selected range's beat-one cue still warns during count-in");
    if (start == 3) ok(engine, press(engine, 0));
  }
}
void unified_button_and_light_priority() {
  for (bool swapped : {false, true}) {
    auto song = disjoint_handoff_table();
    if (swapped) {
      std::swap(song[13], song[14]);
      for (int id = 0; id < 4; ++id) {
        auto& button = song[PF_COMPILED_HEADER_FIELDS + PF_COMPILED_TAKE_FIELDS * 2 + id * PF_COMPILED_LEGACY_CUE_FIELDS];
        button = button == 1 ? 2 : 1;
      }
    }
    Engine engine; prepare(engine, song); ok(engine, pf_start(engine, 120, 1, 1, 7, 0, 0));
    until(engine, 2); ok(engine, pf_control(engine, 7, 1, nullptr, 0));
    require(level(engine) == 1, "held physical button reaches full brightness");
    ok(engine, pf_control(engine, 7, 0, nullptr, 0)); until(engine, 3);
    require(level(engine) <= .7 && level(engine) >= 0, "recording uses engine pulse below seventy percent");
    auto image = lights(engine); require(image == lights(engine), "unchanged light getter is immutable");
    render(engine, 1000);
    require(level(engine) < .36 && level(engine) > .34, "recording pulse follows native quarter-beat phase");
    until(engine, 4); ok(engine, pf_control(engine, 7, 1, nullptr, 0));
    auto first = take(engine, 0); ok(engine, pf_control(engine, 7, 1, nullptr, 0));
    require(take(engine, 0) == first, "held repeat cannot perform another cue");
    ok(engine, pf_control(engine, 7, 0, nullptr, 0)); until(engine, 5);
    require(take(engine, 0)[PF_TAKE_READY] && take(engine, 0)[PF_TAKE_LENGTH] == 32000 && take(engine, 1)[PF_TAKE_LENGTH] <= 1,
      "one press commits and arms both current cues independent of physical pad ordering");
    render(engine, 1000);
    require(level(engine) < .36 && level(engine) > .34, "recording pulse wins over playing steady light");
    until(engine, 6); ok(engine, pf_control(engine, 7, 1, nullptr, 0)); ok(engine, pf_control(engine, 7, 0, nullptr, 0)); until(engine, 7);
    require(level(engine) == .7, "playing without recording is seventy percent steady");
    render(engine, 16001);
    require(state(engine)[PF_PHASE] == PF_ENDED && level(engine) == 0, "natural end clears all sample light output");
    ok(engine, pf_control(engine, 7, 1, nullptr, 0)); pf_stop(engine);
    require(level(engine) == 0, "Stop clears held indicator and playback");
  }
}
void unified_button_reports_independent_failures() {
  Engine engine; prepare(engine, table()); ok(engine, pf_start(engine, 120, 0, 2, 4, 0, 0)); until(engine, 2);
  double events[PF_EVENT_CAPACITY * PF_EVENT_FIELDS]; pf_drain_events(engine, events, PF_EVENT_CAPACITY);
  require(pf_control(engine, 7, 1, nullptr, 0) < 0, "one missing take produces aggregate press failure");
  require(channel(engine, 1)[PF_CHANNEL_STATUS] == PF_ARMED, "independent valid arm survives unavailable commit");
  unsigned count = pf_drain_events(engine, events, PF_EVENT_CAPACITY); bool failed_play = false, accepted_arm = false;
  for (unsigned id = 0; id < count; ++id) {
    const double* event = events + id * PF_EVENT_FIELDS;
    if (event[PF_EVENT_TYPE] != PF_CONTROL) continue;
    if (event[PF_EVENT_CONTROL] == 0 && event[PF_EVENT_ERROR] == PF_NO_RECORDING && !event[PF_EVENT_APPLIED]) failed_play = true;
    if (event[PF_EVENT_CONTROL] == 1 && event[PF_EVENT_APPLIED]) accepted_arm = true;
  }
  require(failed_play && accepted_arm, "each selected candidate publishes its individual result");
  ok(engine, pf_control(engine, 7, 0, nullptr, 0));
  until(engine, 3); require(channel(engine, 1)[PF_CHANNEL_STATUS] == PF_RECORDING, "release does not execute another cue");
}
void missed_commit_finishes_before_reserved_start() {
  Engine engine; prepare(engine, disjoint_handoff_table());
  ok(engine, pf_start(engine, 120, 1, 1, 7, 0, 0)); until(engine, 2); ok(engine, press(engine, 2)); until(engine, 3); until(engine, 4);
  ok(engine, press(engine, 1));
  std::array<double, PF_EVENT_CAPACITY * PF_EVENT_FIELDS> events{}; pf_drain_events(engine, events.data(), PF_EVENT_CAPACITY);
  until(engine, 5);
  uint32_t count = pf_drain_events(engine, events.data(), PF_EVENT_CAPACITY);
  for (uint32_t index = 0; index < count; ++index) {
    const double* row = events.data() + index * PF_EVENT_FIELDS;
    require(row[PF_EVENT_TYPE] != PF_FAULT, "automatic endpoint handoff causes no fatal event");
    require(row[PF_EVENT_TYPE] != PF_CONTROL || row[PF_EVENT_APPLIED] != 0,
      "already-pressed incoming arm sees the automatically completed release");
  }
  require(take(engine, 0)[PF_TAKE_READY] && take(engine, 0)[PF_TAKE_LENGTH] == 32000,
    "missed outgoing commit still saves its exact declared capture span");
  auto length = take(engine, 1)[PF_TAKE_LENGTH]; auto audio = render(engine, 128);
  require(take(engine, 1)[PF_TAKE_LENGTH] == length + 128 && state(engine)[PF_PHASE] == PF_PLAYING
    && channel(engine, 1)[PF_CHANNEL_STATUS] == PF_RECORDING,
    "automatic release precedes the independent authorized incoming capture");
  require(std::all_of(audio.left.begin(), audio.left.end(), [](float value) { return std::abs(value - .3125f) < 1e-6; }),
    "automatically committed old capture remains audible after handoff");
  Engine immediate; prepare(immediate, disjoint_handoff_table(true));
  ok(immediate, pf_start(immediate, 120, 1, 1, 7, 0, 0)); until(immediate, 2); ok(immediate, press(immediate, 2)); until(immediate, 5);
  auto before = take(immediate, 0);
  const auto incoming = take(immediate, 1);
  require(channel(immediate, 1)[PF_CHANNEL_STATUS] == PF_RECORDING && incoming[PF_TAKE_LENGTH] <= 1,
    "incoming arm automatically follows the native endpoint completion");
  ok(immediate, press(immediate, 1));
  require(take(immediate, 0) == before && take(immediate, 1) == incoming,
    "an extra press cannot restart either side of the handoff");
  auto invalid = disjoint_handoff_table();
  invalid[PF_COMPILED_HEADER_FIELDS + PF_COMPILED_TAKE_FIELDS + 1] = 4;
  invalid[PF_COMPILED_HEADER_FIELDS + PF_COMPILED_TAKE_FIELDS + 3] = 6;
  invalid[PF_COMPILED_HEADER_FIELDS + PF_COMPILED_TAKE_FIELDS + 6] = 6;
  const size_t cues = PF_COMPILED_HEADER_FIELDS + 2 * PF_COMPILED_TAKE_FIELDS;
  invalid[cues + 2 * PF_COMPILED_LEGACY_CUE_FIELDS + 2] = 3;
  invalid[cues + 3 * PF_COMPILED_LEGACY_CUE_FIELDS + 2] = 5;
  pf_stop(immediate); before = take(immediate, 0);
  require(pf_configure_compiled(immediate, invalid.data(), uint32_t(invalid.size())) < 0 && take(immediate, 0) == before, "portable loader rejects genuine declared capture-span overlap before replacement");
}
void detached_tail_three_impulse_oracle() {
  for (bool arm_first : {false, true}) {
    Engine engine;
    const pf_effect_definition effect{PF_EFFECT_SLAPBACK, 1, {{40, .5, .5}}};
    ok(engine, pf_prepare_live_effects(engine, &effect, 1, 1));
    auto song = disjoint_handoff_table(); ok(engine, pf_configure_compiled(engine, song.data(), uint32_t(song.size())));
    ok(engine, pf_set_click_gain(engine, 0)); ok(engine, pf_set_microphone(engine, 1));
    std::unique_ptr<patches::Effect> stages[]{patches::make_slapback(8000, {40, .5, .5})};
    auto old_rack = patches::Rack::create(stages, 1); auto next_rack = old_rack->snapshot(); auto detached = old_rack->snapshot();
    auto oracle_take = patches::ProcessedTake::create(*old_rack, 32000, 1, 1);
    auto oracle_player = patches::Playback::create(*oracle_take);
    require(old_rack && next_rack && detached && oracle_take && oracle_player, "prepared independent impulse oracle resources");
    constexpr uint64_t detach_frame = 68001;
    uint64_t tail_remaining = 0; bool capture_started = false, committed = false;
    heap_allocations = heap_frees = 0; watch_heap = true;
    ok(engine, pf_start(engine, 120, 1, 1, 7, 0, 0));
    for (uint64_t frame = 0; frame < 104000; ++frame) {
      if (frame == 36001) ok(engine, press(engine, 2));
      if (frame == detach_frame) {
        require(detached->copy_state(*old_rack), "copy audible detach history into prepared oracle Rack"); tail_remaining = detached->maximum_tail_frames();
        if (arm_first) { ok(engine, press(engine, 1)); ok(engine, press(engine, 2)); }
        else { ok(engine, press(engine, 2)); ok(engine, press(engine, 1)); }
      }
      if (!capture_started && channel(engine, 2)[PF_CHANNEL_STATUS] == PF_RECORDING) { require(oracle_take->begin(*old_rack), "oracle capture boundary"); capture_started = true; }
      if (!committed && take(engine, 0)[PF_TAKE_READY]) { require(oracle_take->length() == 32000 && oracle_take->commit(32000) && oracle_player->start_at_capture_end(true), "oracle commit transfers end history once"); tail_remaining = 0; committed = true; }
      float source = frame == detach_frame - 100 ? .75f : frame == detach_frame + 100 ? .5f : frame == detach_frame + 330 ? .25f : 0;
      patches::Stereo recorded{}, expected_live{}, expected_sample{};
      if (frame >= 36001 && !committed) recorded = old_rack->process({source, source});
      if (capture_started && !committed) require(oracle_take->append_processed(*old_rack, &source, &source, &recorded.left, &recorded.right, 1), "oracle appends old voice once while detached");
      if (frame >= detach_frame) {
        expected_live = next_rack->process({source, source});
        if (tail_remaining) { auto tail = detached->process({}); --tail_remaining; expected_live.left += tail.left; expected_live.right += tail.right; }
      } else if (frame >= 36001) expected_live = recorded;
      if (committed) expected_sample = oracle_player->next();
      float left = 0, right = 0, live_left = 0, live_right = 0;
      ok(engine, pf_process_stems(engine, &source, &left, &right, &live_left, &live_right, 1));
      require(left == expected_sample.left && right == expected_sample.right && live_left == expected_live.left && live_right == expected_live.right, "three impulses with feedback/40ms match independent source-once capture and prepared detach-tail histories");
    }
    pf_stop(engine); watch_heap = false;
    require(heap_allocations == 0 && heap_frees == 0, "route detach, concurrent warm monitor/capture and commit-start handoff need no callback allocation or freeing");
    require(take(engine, 0)[PF_TAKE_READY] && take(engine, 0)[PF_TAKE_LENGTH] == 32000, "old detached recording retains its complete source interval");
  }
}

void crb_history_has_one_audible_owner() {
  Engine engine;
  const pf_effect_definition effect{PF_EFFECT_SLAPBACK, 1, {{40, .5, .5}}};
  ok(engine, pf_prepare_live_effects(engine, &effect, 1, 1)); auto song = joined_table();
  ok(engine, pf_configure_compiled(engine, song.data(), uint32_t(song.size()))); ok(engine, pf_set_click_gain(engine, 0)); ok(engine, pf_set_microphone(engine, 1));
  std::unique_ptr<patches::Effect> stages[]{patches::make_slapback(8000, {40, .5, .5})};
  auto voice = patches::Rack::create(stages, 1); auto default_rack = voice->snapshot();
  auto first = patches::ProcessedTake::create(*voice, 32000, 1, 1), next = patches::ProcessedTake::create(*voice, 24000, 1, 1);
  auto first_player = patches::Playback::create(*first), next_player = patches::Playback::create(*next);
  require(voice && default_rack && first && next && first_player && next_player, "prepared independent warm-CRB oracle");
  bool first_started = false, handed_off = false, second_committed = false;
  heap_allocations = heap_frees = 0; watch_heap = true;
  ok(engine, pf_start(engine, 120, 1, 1, 6, 0, 0)); ok(engine, press(engine, 0));
  for (uint64_t frame = 0; frame < 90000; ++frame) {
    if (frame == 36001 || frame == 72001) ok(engine, press(engine, 0));
    if (!first_started && channel(engine, 0)[PF_CHANNEL_STATUS] == PF_RECORDING) { require(first->begin(*voice), "oracle initial source epoch begins"); first_started = true; }
    if (!handed_off && take(engine, 0)[PF_TAKE_READY]) {
      require(first->length() == 32000 && first->commit(32000) && first_player->start_at_capture_end(true), "oracle transfers old END history into playback");
      voice->reset(); require(next->begin(*voice), "oracle new CRB capture snapshots fresh source epoch"); handed_off = true;
    }
    if (!second_committed && take(engine, 1)[PF_TAKE_READY]) {
      require(next->length() == 24000 && next->commit(32000) && next_player->start_at_capture_end(true), "oracle explicit rest retains new epoch at its capture-end phase");
      voice->reset(); second_committed = true;
    }
    float source = frame == 51901 ? .75f : frame == 52101 ? .5f : frame == 52331 ? .25f : 0;
    auto live = second_committed ? default_rack->process({source, source}) : voice->process({source, source});
    if (first_started && !handed_off) require(first->append_processed(*voice, &source, &source, &live.left, &live.right, 1), "oracle first epoch capture");
    if (handed_off && !second_committed) require(next->append_processed(*voice, &source, &source, &live.left, &live.right, 1), "oracle second capture contains only fresh epoch output");
    patches::Stereo sample{};
    if (handed_off) sample = first_player->next();
    if (second_committed) { auto layered = next_player->next(); sample.left += layered.left; sample.right += layered.right; }
    float left = 0, right = 0, live_left = 0, live_right = 0;
    ok(engine, pf_process_stems(engine, &source, &left, &right, &live_left, &live_right, 1));
    require(left == sample.left && right == sample.right && live_left == live.left && live_right == live.right, "warm feedback CRB has one old-history owner and no old echo in new live/captured source epoch");
  }
  pf_stop(engine); watch_heap = false;
  require(heap_allocations == 0 && heap_frees == 0, "END history transfer and live reseed are allocation-free at shared boundary");
}

std::vector<double> missing_middle_handoff_table() {
  return {
    PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, 4, 5, 120, 5, 25, 25, 4, 9, 7, 0, 0, 1, 2, 3,
    0, 1, 0, 2, 0, 1, 2, 0, 0,
    0, 2, 0, 3, 0, 1, 3, 0, 0,
    0, 3, 0, 4, 0, 1, 4, 0, 0,
    1, 4, 0, 5, 0, 1, 5, 0, 3,
    0, 0, 0, -1, PF_ARM, 1, 0, 0, -1, -1, 0,
    0, 0, 1, -1, PF_COMMIT, 1, 0, -1, 0, 0, 0,
    0, 0, 1, 2, PF_ARM, 1, 0, 1, -1, -1, 0,
    0, 0, 2, 1, PF_COMMIT, 1, 0, -1, 1, 1, 0,
    0, 0, 3, 0, PF_ARM, 0, 0, 2, -1, -1, 0,
    0, 0, 3, 1, PF_COMMIT, 1, 0, -1, 2, 2, 0,
    1, 1, 3, 1, PF_ARM, 1, 0, 3, -1, -1, 0,
    1, 1, 4, -1, PF_COMMIT, 1, 0, -1, 3, 3, 0,
    2, 0, 2, 0, PF_PLAY, 0, 0, -1, -1, 0, 0,
    0, 0, 1,
    1, 0, 1, 1, 1, 1,
    2, 0, 1, 2, 1, 1, 2, 2, 1,
    3, 3, 1
  };
}
void commit_preflights_entire_selection_before_publication() {
  Engine engine; prepare(engine, missing_middle_handoff_table());
  ok(engine, pf_start(engine, 120, 1, 1, 1, 0, 0)); until(engine, 1, 4); render(engine, 4001);
  require(take(engine, 0)[PF_TAKE_READY], "automatic commit on the last range boundary publishes the first take");
  ok(engine, pf_start(engine, 120, 0, 2, 5, 0, 0)); until(engine, 2); ok(engine, press(engine, 2));
  until(engine, 3, 2);
  ok(engine, press(engine, 0)); ok(engine, press(engine, 1));
  std::array<double, PF_EVENT_CAPACITY * PF_EVENT_FIELDS> events{}; pf_drain_events(engine, events.data(), PF_EVENT_CAPACITY);
  until(engine, 4);
  require(!take(engine, 1)[PF_TAKE_READY] && !take(engine, 2)[PF_TAKE_READY] && !take(engine, 3)[PF_TAKE_READY] && take(engine, 3)[PF_TAKE_LENGTH] == 0, "missing middle member prevents draft publication and dependent incoming start");
  uint32_t count = pf_drain_events(engine, events.data(), PF_EVENT_CAPACITY); int old_failures = 0, starts_cancelled = 0;
  for (uint32_t index = 0; index < count; ++index) {
    const double* row = events.data() + index * PF_EVENT_FIELDS;
    require(row[PF_EVENT_TYPE] != PF_FAULT, "failed handoff preflight never becomes a fatal DSP fault");
    if (row[PF_EVENT_TYPE] == PF_CONTROL && row[PF_EVENT_APPLIED] == 0) {
      if (row[PF_EVENT_CUE] == 5 && row[PF_EVENT_ERROR] == PF_NO_SAMPLE) ++old_failures;
      if (row[PF_EVENT_CUE] == 6 && row[PF_EVENT_ERROR] == PF_CAPTURE_BUSY) ++starts_cancelled;
    }
  }
  require(old_failures == 1 && starts_cancelled == 1, "failed commit and cancelled dependent start each report their own source cue outcome");
  auto first = take(engine, 0); auto audio = render(engine, 128);
  require(first[PF_TAKE_READY] && first[PF_TAKE_LENGTH] == 16000 && take(engine, 2)[PF_TAKE_LENGTH] == 0 && state(engine)[PF_PHASE] == PF_PLAYING,
    "failed endpoint selection discards the invalid draft and preserves prior committed PCM and transport");
  require(std::all_of(audio.left.begin(), audio.left.end(), [](float value) { return std::abs(value - .3125f) < 1e-6; }), "only prior committed loop remains audible after rejected group publication");
}
void tempo_change_preserves_same_boundary_start() {
  const std::vector<double> song{
    PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, 4, 6, 120, 6, 25, 25, 3, 5, 4, 0, 0, 1, 2, 3,
    0, 1, 0, 3, 0, 1, 3, 0, 0,
    0, 3, 0, 4, 2, 1, 5, 0, 0,
    1, 4, 2, 6, 2, 1, 6, 2, 2,
    0, 0, 0, -1, PF_ARM, 1, 0, 0, -1, -1, 0,
    0, 0, 2, -1, PF_COMMIT_ARM, 1, 0, 1, 0, 0, 0,
    0, 0, 4, 1, PF_COMMIT, 2, 2, -1, 1, 1, 0,
    1, 1, 4, 1, PF_ARM, 2, 2, 2, -1, -1, 0,
    1, 1, 6, 1, PF_COMMIT, 2, 2, -1, 2, 2, 0,
    0, 0, 1, 1, 0, 1, 1, 1, 1, 2, 2, 1
  };
  Engine engine; prepare(engine, song); ok(engine, pf_start(engine, 120, 1, 1, 6, 0, 0)); ok(engine, press(engine, 0)); until(engine, 2); ok(engine, press(engine, 0)); until(engine, 3);
  ok(engine, pf_control(engine, 6, 0, nullptr, 0)); render(engine, 4800); ok(engine, pf_control(engine, 6, 0, nullptr, 0));
  until(engine, 4, 2); ok(engine, press(engine, 1)); ok(engine, press(engine, 0));
  std::array<double, PF_EVENT_CAPACITY * PF_EVENT_FIELDS> events{}; pf_drain_events(engine, events.data(), PF_EVENT_CAPACITY);
  until(engine, 4, 3);
  require(take(engine, 0)[PF_TAKE_READY] && take(engine, 1)[PF_TAKE_READY]
    && channel(engine, 1)[PF_CHANNEL_STATUS] == PF_RECORDING,
    "tempo-adjusted commit publishes its take and starts the reserved capture at the same boundary");
  uint32_t count = pf_drain_events(engine, events.data(), PF_EVENT_CAPACITY);
  for (uint32_t index = 0; index < count; ++index) {
    const double* row = events.data() + index * PF_EVENT_FIELDS;
    require(row[PF_EVENT_TYPE] != PF_FAULT && (row[PF_EVENT_TYPE] != PF_CONTROL || row[PF_EVENT_APPLIED]),
      "mixed-tempo commit and reserved start report no failure");
  }
  until(engine, 6, 3);
  require(take(engine, 2)[PF_TAKE_READY] && state(engine)[PF_PHASE] == PF_PLAYING,
    "incoming capture finishes at its authored endpoint");
}
void record_two_layers(pf_engine* engine) {
  ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0)); ok(engine, press(engine, 0)); until(engine, 1); ok(engine, press(engine, 0)); until(engine, 2); ok(engine, press(engine, 0)); until(engine, 3); pf_stop(engine);
}
void crb_unavailable_start_preserves_old_capture() {
  Engine engine; prepare(engine, table()); record_two_layers(engine);
  const pf_effect_definition edited{PF_EFFECT_SLAPBACK, 1, {{80, 0, .5}}}; ok(engine, pf_prepare_live_effects(engine, &edited, 1, 2));
  ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0)); ok(engine, press(engine, 0)); until(engine, 1); ok(engine, press(engine, 0)); until(engine, 2); pf_stop(engine);
  ok(engine, pf_prepare_live_effects(engine, &edited, 1, 2)); record_two_layers(engine);
  ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0)); ok(engine, press(engine, 0)); until(engine, 1);
  const auto old = take(engine, 0), next = take(engine, 1);
  require(press(engine, 0) < 0 && state(engine)[PF_ERROR] == PF_TAKE_UNAVAILABLE && take(engine, 0) == old && take(engine, 1) == next && channel(engine, 0)[PF_CHANNEL_STATUS] == PF_RECORDING, "unavailable CRB target rejects whole cue before publishing or stopping old capture");
  render(engine, 128); require(take(engine, 0)[PF_TAKE_LENGTH] == old[PF_TAKE_LENGTH] + 128, "rejected atomic CRB keeps recording old source epoch");
  until(engine, 2);
  require(take(engine, 0)[PF_TAKE_READY] && take(engine, 0)[PF_TAKE_LENGTH] == 16000
    && take(engine, 1)[PF_TAKE_READY] && channel(engine, 0)[PF_CHANNEL_STATUS] != PF_RECORDING,
    "rejected incoming CRB still finishes its authorized outgoing capture at the written endpoint");
  pf_stop(engine);
}
void independent_unavailable_arm_does_not_rollback_commit() {
  const std::vector<double> song{
    PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, 4, 5, 120, 5, 25, 25, 2, 4, 2, 0, 0, 1, 2, 3,
    2, 3, 0, 4, 0, 1, 4, 0, 0,
    1, 4, 0, 5, 0, 1, 5, 0, 1,
    2, 2, 2, -1, PF_ARM, 1, 0, 0, -1, -1, 0,
    2, 2, 3, -1, PF_COMMIT, 1, 0, -1, 0, 0, 0,
    1, 1, 3, -1, PF_ARM, 1, 0, 1, -1, -1, 0,
    1, 1, 4, -1, PF_COMMIT, 1, 0, -1, 1, 1, 0,
    0, 0, 1, 1, 1, 1
  };
  Engine engine; prepare(engine, song);
  auto capture_next_only = [&]() { ok(engine, pf_start(engine, 120, 0, 3, 5, 0, 0)); until(engine, 3); ok(engine, press(engine, 1)); until(engine, 4); ok(engine, press(engine, 1)); until(engine, 5); pf_stop(engine); };
  capture_next_only(); const pf_effect_definition edited{PF_EFFECT_SLAPBACK, 1, {{80, 0, .5}}}; ok(engine, pf_prepare_live_effects(engine, &edited, 1, 2)); capture_next_only();
  const auto retained = take(engine, 1);
  ok(engine, pf_start(engine, 120, 0, 2, 5, 0, 0)); until(engine, 2); ok(engine, press(engine, 2)); until(engine, 3); ok(engine, press(engine, 2));
  require(press(engine, 1) < 0 && state(engine)[PF_ERROR] == PF_TAKE_UNAVAILABLE, "independent incoming unavailable bank rejects only its reservation");
  until(engine, 4); require(take(engine, 0)[PF_TAKE_READY] && take(engine, 0)[PF_TAKE_LENGTH] == 16000 && take(engine, 1) == retained, "valid standalone old commit publishes despite unrelated incoming admission failure");
}

std::array<double, PF_VOICE_FIELDS> profile(pf_engine* engine, int id) { std::array<double, PF_VOICE_FIELDS> result{}; pf_voice_info(engine, id, result.data()); return result; }
std::array<double, PF_VOICE_EFFECT_FIELDS> stage(pf_engine* engine, int id, int index) { std::array<double, PF_VOICE_EFFECT_FIELDS> result{}; pf_voice_effect_info(engine, id, index, result.data()); return result; }
struct Venue {
  std::array<uint32_t, PF_VOICE_PROFILES> counts{}, revisions{};
  std::vector<pf_effect_definition> effects;
  Venue() { revisions.fill(1); }
  void apply(pf_engine* engine) { ok(engine, pf_prepare_voice_effects(engine, effects.data(), counts.data(), revisions.data())); }
};
std::vector<double> rotation_table(int beats = 4) {
  return { PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, double(beats), 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
    PF_COMPILED_ROTATION_MAGIC, 2, .25, 1, 0, 1, 1, 2, 0, 3, 2 };
}
void rotation_releases_after_inactivity() {
  for (int beats : {4, 6}) for (double rate : {8000., 44100., 48000.}) {
    auto identity = patches::Rack::create(nullptr, 0);
    auto song = rotation_table(beats);
    auto program = compiled::Program::create(song.data(), uint32_t(song.size()), rate, *identity, 1);
    require(bool(program), "inactivity program");
    program->jiggle_thresholds(1, 1);
    program->start(1, 0, 0, 120); program->beat(PF_PLAYING, 1, 1, 0, 0, 120);
    const double frames_per_count = rate * .5;
    program->rotate(1, frames_per_count * .1, 120);
    require(std::abs(program->rotation_remaining() - .25) < 1e-12, "off-grid movement gets full quarter-count inactivity");
    program->rotate(-1, frames_per_count * .2, 120);
    require(std::abs(program->rotation_remaining() - .25) < 1e-12, "continued movement restarts full inactivity duration");
    program->rotate(0, frames_per_count * .3, 120);
    require(std::abs(program->rotation_remaining() - .15) < 1e-12, "zero cannot refresh inactivity deadline");
    program->rotate(0, frames_per_count * .45, 120);
    require(program->rotation_remaining() == 0, "exact inactivity deadline expires");
    program->rotate(-1, frames_per_count * .45, 120);
    require(std::abs(program->rotation_remaining() - .25) < 1e-12, "new movement at deadline reactivates full duration");
    song.back() = 2.125;
    auto capped = compiled::Program::create(song.data(), uint32_t(song.size()), rate, *identity, 1);
    capped->jiggle_thresholds(1, 1);
    capped->start(3, 0, 0, 120); capped->beat(PF_PLAYING, 3, 3, 0, 0, 120);
    capped->rotate(1, .1 * frames_per_count, 120);
    require(std::abs(capped->rotation_remaining() - .025) < 1e-12, "written window caps inactivity");
    capped->rotate(1, .125 * frames_per_count, 120);
    require(!capped->rotation_eligible() && capped->rotation_remaining() == 0, "window end remains exclusive");
    program->start(2, 0, 7880000, 98); program->beat(PF_PLAYING, 2, 1, 0, 7880000, 98);
    const double motion = 7884001, count98 = rate * 60 / 98;
    const double expiry = motion + .25 * count98;
    program->rotate(1, motion, 98);
    program->rotate(0, std::nextafter(expiry, -std::numeric_limits<double>::infinity()), 98);
    require(program->rotation_remaining() > 0, "preceding representable frame remains inside exact input-relative interval");
    program->rotate(0, expiry, 98);
    require(program->rotation_remaining() == 0, "large absolute input frame expires without a count-roundtrip residue");
    program->start(2, 0, 7880000, 98); program->beat(PF_PLAYING, 2, 1, 0, 7880000, 98);
    program->rotate(1, motion, 98);
    const double first_change = motion + .1 * count98;
    program->tempo_changed(first_change, 98, 120);
    require(std::abs(program->rotation_remaining() - .15) < 1e-9, "first tempo change preserves remaining count distance");
    const double second_change = first_change + .05 * rate * 60 / 120;
    program->tempo_changed(second_change, 120, 90);
    require(std::abs(program->rotation_remaining() - .1) < 1e-9, "second tempo change preserves remaining count distance");
    const double final_frame = std::ceil(second_change + .1 * rate * 60 / 90);
    program->rotate(0, final_frame - 1, 90);
    require(program->rotation_remaining() > 0, "last audio frame before retimed expiry remains active");
    program->rotate(0, final_frame, 90);
    require(program->rotation_remaining() == 0, "two tempo changes expire at the independently predicted first audio frame");
    program->tempo_changed(final_frame + 1, 90, 40);
    require(program->rotation_remaining() == 0, "a slower tempo cannot reactivate expired jiggle processing");
  }
}
void jiggle_filters_small_motion_in_bounded_musical_buckets() {
  for (double rate : {44100., 48000.}) for (int beats : {4, 6}) {
    auto identity = patches::Rack::create(nullptr, 0);
    std::vector<double> song{PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, double(beats), 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
      PF_COMPILED_ROTATION_MAGIC, 1, .25, 1, 0, 4, 0};
    auto program = compiled::Program::create(song.data(), song.size(), rate, *identity, 1);
    program->start(1, 0, 0, 120); program->beat(PF_PLAYING, 1, 1, 0, 0, 120);
    double scale = rate * .5;
    auto move = [&](double value, double count) { require(program->rotate(value, count * scale, 120) == PF_OK, "finite jiggle observation accepted"); };
    for (double count : {.01, .14, .27, .4}) { move(1, count); require(program->rotation_remaining() == 0, "sparse same-direction trickle cannot accumulate forever"); }
    move(4, .5); require(std::abs(program->rotation_remaining() - .25) < 1e-12, "meaningful four-count travel activates");
    move(1, .6); require(std::abs(program->rotation_remaining() - .15) < 1e-12, "tiny same-direction movement does not refresh inactivity");
    move(-1, .62); require(std::abs(program->rotation_remaining() - .13) < 1e-12, "single tiny reversal does not count");
    move(1, .63); move(-1, .65);
    require(std::abs(program->rotation_remaining() - .25) < 1e-12, "two small reverse counts confirm a reversal despite intervening small forward motion");
    move(0, .9); require(program->rotation_remaining() == 0, "confirmed reversal expires after full inactivity");
    move(1, .91); move(0, 1.17); move(-1, 1.18); move(0, 1.2);
    require(program->rotation_remaining() == 0, "isolated reversal expires instead of contaminating a later bucket");
    move(-4, 1.25); move(0, 1.3);
    double before = program->rotation_remaining();
    program->tempo_changed(1.3 * scale, 120, 90);
    require(program->rotate(1, 1.3 * scale, 90) == PF_OK && std::abs(program->rotation_remaining() - before) < 1e-12, "one tiny reverse at tempo change cannot refresh active gesture");
    double expiry = 1.3 * scale + before * rate * 60 / 90;
    program->rotate(0, expiry, 90); require(program->rotation_remaining() == 0, "inactivity expiry follows new native tempo");
  }
  auto identity = patches::Rack::create(nullptr, 0); auto windows = rotation_table();
  auto separated = compiled::Program::create(windows.data(), windows.size(), 48000, *identity, 1);
  separated->start(1, 0, 0, 120); separated->beat(PF_PLAYING, 1, 1, 0, 0, 120);
  separated->rotate(4, 2400, 120);
  separated->beat(PF_PLAYING, 2, 1, 0, 96000, 120); separated->rotate(-2, 96240, 120);
  require(separated->rotation_remaining() == 0, "new written window does not inherit previous gesture direction");
  Engine engine; prepare(engine, rotation_table());
  ok(engine, pf_set_jiggle_thresholds(engine, 4, 2));
  for (auto pair : {std::pair<double, double>{0, 1}, {4, 5}, {3.5, 2}, {32768, 2}, {4, std::nan("")}})
    require(pf_set_jiggle_thresholds(engine, pair.first, pair.second) < 0, "invalid thresholds fail without changing prepared configuration");
  ok(engine, pf_set_microphone(engine, 1)); ok(engine, pf_start(engine, 120, 0, 1, 4, 0, 0)); until(engine, 1);
  require(pf_set_jiggle_thresholds(engine, 1, 1) < 0, "running threshold mutation is rejected");
  ok(engine, pf_control(engine, 5, 1, nullptr, 0)); double info[PF_VOICE_FIELDS]; pf_voice_info(engine, 5, info);
  require(info[PF_VOICE_ROTATION_REMAINING] == 0, "rejected mutation preserves four-count filter");
}
void jiggle_reconnect_preserves_partial_gesture_and_clock() {
  Engine engine; prepare(engine, rotation_table()); ok(engine, pf_set_jiggle_thresholds(engine, 4, 2));
  ok(engine, pf_set_microphone(engine, 1)); ok(engine, pf_start(engine, 120, 0, 1, 4, 0, 0)); until(engine, 1);
  ok(engine, pf_control(engine, 5, 2, nullptr, 0));
  const auto before = state(engine);
  require(profile(engine, 5)[PF_VOICE_ROTATION_REMAINING] == 0, "first half of travel is not yet a jiggle");
  ok(engine, pf_set_jiggle_thresholds(engine, 4, 2));
  require(state(engine) == before, "same-value reconnect leaves transport clock and control state unchanged");
  for (auto pair : {std::pair<double, double>{0, 1}, {4, 5}, {3.5, 2}, {32768, 2}, {4, std::nan("")}, {std::numeric_limits<double>::infinity(), 2}}) {
    require(pf_set_jiggle_thresholds(engine, pair.first, pair.second) < 0, "invalid reconnect configuration is rejected while playing");
    require(std::strstr(pf_error(engine), "integer travel"), "invalid reconnect is validated before the stopped guard");
  }
  require(pf_set_jiggle_thresholds(engine, 4, 1) < 0 && std::strstr(pf_error(engine), "Stop transport"), "different valid reconnect thresholds still require Stop");
  ok(engine, pf_set_jiggle_thresholds(engine, 4, 2));
  require(state(engine) == before, "rejected configurations and idempotent retry preserve the partial gesture and clock");
  ok(engine, pf_control(engine, 5, 2, nullptr, 0));
  require(profile(engine, 5)[PF_VOICE_ROTATION_REMAINING] == .25, "second half of travel completes the jiggle across reconnect");
  render(engine, 200);
  const auto active = profile(engine, 5); const auto clock = state(engine);
  ok(engine, pf_set_jiggle_thresholds(engine, 4, 2));
  require(profile(engine, 5) == active && state(engine) == clock, "active reconnect neither refreshes inactivity nor changes clock");
  ok(engine, pf_control(engine, 5, -1, nullptr, 0));
  ok(engine, pf_set_jiggle_thresholds(engine, 4, 2));
  ok(engine, pf_control(engine, 5, -1, nullptr, 0));
  require(profile(engine, 5)[PF_VOICE_ROTATION_REMAINING] == .25, "partial reversal also survives an idempotent reconnect");
}
Venue rotation_venue() {
  Venue venue; venue.counts[PF_BACKUP_PROFILE] = 2;
  venue.effects.push_back({PF_EFFECT_SLAPBACK, 1, {{40, 0, .5}}});
  pf_effect_definition chorus{}; chorus.type = PF_EFFECT_CHORUS; chorus.version = 1; chorus.parameters.chorus = {1, 0, 10, .25}; venue.effects.push_back(chorus);
  return venue;
}
void rotation_refresh_at_boundary_has_continuous_pcm() {
  for (int beats : {4, 6}) for (double rate : {44100., 48000.}) {
    Engine engine(rate); auto venue = rotation_venue(); venue.apply(engine); auto song = rotation_table(beats);
    ok(engine, pf_configure_compiled(engine, song.data(), uint32_t(song.size())));
    ok(engine, pf_set_click_gain(engine, 0)); ok(engine, pf_set_microphone(engine, 1));
    ok(engine, pf_start(engine, 120, 0, 1, 4, 0, 0)); until(engine, 1);
    const double release = std::ceil(state(engine)[PF_FRAME] + rate / 8);
    ok(engine, pf_control(engine, 5, 1, nullptr, 0));
    auto before = render(engine, uint32_t(release - state(engine)[PF_FRAME]), 1);
    require(std::abs(before.live_left.back() - 1.875f) < 1e-6 && profile(engine, 5)[PF_VOICE_ROTATION_REMAINING] == 0,
      "real native blocks keep the processed backup source through the final frame before its quarter deadline");
    ok(engine, pf_control(engine, 5, -1, nullptr, 0));
    auto continued = render(engine, 1, 1);
    require(profile(engine, 5)[PF_VOICE_ACTIVITY] == PF_VOICE_LIVE && std::abs(continued.live_left[0] - 1.875f) < 1e-6,
      "accepted motion at the old deadline keeps the existing rack continuous without a fabricated dry frame");
    ok(engine, pf_set_microphone(engine, 0));
    auto silent = render(engine, 1000, 1);
    require(profile(engine, 5)[PF_VOICE_ROTATION_REMAINING] == 0 && std::all_of(silent.live_left.begin(), silent.live_left.end(), [](float sample) { return sample == 0; }),
      "microphone loss clears inactivity activation and its tails");
  }
}
void independent_profiles_and_reload_have_real_graphs() {
  Engine engine; Venue venue;
  for (int id = 0; id < PF_VOICE_PROFILES; ++id) { venue.counts[id] = 1; venue.effects.push_back({PF_EFFECT_SLAPBACK, 1, {{100, 0, id == 0 ? .5 : .25}}}); }
  venue.apply(engine); auto song = table();
  auto load = [&]() { ok(engine, pf_configure_compiled(engine, song.data(), uint32_t(song.size()))); ok(engine, pf_set_click_gain(engine, 0)); ok(engine, pf_set_microphone(engine, 1)); };
  for (int run = 0; run < 2; ++run) {
    load(); ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0)); ok(engine, press(engine, 0)); until(engine, 1); ok(engine, press(engine, 0)); until(engine, 2);
    require(take(engine, 0)[PF_TAKE_REVISION] == 1, "independent profile retains its own numeric revision across load");
    auto output = render(engine, 1);
    require(std::abs(output.left[0] - .375f) < 1e-6, "loading a song uses its pad profile graph even when default has the same revision number");
    pf_stop(engine);
  }
  auto before = profile(engine, 1); auto retained = take(engine, 0);
  venue.revisions[0] = 2; venue.effects[0].parameters.slapback.wet = .75; venue.apply(engine);
  require(profile(engine, 1) == before && take(engine, 0) == retained && stage(engine, 0, 0)[PF_VOICE_EFFECT_PARAMETER_2] == .75, "editing one profile preserves another revision and retained take graph");
  ok(engine, pf_start(engine, 120, 0, 2, 4, 0, 0)); until(engine, 2); ok(engine, press(engine, 1)); until(engine, 3); ok(engine, press(engine, 1)); until(engine, 4);
  require(take(engine, 2)[PF_TAKE_REVISION] == 1 && take(engine, 2)[PF_TAKE_READY], "untouched voice spare banks remain compatible after another profile edit");
  pf_stop(engine); auto first = profile(engine, 0), last = profile(engine, 5); auto kept = take(engine, 2);
  venue.revisions[0] = 3; venue.effects[0].parameters.slapback.wet = .8; venue.revisions[5] = 2; venue.effects[5].parameters.slapback.delay_ms = 999;
  require(pf_prepare_voice_effects(engine, venue.effects.data(), venue.counts.data(), venue.revisions.data()) < 0 && profile(engine, 0) == first && profile(engine, 5) == last && take(engine, 2) == kept, "invalid last profile leaves the entire venue and committed take unchanged");
}
void rotation_metadata_rejects_invalid_programs_atomically() {
  Engine engine; auto venue = rotation_venue(); venue.apply(engine); auto good = rotation_table();
  ok(engine, pf_configure_compiled(engine, good.data(), uint32_t(good.size())));
  std::vector<std::vector<double>> invalid(11, good);
  invalid[0][16] = 0; invalid[1][17] = 3; invalid[2][18] = std::nan(""); invalid[3][19] = 0;
  invalid[4][21] = 5; invalid[4][22] = 1; invalid[5][23] = 1; invalid[5][24] = .5;
  invalid[6][20] = .0001; invalid[7][21] = 1; invalid[7][22] = 0;
  invalid[8][18] = .0001; invalid[9][18] = 0; invalid[10][1] = 3;
  const auto before = profile(engine, 5);
  for (const auto& bad : invalid) require(pf_configure_compiled(engine, bad.data(), uint32_t(bad.size())) < 0 && profile(engine, 5) == before, "malformed rotation metadata preserves applied venue and previous program");
  ok(engine, pf_set_click_gain(engine, 0)); ok(engine, pf_set_microphone(engine, 1)); ok(engine, pf_start(engine, 120, 0, 1, 4, 0, 0)); until(engine, 1);
  ok(engine, pf_control(engine, 5, 1, nullptr, 0)); require(profile(engine, 5)[PF_VOICE_ROTATION_REMAINING] > 0 && profile(engine, 5)[PF_VOICE_ROTATION_REMAINING] <= .25, "prior inactivity program remains executable after malformed grid and version-3 replacements");
}
void rotation_graph_order_and_tail_pcm() {
  Engine engine; auto venue = rotation_venue(); venue.apply(engine); auto song = rotation_table();
  ok(engine, pf_configure_compiled(engine, song.data(), uint32_t(song.size()))); ok(engine, pf_set_click_gain(engine, 0)); ok(engine, pf_set_microphone(engine, 1));
  require(stage(engine, 5, 0)[PF_VOICE_EFFECT_TYPE] == PF_EFFECT_SLAPBACK && stage(engine, 5, 1)[PF_VOICE_EFFECT_TYPE] == PF_EFFECT_CHORUS && stage(engine, 5, 1)[PF_VOICE_EFFECT_PARAMETER_2] == 10, "native readback reports actual ordered serial slapback then chorus");
  ok(engine, pf_start(engine, 120, 0, 1, 4, 0, 0)); until(engine, 1);
  ok(engine, pf_control(engine, 5, -2, nullptr, 0));
  require(profile(engine, 5)[PF_VOICE_ACTIVITY] == PF_VOICE_LIVE && profile(engine, 5)[PF_VOICE_ROTATION_REMAINING] > 0 && profile(engine, 5)[PF_VOICE_ROTATION_REMAINING] <= .25, "negative rotation activates backup for a quarter-count of inactivity");
  const double release_frame = std::ceil(state(engine)[PF_CLOCK_BEAT_FRAME] + 1000);
  auto impulse = render(engine, 1, 1); auto response = render(engine, 400, 0);
  require(impulse.live_left[0] == 1 && response.live_left[79] == .25f && response.live_left[319] == .5f && response.live_left[399] == .125f, "serial graph renders dry, chorus, slapback, and chorused slapback once each");
  for (int frame = 0; frame < 400; ++frame) if (frame != 79 && frame != 319 && frame != 399) require(response.live_left[frame] == 0, "graph contains no additional dry path or hidden repeats");
  render(engine, uint32_t(release_frame - state(engine)[PF_FRAME] - 1), 0); require(profile(engine, 5)[PF_VOICE_ACTIVITY] == PF_VOICE_LIVE, "backup stays attached through the last source frame before the quarter boundary");
  render(engine, 1, 1); require(profile(engine, 5)[PF_VOICE_ACTIVITY] != PF_VOICE_LIVE, "backup stops original source at the first frame on or after the quarter boundary");
  auto tail = render(engine, 401, 0);
  require(tail.live_left[79] == .25f && tail.live_left[319] == .5f && tail.live_left[399] == .125f && tail.live_left[400] == 0, "detached backup drains its natural serial effects without repeating original dry");
  require(profile(engine, 4)[PF_VOICE_ACTIVITY] == PF_VOICE_LIVE && profile(engine, 5)[PF_VOICE_ACTIVITY] == PF_VOICE_STANDBY, "main vocals resume as backup tail ends");
  until(engine, 1, 2);
  std::array<double, PF_EVENT_CAPACITY * PF_EVENT_FIELDS> observations{}; pf_drain_events(engine, observations.data(), PF_EVENT_CAPACITY);
  double observed_frame = state(engine)[PF_FRAME]; ok(engine, pf_control(engine, 5, -3, nullptr, 0));
  require(pf_drain_events(engine, observations.data(), PF_EVENT_CAPACITY) == 1 && observations[PF_EVENT_TYPE] == PF_CONTROL && observations[PF_EVENT_VALUE] == -3 && observations[PF_EVENT_APPLIED] == 1 && observations[PF_EVENT_FRAME] == observed_frame && observations[PF_EVENT_RATE] == 8000, "out-of-cue signed rotation is a nonfatal source-frame observation for Video");
  require(pf_control(engine, 5, std::nan(""), nullptr, 0) < 0 && pf_drain_events(engine, observations.data(), PF_EVENT_CAPACITY) == 1 && observations[PF_EVENT_FRAME] == observed_frame && observations[PF_EVENT_ERROR] == PF_INVALID_KNOB, "invalid rotation acknowledgment retains actual arrival frame");
  require(profile(engine, 5)[PF_VOICE_ROTATION_REMAINING] == 0 && !profile(engine, 5)[PF_VOICE_ROTATION_ELIGIBLE], "written d-window end is excluded even with continuing rotation");
  until(engine, 2); ok(engine, pf_control(engine, 5, 4, nullptr, 0)); render(engine, 1000, 0);
  const uint16_t identity[] = {'r','o','t'}; ok(engine, pf_control(engine, 5, -4, identity, 3)); render(engine, 500, 0); auto remaining = profile(engine, 5)[PF_VOICE_ROTATION_REMAINING];
  ok(engine, pf_control(engine, 5, -4, identity, 3)); ok(engine, pf_control(engine, 5, 0, nullptr, 0));
  require(profile(engine, 5)[PF_VOICE_ROTATION_REMAINING] == remaining, "duplicate producer command and zero delta never change the inactivity target");
  pf_stop(engine); auto silent = render(engine, 500, 1);
  require(profile(engine, 5)[PF_VOICE_ACTIVITY] == PF_VOICE_STANDBY && profile(engine, 5)[PF_VOICE_ROTATION_REMAINING] == 0 && std::all_of(silent.live_left.begin(), silent.live_left.end(), [](float sample) { return sample == 0; }), "Stop clears rotation, tails and authorization immediately");
}
void rotation_uses_musical_time_and_preserves_capture() {
  for (int beats : {4, 6}) {
    Engine engine; auto venue = rotation_venue(); venue.apply(engine); auto song = rotation_table(beats); ok(engine, pf_configure_compiled(engine, song.data(), uint32_t(song.size()))); ok(engine, pf_set_click_gain(engine, 0)); ok(engine, pf_set_microphone(engine, 1));
    ok(engine, pf_start(engine, 120, 0, 2, 4, 0, 0)); until(engine, 2);
    ok(engine, pf_control(engine, 6, 0, nullptr, 0)); render(engine, 6500, 0); ok(engine, pf_control(engine, 5, 1, nullptr, 0)); render(engine, 250, 0);
    double remaining = profile(engine, 5)[PF_VOICE_ROTATION_REMAINING]; ok(engine, pf_control(engine, 6, 0, nullptr, 0));
    require(remaining > 0 && std::abs(profile(engine, 5)[PF_VOICE_ROTATION_REMAINING] - remaining) < 1e-9 && std::abs(state(engine)[PF_BPM] - (8000.0 * 60 / 6750)) < 1e-6, "tempo update preserves the remaining inactivity distance without rephasing in either meter");
    uint32_t remaining_frames = uint32_t(std::ceil(remaining * 8000 * 60 / state(engine)[PF_BPM]));
    render(engine, remaining_frames - 1, 0); require(profile(engine, 5)[PF_VOICE_ACTIVITY] == PF_VOICE_LIVE, "tempo-adjusted quarter deadline stays open through its preceding frame");
    render(engine, 1, 0); require(profile(engine, 5)[PF_VOICE_ACTIVITY] != PF_VOICE_LIVE, "inactivity deadline follows updated tempo rather than the old wall-clock interval");
    until(engine, 3, 2); render(engine, uint32_t(std::floor(8000 * 60 / state(engine)[PF_BPM] * .75)), 0); ok(engine, pf_control(engine, 5, 1, nullptr, 0));
    require(profile(engine, 5)[PF_VOICE_ROTATION_REMAINING] > 0 && profile(engine, 5)[PF_VOICE_ROTATION_REMAINING] <= .25, "rotation near a written window end never extends past its next quarter");
    until(engine, 3, 3); require(!profile(engine, 5)[PF_VOICE_ROTATION_ELIGIBLE] && profile(engine, 5)[PF_VOICE_ROTATION_REMAINING] == 0, "written gate end clears backup source feed in both meters");
  }
  Engine engine; auto song = table(); song.insert(song.end(), {PF_COMPILED_ROTATION_MAGIC, 1, .25, 1, 0, 3, 0}); prepare(engine, song); auto venue = rotation_venue(); venue.revisions.fill(2); venue.apply(engine);
  ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0)); ok(engine, press(engine, 0)); until(engine, 1); ok(engine, press(engine, 0)); ok(engine, pf_control(engine, 5, 1, nullptr, 0));
  float source[128], left[128]{}, right[128]{}, live_left[128]{}, live_right[128]{}; std::fill(source, source + 128, .25f);
  heap_allocations = heap_frees = 0; watch_heap = true;
  for (int index = 0; index < 32; ++index) { if (index == 8) pf_control(engine, 5, -1, nullptr, 0); pf_process_stems(engine, source, left, right, live_left, live_right, 128); }
  watch_heap = false; require(heap_allocations == 0 && heap_frees == 0, "rotation route changes and inactivity release perform no heap work");
  until(engine, 2); auto captured = render(engine, 1);
  require(take(engine, 0)[PF_TAKE_LENGTH] == 16000 && captured.left[0] == .25f, "rotation monitor switches do not add monitor tails or backup effects to independent capture");
}

void automatic_finish_preserves_same_voice_armed_route() {
  const std::vector<double> song{
    PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, 4, 5, 120, 5, 25, 25, 2, 4, 2, 0, 0, 1, 2, 3,
    0, 1, 0, 2, 2, 1, 2, 2, 0,
    0, 3, 0, 4, 0, 1, 4, 0, 1,
    0, 0, 0, -1, PF_ARM, 1, 0, 0, -1, -1, 0,
    0, 0, 2, 1, PF_COMMIT, 2, 2, -1, 0, 0, 0,
    0, 0, 2, 0, PF_ARM, 1, 0, 1, -1, -1, 0,
    0, 0, 3, -1, PF_COMMIT, 1, 0, -1, 1, 1, 0,
    0, 0, 1, 1, 1, 1
  };
  Engine engine; prepare(engine, song);
  Venue venue; venue.counts[0] = 1; venue.effects.push_back({PF_EFFECT_SLAPBACK, 1, {{100, 0, .25}}}); venue.revisions.fill(2); venue.apply(engine);
  ok(engine, pf_start(engine, 120, 1, 1, 5, 0, 0)); ok(engine, press(engine, 0));
  until(engine, 2); ok(engine, press(engine, 0)); until(engine, 2, 3);
  require(take(engine, 0)[PF_TAKE_READY] && channel(engine, 0)[PF_CHANNEL_PENDING_KIND] == PF_ARM,
    "automatic finish preserves a different pending arm on the same voice");
  until(engine, 3); auto output = render(engine, 1000);
  require(channel(engine, 0)[PF_CHANNEL_STATUS] == PF_RECORDING && std::abs(output.live_left.back() - .3125f) < 1e-6,
    "pending same-voice capture retains its authorized effected live route across automatic finish");
}
void prepared_capture_reuses_banks_without_heap_work() {
  Engine engine; prepare(engine, table());
  std::array<float, 128> input{}, left{}, right{}, live_left{}, live_right{}; input.fill(.25f);
  auto advance = [&](int bar) {
    for (int block = 0; block < 2000; ++block) {
      auto current = state(engine);
      if (current[PF_PHASE] == PF_PLAYING && current[PF_BAR_NUMBER] == bar) return;
      left.fill(0); right.fill(0); live_left.fill(0); live_right.fill(0);
      ok(engine, pf_process_stems(engine, input.data(), left.data(), right.data(), live_left.data(), live_right.data(), input.size()));
    }
    require(false, "capture reuse reaches requested bar");
  };
  heap_allocations = heap_frees = 0; watch_heap = true;
  for (int run = 0; run < 3; ++run) {
    ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0)); ok(engine, press(engine, 0));
    advance(1); ok(engine, press(engine, 0)); advance(2); ok(engine, press(engine, 0)); advance(3);
    require(take(engine, 0)[PF_TAKE_LENGTH] == 16000 && take(engine, 1)[PF_TAKE_LENGTH] == 16000, "repeated captures rotate prepared banks and retain exact intervals");
    pf_stop(engine);
  }
  watch_heap = false;
  require(heap_allocations == 0 && heap_frees == 0, "prepared start, arm, commit, layered playback and Stop perform no heap operations");
  auto retained = take(engine, 0);
  pf_effect_definition edited{PF_EFFECT_SLAPBACK, 1, {{80, 0, .5}}};
  ok(engine, pf_prepare_live_effects(engine, &edited, 1, 2));
  require(take(engine, 0) == retained, "changed venue graph retains previous committed take");
  for (int run = 0; run < 3; ++run) {
    ok(engine, pf_prepare_live_effects(engine, &edited, 1, 2));
    heap_allocations = heap_frees = 0; watch_heap = true;
    ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0)); ok(engine, press(engine, 0));
    advance(1); ok(engine, press(engine, 0)); advance(2); ok(engine, press(engine, 0)); advance(3);
    require(take(engine, 0)[PF_TAKE_REVISION] == 2 && take(engine, 1)[PF_TAKE_REVISION] == 2, "recapture banks use current host graph revision across repeated runs");
    pf_stop(engine); watch_heap = false;
    require(heap_allocations == 0 && heap_frees == 0, "refreshed banks need no callback allocation or release");
  }
  heap_allocations = heap_frees = 0; watch_heap = true;
  ok(engine, pf_prepare_live_effects(engine, &edited, 1, 2));
  watch_heap = false;
  require(heap_allocations == 0 && heap_frees == 0, "idempotent stopped preparation avoids allocations when all reusable banks are current");
}
std::vector<double> prefix_table() {
  return {PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, 4, 88, 98, 88, 25, 25, 1, 4, 2, 3, 0, 1, 2, 3,
    0, 82, 0, 83, 0, 1, 83, 0, 0,
    0, 0, 82, -1, PF_ARM, 0, 0, 0, -1, -1, 0,
    0, 0, 82, 3, PF_COMMIT, 1, 0, -1, 0, 0, 0,
    0, 0, 84, 0, PF_STOP, 0, 0, -1, -1, -1, 0,
    0, 0, 86, 0, PF_PLAY, 0, 0, -1, -1, 1, 0,
    0, 0, 1, 1, 0, 1,
    84, 0, 1, 85, 0, 0, 87, 0, 0,
    PF_COMPILED_WINDOW_MAGIC, 1, 1, 0, 3.5, 4};
}
void prefix_effected_source_oracle() {
  for (double rate : {44100., 48000.}) for (bool effects : {false, true}) {
    std::unique_ptr<patches::Effect> stages[]{patches::make_slapback(rate, {100, 0, .5}), patches::make_chorus(rate, {.8, 5, 20, .35})};
    auto definition = patches::Rack::create(stages, effects ? 2 : 0), backup = patches::Rack::create(nullptr, 0);
    auto oracle = definition->snapshot();
    auto data = prefix_table();
    auto program = compiled::Program::create(data.data(), data.size(), rate, *definition, 1);
    require(bool(program), "effected prefix table loads");
    double count = rate * 60 / 98, origin = 329 * count;
    uint32_t first = uint32_t(std::ceil(origin)), end = uint32_t(std::ceil(333 * count));
    uint32_t cut = uint32_t(std::ceil(332.5 * count)) - first, period = uint32_t(std::ceil(4 * count));
    uint32_t prefix = uint32_t(std::ceil(337 * count)), full = uint32_t(std::ceil(341 * count));
    uint32_t final = uint32_t(std::ceil(345 * count)), playback_phase = 0;
    auto source_at = [&](uint32_t offset) { return offset == cut - 10 ? .25f : offset == cut ? .75f : 0.f; };
    bool saw_prefix_tail = false, saw_full_hit = false;
    heap_allocations = heap_frees = 0; watch_heap = true;
    program->start(82, 0, origin - count, 98); program->beat(PF_PLAYING, 82, 1, 0, origin, 98);
    require(program->press(0, first, 98, true) == PF_OK, "effected source arms");
    for (uint32_t frame = first; frame < final; ++frame) {
      if (frame == prefix) program->beat(PF_PLAYING, 84, 1, 0, 337 * count, 98);
      if (frame == full) program->beat(PF_PLAYING, 85, 1, 0, 341 * count, 98);
      float input = frame < end ? source_at(frame - first) : 0, left = 0, right = 0;
      patches::Stereo expected{};
      if (frame < end) oracle->process({input, input});
      else {
        if (playback_phase == period) playback_phase = 0;
        bool trimmed = frame >= prefix && frame < full;
        float admitted = (!trimmed || playback_phase < cut) ? source_at(playback_phase) : 0;
        expected = oracle->process({admitted, admitted});
        if (trimmed && playback_phase >= cut && std::abs(expected.left) > 1e-5) saw_prefix_tail = true;
        if (frame >= full && playback_phase == cut && expected.left > .7) saw_full_hit = true;
        ++playback_phase;
      }
      program->render(&input, &left, &right, nullptr, nullptr, 1, frame, 98, true, *definition, *backup);
      require(program->error() == PF_OK && std::abs(left - expected.left) < 1e-6 && std::abs(right - expected.right) < 1e-6,
        "Program prefix excludes absolute-grid omitted impulse from dry, Slapback and Chorus while preserving admitted tails");
    }
    program->stop(); watch_heap = false;
    require(!heap_allocations && !heap_frees, "effected source prefix processing performs no heap operations");
    require(saw_full_hit && (!effects || saw_prefix_tail), "next full bar restores omitted hit and prefix keeps earlier effect tail");
  }
}
void prefix_late_arm_zero_cut() {
  auto definition = patches::Rack::create(nullptr, 0), backup = patches::Rack::create(nullptr, 0);
  auto data = prefix_table(); data[data.size() - 2] = 1. / 960;
  auto program = compiled::Program::create(data.data(), data.size(), 1000, *definition, 1);
  require(bool(program), "sub-frame source prefix loads");
  program->start(82, 0, 82000, 240); program->beat(PF_PLAYING, 82, 1, 0, 82250, 240, false);
  require(program->press(0, 82251, 240, true) == PF_OK, "one-frame late arm is admitted");
  std::array<float, 1000> input{}, output{};
  input.fill(.25f); program->render(input.data(), output.data(), nullptr, nullptr, nullptr, 1000, 82251, 240, true, *definition, *backup);
  program->beat(PF_PLAYING, 84, 1, 0, 84250, 240);
  std::array<double, PF_TAKE_FIELDS> info{}; program->take_info(0, info.data());
  require(info[PF_TAKE_READY] && info[PF_TAKE_SOURCE_END] == 0, "late ARM observes zero cut immediately before first source admission");
}

void prefix_capture_maps_and_selection() {
  for (double rate : {44100., 48000.}) {
    auto definition = patches::Rack::create(nullptr, 0), backup = patches::Rack::create(nullptr, 0);
    auto data = prefix_table();
    auto program = compiled::Program::create(data.data(), data.size(), rate, *definition, 1);
    require(bool(program), "prefix table loads");
    double count = rate * 60 / 98, origin = 329 * count;
    uint32_t length = uint32_t(std::ceil(333 * count) - std::ceil(origin));
    uint32_t cut = uint32_t(std::ceil(332.5 * count) - std::ceil(origin));
    std::vector<float> input(length + 2, .25f), left(length + 2), right(length + 2);
    auto render_frames = [&](uint32_t frames, double frame) {
      program->render(input.data(), left.data(), right.data(), nullptr, nullptr, frames, frame, 98, true, *definition, *backup);
      require(program->error() == PF_OK, "prefix rendering succeeds");
    };
    for (int run = 0; run < 3; ++run) {
      heap_allocations = heap_frees = 0; watch_heap = true;
      program->start(82, 0, origin - count, 98);
      program->beat(PF_PLAYING, 82, 1, 0, origin, 98);
      require(program->press(0, std::ceil(origin), 98, true) == PF_OK, "prefix source arms");
      render_frames(length + 1, std::ceil(origin));
      std::array<double, PF_TAKE_FIELDS> info{}; program->take_info(0, info.data());
      require(info[PF_TAKE_READY] && info[PF_TAKE_LENGTH] == length && info[PF_TAKE_SOURCE_END] == -1, "commit keeps original complete recording");
      require(info[PF_TAKE_SELECTION] == 0, "native readback names the actual full selection");
      double prior_phase = info[PF_TAKE_PHASE];
      program->beat(PF_PLAYING, 84, 1, 0, 337 * count, 98); program->take_info(0, info.data());
      require(info[PF_TAKE_SOURCE_END] == cut && info[PF_TAKE_PHASE] == prior_phase, "prefix uses actual source-frame crossing without phase reset");
      require(info[PF_TAKE_SELECTION] == 1, "native readback follows the active prefix view without bar inference");
      if (rate == 48000) require(cut == 102857 && info[PF_TAKE_PERIOD] == 117552, "prefix excludes absolute-grid hit that period ratio would leak");
      require(program->press(0, std::ceil(337 * count), 98, true) == PF_OK, "manual Stop still suppresses playback");
      program->beat(PF_PLAYING, 85, 1, 0, 341 * count, 98); program->take_info(0, info.data());
      require(info[PF_TAKE_PLAYBACK_STATE] != int(patches::PlaybackState::playing) && info[PF_TAKE_SELECTION] == -1, "stopped readback cannot claim a cached automatic selection is playing");
      program->beat(PF_PLAYING, 86, 1, 0, 345 * count, 98);
      require(program->press(0, std::ceil(345 * count), 98, true) == PF_OK, "manual Play can authorize prefix");
      program->take_info(0, info.data()); require(info[PF_TAKE_SOURCE_END] == cut && info[PF_TAKE_SELECTION] == 1, "manual Play applies and reports retained prefix view");
      program->beat(PF_PLAYING, 87, 1, 0, 349 * count, 98); program->take_info(0, info.data());
      require(info[PF_TAKE_SOURCE_END] == -1 && info[PF_TAKE_SELECTION] == 0, "full view restores source and reports actual selection without replacing recording");
      program->stop(); watch_heap = false;
      require(!heap_allocations && !heap_frees, "prefix capture, bank reuse and selection perform no heap operations");
    }
    Engine retained(rate); prepare(retained, data);
    ok(retained, pf_start(retained, 98, 1, 82, 88, 0, 0)); until(retained, 82);
    ok(retained, press(retained, 0)); until(retained, 83); pf_stop(retained);
    auto saved = take(retained, 0); require(saved[PF_TAKE_READY], "atomic replacement fixture retains committed source");
    for (int mutation = 0; mutation < 8; ++mutation) {
      auto invalid = data;
      if (mutation == 0) invalid.back() = 5;
      if (mutation == 1) invalid.back() = 0;
      if (mutation == 2) invalid.back() = std::numeric_limits<double>::quiet_NaN();
      if (mutation == 3) invalid.back() = .0001;
      if (mutation == 4) invalid[invalid.size() - 4] = 2;
      if (mutation == 5) invalid.insert(invalid.end(), {PF_COMPILED_WINDOW_MAGIC, 0});
      if (mutation == 6) invalid.push_back(42);
      if (mutation == 7) invalid.pop_back();
      require(!compiled::Program::create(invalid.data(), invalid.size(), rate, *definition, 1), "malformed prefix table rejects atomically");
      require(pf_configure_compiled(retained, invalid.data(), invalid.size()) < 0 && take(retained, 0) == saved,
        "malformed prefix replacement preserves existing immutable take and prepared graph");
    }
  }
}

void chart_knob_cues_and_tail() {
  const std::vector<double> song{
    PF_COMPILED_MAGIC, PF_COMPILED_VERSION, 4, 6, 120, 6, 25, 25, 2, 4, 2, 0, 0, 1, 2, 3,
    0, 1, 0, 2, 0, 1, 2, 0, 0,
    1, 2, 0, 3, 0, 1, 3, 0, 1,
    0, 0, 0, -1, PF_ARM, 1, 0, 0, -1, -1, 0, 0, 0, 0, -1, 0,
    0, 0, 1, -1, PF_COMMIT, 1, 0, -1, 0, 0, 0, 0, 0, 0, -1, 0,
    1, 1, 1, -1, PF_ARM, 1, 0, 1, -1, -1, 0, 0, 0, 0, -1, 0,
    1, 1, 2, -1, PF_COMMIT, 1, 0, -1, 1, 1, 0, 0, 0, 0, -1, 0,
    0, 0, 1, 1, 1, 1,
    PF_COMPILED_NOTES_MAGIC, 1, 0, 0, 6, 0, 100,
    PF_COMPILED_KNOB_MAGIC, 4,
    3, 1, -1, 3, 0, 0,
    3, 3, 1, 3, 1, 1,
    4, 1, -1, 1, 0, 0,
    4, 1.5, 1, 1, 1, 0,
    PF_COMPILED_TAIL_MAGIC, 1, 6,
  };
  Engine engine;
  prepare(engine, song);
  ok(engine, pf_set_jiggle_thresholds(engine, 4, 2));
  std::array<float, 100> ending{}; ending.fill(.9f);
  ok(engine, pf_prepare_external_sample(engine, 0, ending.data(), ending.data(), ending.size()));
  ok(engine, pf_start(engine, 120, 1, 1, 6, 0, 0));
  until(engine, 1); ok(engine, press(engine, 1));
  until(engine, 3);
  auto playing = [&](int id) { return take(engine, id)[PF_TAKE_PLAYBACK_STATE] == int(patches::PlaybackState::playing); };
  auto turn = [&](double delta) { ok(engine, pf_control(engine, 5, delta, nullptr, 0)); };
  require(playing(0) && playing(1), "both backing loops captured and playing");
  turn(-8);
  require(playing(0) && playing(1), "turns outside the knob cue window leave loops playing");
  until(engine, 3, 2); turn(8); turn(-1); turn(-1); turn(-1);
  require(playing(0) && playing(1), "wrong direction and motion below the travel threshold are ignored");
  turn(-1);
  require(!playing(0) && !playing(1), "the recognized turn stops both backing voices");
  until(engine, 3, 4); turn(4);
  require(!playing(0) && !playing(1), "the resume waits for the next downbeat");
  until(engine, 4);
  require(playing(0) && playing(1), "next-bar resume starts both retained loops");
  until(engine, 4, 2); turn(-4);
  require(!playing(0) && playing(1), "the later stop only affects its assigned voice");
  render(engine, 2001); turn(4);
  require(playing(0) && playing(1), "the offbeat turn brings back just the stopped voice");
  until(engine, 6);
  const auto backing = render(engine, 4);
  require(!playing(0) && !playing(1) && backing.left.front() == 0, "the Tail downbeat releases all backing playback");
  ok(engine, press(engine, 0));
  const auto final_note = render(engine, 4);
  require(final_note.left.front() == .9f && state(engine)[PF_PHASE] == PF_PLAYING, "the final manual note rings inside Tail");
  pf_stop(engine);
  const auto retained = take(engine, 0);
  for (int edit = 0; edit < 3; ++edit) {
    auto invalid = song;
    if (edit == 0) invalid.back() = 5;
    if (edit == 1) invalid[invalid.size() - 6] = 0;
    if (edit == 2) invalid[invalid.size() - 5] = 16;
    require(pf_configure_compiled(engine, invalid.data(), invalid.size()) < 0 && take(engine, 0) == retained,
      "malformed knob and Tail sections reject without replacing the retained take");
  }
}

}
int main() { chart_knob_cues_and_tail(); tambourine_audition_uses_sample_output(); committed_sample_exports_are_bounded_and_owned(); jiggle_reconnect_preserves_partial_gesture_and_clock(); cue_warning_reads_preserve_state_without_heap_work(); song_lead_in_cue_belongs_to_bar_one(); jiggle_filters_small_motion_in_bounded_musical_buckets(); unified_button_reports_independent_failures(); unified_button_and_light_priority(); prefix_late_arm_zero_cut(); prefix_effected_source_oracle(); prefix_capture_maps_and_selection(); authored_capture_end_finishes_without_finish_press(); automatic_finish_matches_manual_pcm(); missing_play_and_stop_remain_manual(); early_capture_admission_has_bounded_source_capacity(); loop_wrap_discards_unfinished_capture_and_preserves_latest(); rotation_releases_after_inactivity(); rotation_refresh_at_boundary_has_continuous_pcm(); rotation_metadata_rejects_invalid_programs_atomically(); independent_profiles_and_reload_have_real_graphs(); rotation_graph_order_and_tail_pcm(); rotation_uses_musical_time_and_preserves_capture(); capture_layers_and_boundaries(); load_atomicity_and_six_counts(); malformed_capture_graphs_preserve_loaded_take(); stale_bank_rejection_preserves_looping_transport(); joined_capture_suffix_and_phase(); full_capture_plays_on_the_commit_frame(); actual_rate_quantization_join(); tempo_intent_proximity_and_ties(); pedal_bar_boundary_preserves_capture_at_device_rate(); tempo_change_preserves_layered_capture(); layer_can_join_after_returning_to_capture_tempo(); joined_path_and_tempo_have_no_heap_work(); tempo_provenance_retry_and_blank_cell(); tempo_hits_require_active_practice(); stopped_partial_capture_preserves_latest(); disjoint_reservation_handoff_both_orders(); missed_commit_finishes_before_reserved_start(); detached_tail_three_impulse_oracle(); crb_history_has_one_audible_owner(); commit_preflights_entire_selection_before_publication(); tempo_change_preserves_same_boundary_start(); crb_unavailable_start_preserves_old_capture(); independent_unavailable_arm_does_not_rollback_commit(); prepared_capture_reuses_banks_without_heap_work(); automatic_finish_preserves_same_voice_armed_route(); std::puts("Compiled native program tests passed."); return 0; }
