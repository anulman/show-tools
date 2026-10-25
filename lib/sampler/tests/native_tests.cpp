#include "sample_engine.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <vector>

namespace {
void require(bool condition) { if (!condition) { std::fputs("Native sampler assertion failed.\n", stderr); std::abort(); } }
struct Engine {
  st_engine* value;
  Engine(double rate = 8, int voices = 32, int slots = 8): value(st_create(rate, voices, slots, 30)) { require(value); }
  ~Engine() { st_destroy(value); }
  operator st_engine*() { return value; }
};
void ok(st_engine* engine, int result) { if (result < 0) { std::fprintf(stderr, "%s\n", st_error(engine)); std::abort(); } }
std::vector<float> render(st_engine* engine, double frame, unsigned frames) {
  std::vector<float> output(frames, 0);
  st_render(engine, output.data(), nullptr, frames, frame);
  return output;
}
void expect(const std::vector<float>& actual, std::initializer_list<float> expected) {
  require(actual.size() == expected.size());
  unsigned index = 0;
  for (float sample : expected) require(std::abs(actual[index++] - sample) < 1e-6);
}
void capture_bounds() {
  Engine engine;
  std::array<float, 12> input{};
  for (unsigned i = 0; i < input.size(); ++i) input[i] = float(i + 100);
  ok(engine, st_prepare(engine, 0, 0, 30, -1, nullptr, 0, 0));
  ok(engine, st_start(engine, 0, 2.25, 0));
  st_capture(engine, input.data(), 3, 0);
  st_capture(engine, input.data() + 3, 5, 3);
  require(st_stop(engine, 0, 7.25, 3) == 1);
  double info[ST_SLOT_FIELDS]; st_slot_info(engine, 0, 0, info);
  require(info[ST_SLOT_FRAMES] == 5 && info[ST_SLOT_START] == 3);
  ok(engine, st_trigger(engine, 0, 8, 1, 0, -1, -1));
  expect(render(engine, 8, 7), {103, 104, 105, 106, 107, 0, 0});
}
void stereo_resample_and_controls() {
  Engine engine;
  float left[] = {1, 0.5f}, right[] = {0, -0.5f};
  ok(engine, st_load(engine, 0, left, right, 2, 4));
  left[0] = 99; right[0] = 99;
  ok(engine, st_trigger(engine, 0, 0, 1, ST_LOOP, -1, -1));
  require(st_is_looping(engine, 0) && !st_is_looping(engine, 1));
  float l[4]{}, r[4]{}; st_render(engine, l, r, 4, 0);
  expect(std::vector<float>(l, l + 4), {1, .75f, .5f, .75f});
  expect(std::vector<float>(r, r + 4), {0, -.25f, -.5f, -.25f});
  ok(engine, st_set_channel(engine, 0, .5, 1));
  expect(render(engine, 4, 2), {0, 0});
  ok(engine, st_set_channel(engine, 0, .5, 0));
  expect(render(engine, 6, 2), {0, .125f});
}
void replacement_and_retained_variants() {
  Engine engine;
  float pair[] = {0, 0, .001f, .002f};
  float single[] = {0, 0, .003f, 0};
  ok(engine, st_prepare(engine, 0, 0, 1, 0, nullptr, 0, 0));
  ok(engine, st_start(engine, 0, 0, 0));
  ok(engine, st_prepare(engine, 0, 1, 1, 1, nullptr, 0, 0));
  st_capture(engine, pair, 4, 0);
  require(st_stop(engine, 0, 4, 3) == 1);
  ok(engine, st_trigger(engine, 0, 4, 1, ST_LOOP, -1, -1));
  ok(engine, st_start(engine, 0, 4, 1));
  st_capture(engine, single, 4, 4);
  expect(render(engine, 4, 4), {0, 0, .001f, .002f});
  require(st_stop(engine, 0, 8, 3) == 1);
  require(st_has(engine, 0, 0) && st_has(engine, 0, 1));
  ok(engine, st_trigger(engine, 0, 8, 1, ST_LOOP, -1, 1));
  expect(render(engine, 8, 4), {0, 0, .003f, 0});
  ok(engine, st_trigger(engine, 0, 12, 1, ST_LOOP, -1, 0));
  expect(render(engine, 12, 4), {0, 0, .001f, .002f});
  float replacement[] = {.25f};
  ok(engine, st_load(engine, 0, replacement, nullptr, 1, 8));
  require(!st_has(engine, 0, 0));
  expect(render(engine, 16, 4), {0, 0, .001f, .002f});
}
void sparse_capture() {
  Engine engine(8000);
  std::vector<float> input(16000, .001f);
  input[2000] = .9f;
  for (const auto& hit : {std::pair<int, double>{14010, .6}, {14990, .3}})
    for (int frame = 0; frame < 600; ++frame) input[hit.first + frame] += float(hit.second * std::exp(-frame / 200.0) * std::cos(frame * .7));
  double expected[] = {14000, 15000};
  ok(engine, st_prepare(engine, 0, 0, 2, 0, expected, 2, 600));
  ok(engine, st_start(engine, 0, 0, 0));
  require(st_capture(engine, input.data(), unsigned(input.size()), 0) == 1);
  require(st_slice_count(engine, 0, 0) == 2);
  double first[4], second[4]; st_sample_slice(engine, 0, 0, 0, first); st_sample_slice(engine, 0, 0, 1, second);
  require(first[0] == 1 && first[1] == 14010 && first[3] == 14000);
  require(second[0] == 1 && second[1] == 14990 && second[3] == 15000);
  ok(engine, st_trigger(engine, 0, 16000, 1, ST_LOOP, -1, 0));
  auto output = render(engine, 16000, 16000);
  require(output[2000] == 0);
  require(output[14000] == input[14010]);
  require(output[15000] == input[14990]);
}
void empty_limit_and_validation() {
  Engine engine;
  float old[] = {.5f};
  ok(engine, st_load(engine, 0, old, nullptr, 1, 8));
  ok(engine, st_prepare(engine, 0, 0, .5, -1, nullptr, 0, 0));
  ok(engine, st_start(engine, 0, 0, 0));
  require(st_stop(engine, 0, 0, 3) == 0);
  ok(engine, st_trigger(engine, 0, 0, 1, 0, -1, -1));
  expect(render(engine, 0, 1), {.5f});
  ok(engine, st_prepare(engine, 0, 0, .5, -1, nullptr, 0, 0));
  ok(engine, st_start(engine, 0, 0, 0));
  float bad[] = {NAN, INFINITY, -INFINITY, -.5f};
  require(st_capture(engine, bad, 4, 0) == 1);
  double slot[ST_SLOT_FIELDS]; st_slot_info(engine, 0, 0, slot);
  require(slot[ST_SLOT_REASON] == ST_LIMIT && !slot[ST_SLOT_RECORDING]);
  ok(engine, st_trigger(engine, 0, 1, 1, 0, -1, -1));
  expect(render(engine, 1, 4), {0, 0, 0, -.5f});
  require(st_prepare(engine, 1, 0, 30, -1, nullptr, 17, 1) < 0);
  st_slot_info(engine, 1, 0, slot); require(!slot[ST_SLOT_PRESENT]);
  require(st_set_channel(engine, 0, 2, 0) < 0);
  require(st_load(engine, 0, bad, nullptr, 4, 8) < 0);
}
void deferred_collection_and_voice_stealing() {
  Engine engine(8, 1);
  float first[] = {.5f, .25f}, second[] = {.75f};
  ok(engine, st_load(engine, 0, first, nullptr, 2, 8));
  ok(engine, st_trigger(engine, 0, 0, 1, ST_LOOP, -1, -1));
  ok(engine, st_load(engine, 0, second, nullptr, 1, 8));
  expect(render(engine, 0, 2), {.5f, .25f});
  ok(engine, st_trigger(engine, 0, 2, 1, ST_LOOP, -1, -1));
  expect(render(engine, 2, 2), {.75f, .75f});
  double before[ST_STATS_FIELDS], after[ST_STATS_FIELDS]; st_stats(engine, before);
  st_stop_all_voices(engine); st_stats(engine, after);
  require(!st_is_looping(engine, 0));
  require(before[ST_STATS_MEMORY_BYTES] == after[ST_STATS_MEMORY_BYTES]);
  ok(engine, st_load(engine, 1, second, nullptr, 1, 8));
  st_stats(engine, after);
  require(after[ST_STATS_MEMORY_BYTES] == 8);
  ok(engine, st_trigger(engine, 0, 4, 1, 0, -1, -1));
  ok(engine, st_trigger(engine, 1, 4, 1, 0, -1, -1));
  st_stats(engine, after); require(after[ST_STATS_STOLEN] == 1);
}
void numeric_boundaries_preserve_state() {
  constexpr double max_frame = 9007199254740991.0;
  const double infinity = std::numeric_limits<double>::infinity();
  const double nan = std::numeric_limits<double>::quiet_NaN();
  const double largest = std::numeric_limits<double>::max();
  for (double rate : {0.0, .5, 384001.0, largest, infinity, nan}) require(st_create(rate, 1, 1, 1) == nullptr);
  for (double rate : {1.0, 384000.0}) { auto* edge = st_create(rate, 1, 1, 1); require(edge); st_destroy(edge); }

  Engine engine;
  const float pcm[] = {.25f, .5f};
  ok(engine, st_load(engine, 0, pcm, nullptr, 2, 8));
  for (double rate : {.5, 384001.0, largest, infinity, nan}) require(st_load(engine, 0, pcm, nullptr, 2, rate) < 0);
  ok(engine, st_prepare(engine, 1, 0, 1, -1, nullptr, 0, 0));
  for (double frame : {infinity, -infinity, nan, largest, -largest, max_frame + 1, -max_frame - 1}) {
    require(st_start(engine, 1, frame, 0) < 0);
    require(st_trigger(engine, 0, frame, 1, ST_LOOP, -1, -1) < 0);
  }
  ok(engine, st_start(engine, 1, 0, 0));
  ok(engine, st_trigger(engine, 0, 0, 1, ST_LOOP, -1, -1));
  double before[ST_STATS_FIELDS], after[ST_STATS_FIELDS], slot_before[ST_SLOT_FIELDS], slot_after[ST_SLOT_FIELDS];
  st_stats(engine, before); st_slot_info(engine, 1, 0, slot_before);
  for (double frame : {infinity, -infinity, nan, largest, -largest, max_frame, -max_frame}) {
    float left[] = {.125f, -.125f}, right[] = {-.25f, .25f};
    require(st_capture(engine, pcm, 2, frame) == 0);
    require(std::strcmp(st_error(engine), "Invalid capture frame range") == 0);
    st_render(engine, left, right, 2, frame);
    require(std::strcmp(st_error(engine), "Invalid render frame range") == 0);
    require(left[0] == .125f && left[1] == -.125f && right[0] == -.25f && right[1] == .25f);
    st_stats(engine, after); st_slot_info(engine, 1, 0, slot_after);
    require(std::equal(std::begin(before), std::end(before), std::begin(after)));
    require(std::equal(std::begin(slot_before), std::end(slot_before), std::begin(slot_after)));
  }
  for (double frame : {infinity, -infinity, nan, largest, -largest, max_frame + 1, -max_frame - 1}) require(st_stop(engine, 1, frame, 3) < 0);
  require(st_capture(engine, pcm, 2, 0) == 0);
  require(st_stop(engine, 1, 2, 3) == 1);
  expect(render(engine, 0, 4), {.25f, .5f, .25f, .5f});
  ok(engine, st_trigger(engine, 0, max_frame, 1, 0, -1, -1));
  st_stop_all_voices(engine);
  ok(engine, st_load(engine, 0, pcm, nullptr, 2, ST_MAX_SAMPLE_RATE));
  ok(engine, st_trigger(engine, 0, 0, 1, ST_LOOP, -1, -1));
  for (float sample : render(engine, max_frame - 4, 4)) require(std::isfinite(sample));
}
}
int main() {
  capture_bounds(); stereo_resample_and_controls(); replacement_and_retained_variants();
  sparse_capture(); empty_limit_and_validation(); deferred_collection_and_voice_stealing(); numeric_boundaries_preserve_state();
  std::puts("Native sampler capture, stereo, variants, sparse playback, lifecycle, and ownership checks passed.");
}
