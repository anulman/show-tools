#include "performance_engine.h"
#include "patch_engine.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
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
  pf_engine* value = pf_create(8000, PF_PRACTICE, 32, 30, 4);
  Engine() { require(value, "engine creation"); }
  ~Engine() { pf_destroy(value); }
  operator pf_engine*() { return value; }
};
std::vector<double> table(int beats = 4) {
  std::vector<double> data{PF_COMPILED_MAGIC, PF_COMPILED_VERSION, double(beats), 4, 120, 4, 25, 25, 3, 7, 4, 0, 0, 1, 2, 3};
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
  auto remaining = uint32_t(std::ceil(clock[PF_CLOCK_BEAT_FRAME] + 1000) - clock[PF_FRAME]);
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
  changed.erase(changed.begin() + cues, changed.begin() + cues + PF_COMPILED_CUE_FIELDS); --changed[9];
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
  changed.erase(changed.begin() + cues + 2 * PF_COMPILED_CUE_FIELDS, changed.begin() + cues + 3 * PF_COMPILED_CUE_FIELDS); --changed[9];
  invalid.push_back(changed);
  changed = good;
  changed[cues + 2 * PF_COMPILED_CUE_FIELDS + 8] = 0;
  invalid.push_back(changed);
  changed = good;
  changed[cues + 2 * PF_COMPILED_CUE_FIELDS + 9] = 0;
  invalid.push_back(changed);
  changed = good;
  changed.insert(changed.begin() + cues, good.begin() + cues, good.begin() + cues + PF_COMPILED_CUE_FIELDS); ++changed[9];
  invalid.push_back(changed);
  const size_t members = cues + size_t(good[9]) * PF_COMPILED_CUE_FIELDS;
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
  changed[cues + 4 * PF_COMPILED_CUE_FIELDS + 9] = 0;
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
    changed[cues + cue * PF_COMPILED_CUE_FIELDS + 9] = -1;
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
    PF_COMPILED_MAGIC, PF_COMPILED_VERSION, 4, 4, 120, 4, 25, 25, 1, 2, 1, 0, 0, 1, 2, 3,
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
  const auto retained = take(engine, 0);
  const auto before = channel(engine, 0);
  std::array<float, 128> input{}, left{}, right{}, live_left{}, live_right{}; input.fill(.25f);
  heap_allocations = heap_frees = 0; watch_heap = true;
  require(press(engine, 0) < 0 && state(engine)[PF_ERROR] == PF_TAKE_UNAVAILABLE, "stale spare bank rejects recapture before route or owner mutation");
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
    PF_COMPILED_MAGIC, PF_COMPILED_VERSION, 4, 6, 120, 6, 25, 25, 2, 3, 3, 0, 0, 1, 2, 3,
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
  require(first[PF_TAKE_PHASE] == 24000 && second[PF_TAKE_PHASE] == 24000, "new layer joins existing phrase phase without restarting either member");
  auto joined = render(engine, 1);
  require(std::abs(joined.left[0] - .375f) < 1e-6, "join outputs old loop plus new end-state tail, with no restarted note");
  require(std::abs(joined.live_left[0] - .25f) < 1e-6, "capture-end shadow is sole audible owner of outgoing voice tail");
  auto suffix = render(engine, 7999);
  require(std::abs(suffix.left.back() - .3125f) < 1e-6, "declared suffix consumes zero source after natural tail drains");
  auto wrapped = render(engine, 801);
  require(std::abs(wrapped.left.back() - .625f) < 1e-6 && take(engine, 0)[PF_TAKE_PHASE] == take(engine, 1)[PF_TAKE_PHASE], "both layers wrap in unison while effects history evolves");
  pf_stop(engine);
  auto invalid = joined_table(); invalid[PF_COMPILED_HEADER_FIELDS + PF_COMPILED_TAKE_FIELDS + 6] = 6;
  require(pf_configure_compiled(engine, invalid.data(), uint32_t(invalid.size())) < 0, "unequal explicit loop periods reject before replacement");
  require(take(engine, 0)[PF_TAKE_READY] && take(engine, 1)[PF_TAKE_READY], "period graph failure preserves prior audio");
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
    PF_COMPILED_MAGIC, PF_COMPILED_VERSION, 4, 4, 120, 4, 25, 25, 1, double(tied ? 5 : 4), 1, 0, 0, 1, 2, 3,
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
  auto intact = channel(miss, 0);
  require(press(miss, 0) < 0 && state(miss)[PF_ERROR] == PF_CUE_LATE && channel(miss, 0) == intact, "outside the millisecond window cannot toggle existing loops");
  Engine ties; ready_tempo_song(ties, 0, true); render(ties, 4124); intact = channel(ties, 0);
  require(press(ties, 0) < 0 && state(ties)[PF_ERROR] == PF_CUE_AMBIGUOUS && channel(ties, 0) == intact, "equidistant eligible cues reject without selecting list order");
  Engine empty; prepare(empty, tempo_table()); ok(empty, pf_start(empty, 120, 0, 3, 4, 0, 0)); until(empty, 3);
  require(press(empty, 0) < 0 && state(empty)[PF_ERROR] == PF_NO_SAMPLE && tempo(empty)[PF_TEMPO_COUNT] == 0, "star preflights playback before applying any tempo effect");
}

