#include "performance_engine.h"
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
void ok(pf_engine* engine, int result) { if (result < 0) { std::fprintf(stderr, "%s\n", pf_error(engine)); std::abort(); } }
std::array<double, PF_FIELDS> state(pf_engine* engine) { std::array<double, PF_FIELDS> out{}; pf_snapshot(engine, out.data()); return out; }
std::array<double, PF_TAKE_FIELDS> take(pf_engine* engine, int id) { std::array<double, PF_TAKE_FIELDS> out{}; pf_compiled_take_info(engine, id, out.data()); return out; }
struct Engine {
  pf_engine* value = pf_create(8000, PF_PRACTICE, 32, 30, 4);
  Engine() { require(value, "engine creation"); }
  ~Engine() { pf_destroy(value); }
  operator pf_engine*() { return value; }
};
std::vector<double> table(int beats = 4) {
  std::vector<double> data{PF_COMPILED_MAGIC, PF_COMPILED_VERSION, double(beats), 4, 120, 4, .2, .2, 3, 6, 4, 0, 0, 1, 2, 3};
  const double takes[] = {0, 1, 0, 2, 0, 1, 0, 2, 0, 3, 0, 1, 1, 2, 0, 3, 0, 1};
  data.insert(data.end(), std::begin(takes), std::end(takes));
  const double cues[] = {
    0, 0, 0, -1, PF_ARM, 1, 0, 0, -1, -1,
    0, 0, 1, -1, PF_COMMIT_ARM, 1, 0, 1, 0, 0,
    0, 0, 2, -1, PF_COMMIT, 1, 0, -1, 1, 1,
    1, 1, 1, -1, PF_ARM, 1, 0, 2, -1, -1,
    0, 0, 3, 3, PF_STOP, 2, 3.25, -1, -1, -1,
    1, 1, 2, -1, PF_COMMIT, 1, 0, -1, 2, 2
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
  for (int count = 0; count < 200000; ++count) {
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
  auto before_overlap = take(engine, 0);
  require(press(engine, 1) < 0 && state(engine)[PF_ERROR] == PF_CAPTURE_BUSY, "armed/recording owner rejects cross-voice overlap");
  require(take(engine, 0) == before_overlap && !take(engine, 2)[PF_TAKE_READY], "overlap rejection preserves current capture and unrelated take");
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
  auto stop = render(engine, remaining + 801);
  require(std::abs(stop.left[remaining - 1] - .625f) < 1e-6, "fractional stop does not run before 4e");
  require(std::abs(stop.left[remaining] - .125f) < 1e-6, "fractional stop starts natural release exactly at 4e");
  require(stop.left[remaining + 800] == 0, "effected playback tail drains without another baked pass");
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
  changed.insert(changed.begin() + members, {0, 0, 1, -1, PF_PLAY, 0, 0, -1, -1, 1}); ++changed[9];
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
  changed.insert(changed.begin() + members, {0, 0, 3, -1, PF_PLAY, 0, 0, -1, -1, -1}); ++changed[9];
  invalid.push_back(changed);
  for (const auto& data : invalid) {
    require(pf_configure_compiled(engine, data.data(), uint32_t(data.size())) < 0 && state(engine)[PF_ERROR] == PF_INVALID_PROGRAM, "inconsistent capture graph rejects before resource replacement");
    require(take(engine, 0) == retained, "invalid capture graph preserves committed PCM metadata and playback state");
  }
  ok(engine, pf_start(engine, 120, 0, 3, 4, 0, 0)); until(engine, 3); ok(engine, press(engine, 0));
  require(std::abs(render(engine, 1).left[0] - .3125f) < 1e-6, "old committed PCM remains audible after rejected replacements");
  pf_stop(engine);
  ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0));
  ok(engine, press(engine, 0));
  until(engine, 1);
  require(take(engine, 0)[PF_TAKE_LENGTH] <= 1, "old program can record again after rejected replacements");
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
int main() { capture_layers_and_boundaries(); load_atomicity_and_six_counts(); malformed_capture_graphs_preserve_loaded_take(); prepared_capture_reuses_banks_without_heap_work(); std::puts("Compiled native program tests passed."); }