void mismatch_keeps_prior_audio() {
  Engine engine; prepare(engine, joined_table());
  ok(engine, pf_start(engine, 120, 1, 1, 6, 0, 0)); ok(engine, press(engine, 0));
  until(engine, 2); ok(engine, press(engine, 0)); until(engine, 3);
  ok(engine, pf_control(engine, 6, 0, nullptr, 0)); render(engine, 4800); ok(engine, pf_control(engine, 6, 0, nullptr, 0));
  require(tempo(engine)[PF_TEMPO_BPM] == 100, "mismatch fixture changes capture tempo without phase reset");
  until(engine, 4, 2); ok(engine, press(engine, 0)); until(engine, 4, 3);
  require(take(engine, 0)[PF_TAKE_READY] && !take(engine, 1)[PF_TAKE_READY] && take(engine, 1)[PF_TAKE_LENGTH] == 0, "period/phase mismatch discards only incomplete draft and retains prior take");
  require(state(engine)[PF_PHASE] == PF_PLAYING && channel(engine, 0)[PF_CHANNEL_LOOPING], "period mismatch is nonfatal to transport and existing playback");
  auto out = render(engine, 128);
  require(std::all_of(out.left.begin(), out.left.end(), [](float value) { return std::abs(value - .3125f) < 1e-6; }), "period mismatch leaves previous loop audible without restart");
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
  until(engine, 4); auto intact = channel(engine, 0); ok(engine, press(engine, 0));
  require(channel(engine, 0) == intact, "blank compiled column performs no action on existing loop");
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
    PF_COMPILED_MAGIC, PF_COMPILED_VERSION, 4, 7, 120, 7, 25, 25, 2, 4, 2, 0, 0, 1, 2, 3,
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
void missed_commit_rejects_start_nonfatally() {
  Engine engine; prepare(engine, disjoint_handoff_table());
  ok(engine, pf_start(engine, 120, 1, 1, 7, 0, 0)); until(engine, 2); ok(engine, press(engine, 2)); until(engine, 3); until(engine, 4);
  ok(engine, press(engine, 1));
  std::array<double, PF_EVENT_CAPACITY * PF_EVENT_FIELDS> events{}; pf_drain_events(engine, events.data(), PF_EVENT_CAPACITY);
  until(engine, 5);
  uint32_t count = pf_drain_events(engine, events.data(), PF_EVENT_CAPACITY); int rejected = 0;
  for (uint32_t index = 0; index < count; ++index) {
    const double* row = events.data() + index * PF_EVENT_FIELDS;
    require(row[PF_EVENT_TYPE] != PF_FAULT, "missed commit causes no fatal event or silent global stop");
    if (row[PF_EVENT_TYPE] == PF_CONTROL && row[PF_EVENT_APPLIED] == 0) {
      ++rejected;
      require(row[PF_EVENT_ERROR] == PF_CAPTURE_BUSY && row[PF_EVENT_CONTROL] == 1 && row[PF_EVENT_CUE] == 2 && row[PF_EVENT_FRAME] == std::ceil(state(engine)[PF_CLOCK_BEAT_FRAME]), "queued rejection carries actual boundary, source cue index, button and capture-busy reason");
    }
  }
  require(rejected == 1 && !take(engine, 0)[PF_TAKE_READY] && !take(engine, 1)[PF_TAKE_READY], "missed performer commit is never supplied automatically");
  auto length = take(engine, 0)[PF_TAKE_LENGTH]; auto audio = render(engine, 128);
  require(take(engine, 0)[PF_TAKE_LENGTH] == length + 128 && state(engine)[PF_PHASE] == PF_PLAYING && channel(engine, 2)[PF_CHANNEL_STATUS] == PF_RECORDING, "busy queued start preserves old capture and advancing transport");
  require(channel(engine, 1)[PF_CHANNEL_PENDING_KIND] == PF_NONE && std::all_of(audio.live_left.begin(), audio.live_left.end(), [](float value) { return std::abs(value - .3125f) < 1e-6; }), "failed reservation clears only pending start and preserves authorized monitor output");
  Engine immediate; prepare(immediate, disjoint_handoff_table(true));
  ok(immediate, pf_start(immediate, 120, 1, 1, 7, 0, 0)); until(immediate, 2); ok(immediate, press(immediate, 2)); until(immediate, 5);
  auto before = take(immediate, 0);
  require(press(immediate, 1) < 0 && state(immediate)[PF_ERROR] == PF_CAPTURE_BUSY && take(immediate, 0) == before && take(immediate, 1)[PF_TAKE_LENGTH] == 0, "immediate overlapping actual recording rejects atomically even when declared spans are disjoint");
  auto invalid = disjoint_handoff_table();
  invalid[PF_COMPILED_HEADER_FIELDS + PF_COMPILED_TAKE_FIELDS + 1] = 4;
  invalid[PF_COMPILED_HEADER_FIELDS + PF_COMPILED_TAKE_FIELDS + 3] = 6;
  invalid[PF_COMPILED_HEADER_FIELDS + PF_COMPILED_TAKE_FIELDS + 6] = 6;
  const size_t cues = PF_COMPILED_HEADER_FIELDS + 2 * PF_COMPILED_TAKE_FIELDS;
  invalid[cues + 2 * PF_COMPILED_CUE_FIELDS + 2] = 3;
  invalid[cues + 3 * PF_COMPILED_CUE_FIELDS + 2] = 5;
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
    PF_COMPILED_MAGIC, PF_COMPILED_VERSION, 4, 5, 120, 5, 25, 25, 4, 8, 7, 0, 0, 1, 2, 3,
    0, 1, 0, 2, 0, 1, 2, 0, 0,
    0, 2, 0, 3, 0, 1, 3, 0, 0,
    0, 3, 0, 4, 0, 1, 4, 0, 0,
    1, 4, 0, 5, 0, 1, 5, 0, 3,
    0, 0, 0, -1, PF_ARM, 1, 0, 0, -1, -1, 0,
    0, 0, 1, -1, PF_COMMIT, 1, 0, -1, 0, 0, 0,
    0, 0, 2, 0, PF_ARM, 0, 0, 1, -1, -1, 0,
    0, 0, 2, 1, PF_COMMIT, 1, 0, -1, 1, 1, 0,
    0, 0, 3, 0, PF_ARM, 0, 0, 2, -1, -1, 0,
    0, 0, 3, 1, PF_COMMIT, 1, 0, -1, 2, 2, 0,
    1, 1, 3, 1, PF_ARM, 1, 0, 3, -1, -1, 0,
    1, 1, 4, -1, PF_COMMIT, 1, 0, -1, 3, 3, 0,
    0, 0, 1,
    1, 0, 1, 1, 1, 1,
    2, 0, 1, 2, 1, 1, 2, 2, 1,
    3, 3, 1
  };
}
void commit_preflights_entire_selection_before_publication() {
  Engine engine; prepare(engine, missing_middle_handoff_table());
  ok(engine, pf_start(engine, 120, 1, 1, 5, 0, 0)); ok(engine, press(engine, 0)); until(engine, 1); ok(engine, press(engine, 0)); until(engine, 2);
  until(engine, 3); ok(engine, press(engine, 0)); until(engine, 3, 2); ok(engine, press(engine, 0)); ok(engine, press(engine, 1));
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
  auto first = take(engine, 0); auto draft_length = take(engine, 2)[PF_TAKE_LENGTH]; auto audio = render(engine, 128);
  require(first[PF_TAKE_READY] && first[PF_TAKE_LENGTH] == 16000 && take(engine, 2)[PF_TAKE_LENGTH] == draft_length + 128 && state(engine)[PF_PHASE] == PF_PLAYING, "selection preflight preserves committed PCM and active old recording without resetting its live Rack");
  require(std::all_of(audio.left.begin(), audio.left.end(), [](float value) { return std::abs(value - .3125f) < 1e-6; }), "only prior committed loop remains audible after rejected group publication");
}
void failed_period_blocks_same_boundary_start() {
  const std::vector<double> song{
    PF_COMPILED_MAGIC, PF_COMPILED_VERSION, 4, 6, 120, 6, 25, 25, 3, 5, 4, 0, 0, 1, 2, 3,
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
  require(take(engine, 0)[PF_TAKE_READY] && !take(engine, 1)[PF_TAKE_READY] && take(engine, 1)[PF_TAKE_LENGTH] == 0 && !take(engine, 2)[PF_TAKE_READY] && take(engine, 2)[PF_TAKE_LENGTH] == 0, "invalid period discards only old draft and cannot automatically start incoming capture after clearing active state");
  uint32_t count = pf_drain_events(engine, events.data(), PF_EVENT_CAPACITY); int mismatches = 0, cancelled = 0;
  for (uint32_t index = 0; index < count; ++index) {
    const double* row = events.data() + index * PF_EVENT_FIELDS;
    require(row[PF_EVENT_TYPE] != PF_FAULT, "period mismatch cleanup remains nonfatal");
    if (row[PF_EVENT_TYPE] == PF_CONTROL && row[PF_EVENT_APPLIED] == 0) {
      if (row[PF_EVENT_CUE] == 2 && row[PF_EVENT_ERROR] == PF_LOOP_MISMATCH) ++mismatches;
      if (row[PF_EVENT_CUE] == 3 && row[PF_EVENT_ERROR] == PF_CAPTURE_BUSY) ++cancelled;
    }
  }
  require(mismatches == 1 && cancelled == 1 && channel(engine, 1)[PF_CHANNEL_STATUS] != PF_ARMED && channel(engine, 1)[PF_CHANNEL_STATUS] != PF_RECORDING, "period cleanup reports both source cues and clears the cancelled incoming reservation");
  auto audio = render(engine, 128);
  require(state(engine)[PF_PHASE] == PF_PLAYING && std::all_of(audio.left.begin(), audio.left.end(), [](float value) { return std::abs(value - .3125f) < 1e-6; }), "failed paired boundary preserves prior committed sample and transport");
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
  pf_stop(engine); require(take(engine, 0)[PF_TAKE_READY] && take(engine, 0)[PF_TAKE_LENGTH] == 16000 && take(engine, 1)[PF_TAKE_READY], "atomic CRB failure preserves both prior committed takes");
}
void independent_unavailable_arm_does_not_rollback_commit() {
  const std::vector<double> song{
    PF_COMPILED_MAGIC, PF_COMPILED_VERSION, 4, 5, 120, 5, 25, 25, 2, 4, 2, 0, 0, 1, 2, 3,
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
}
int main() { capture_layers_and_boundaries(); load_atomicity_and_six_counts(); malformed_capture_graphs_preserve_loaded_take(); stale_bank_rejection_preserves_looping_transport(); joined_capture_suffix_and_phase(); actual_rate_quantization_join(); tempo_intent_proximity_and_ties(); mismatch_keeps_prior_audio(); joined_path_and_tempo_have_no_heap_work(); tempo_provenance_retry_and_blank_cell(); tempo_hits_require_active_practice(); stopped_partial_capture_preserves_latest(); disjoint_reservation_handoff_both_orders(); missed_commit_rejects_start_nonfatally(); detached_tail_three_impulse_oracle(); crb_history_has_one_audible_owner(); commit_preflights_entire_selection_before_publication(); failed_period_blocks_same_boundary_start(); crb_unavailable_start_preserves_old_capture(); independent_unavailable_arm_does_not_rollback_commit(); prepared_capture_reuses_banks_without_heap_work(); std::puts("Compiled native program tests passed."); }
