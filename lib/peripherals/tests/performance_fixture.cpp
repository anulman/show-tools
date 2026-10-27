#include "peripheral_controls.h"
#include "performance_engine.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>

namespace {
void require(bool value, const char* message) {
  if (!value) { std::fprintf(stderr, "%s\n", message); std::abort(); }
}
struct Engine {
  pf_engine* value = pf_create(8000, PF_PRACTICE, 32, 30, 4);
  ~Engine() { pf_destroy(value); }
};
}

int main() {
  Engine engine;
  require(engine.value, "existing performance engine created");
  auto* input = pp_create();
  require(input, "input prepared");
  require(pp_begin(input, 1, 15, 0) == 0, "fixture knows four released switches");
  const std::array<int, 4> binding{2, 0, 3, 1};
  std::array<double, PF_CUE_FIELDS * 12> cues{};
  for (int slot = 0; slot < 4; ++slot) {
    for (int action = 0; action < 3; ++action) {
      double* row = cues.data() + (slot * 3 + action) * PF_CUE_FIELDS;
      row[PF_CUE_BAR] = action == 2 ? 9 : slot * 2 + action + 1;
      row[PF_CUE_CHANNEL] = binding[slot];
      row[PF_CUE_KIND] = action == 0 ? PF_ARM : action == 1 ? PF_COMMIT : PF_STOP;
      row[PF_CUE_TIMING] = PF_NOW;
      row[PF_CUE_VARIANT] = -1;
    }
  }
  require(pf_configure(engine.value, 240, 4, 10, 10, 40, nullptr, 0, cues.data(), 12, nullptr, 0) == 0, "declared compatibility fixture configured");
  require(pf_set_microphone(engine.value, 1) == 0, "synthetic source ready");
  require(pf_set_click(engine.value, 0) == 0, "isolate sample PCM");
  require(pf_start(engine.value, 240, 0, 1, 10, 0, 0) == 0, "start owned clock");
  std::array<float, 128> source{}, left{}, right{};
  source.fill(.125f);
  auto process = [&] {
    left.fill(0); right.fill(0);
    require(pf_process(engine.value, source.data(), left.data(), right.data(), source.size()) == 0, "real PCM block");
  };
  auto reach = [&](int bar) {
    std::array<double, PF_FIELDS> state{};
    for (int tries = 0; tries < 1000; ++tries) {
      pf_snapshot(engine.value, state.data());
      if (state[PF_BAR_NUMBER] == bar) return;
      process();
    }
    require(false, "requested bar reached");
  };
  double sequence = 0;
  auto press = [&](uint32_t slot) {
    require(pp_key(input, 1, sequence++, slot, 1) == PP_PRESS, "physical slot presses once");
    require(pf_control(engine.value, binding[slot], 0, nullptr, 0) == 0, "fixture mapping executes through C++ engine");
    require(pp_key(input, 1, sequence++, slot, 1) == PP_IGNORED, "held report does not duplicate cue");
    require(pp_key(input, 1, sequence++, slot, 0) == PP_RELEASE, "release kept separate from stop");
  };
  for (uint32_t slot = 0; slot < 4; ++slot) {
    reach(int(slot) * 2 + 1); press(slot);
    reach(int(slot) * 2 + 2); press(slot);
  }
  for (int channel : binding) require(st_is_looping(pf_sampler(engine.value), channel), "four committed samples auto-play");
  process();
  for (float value : left) require(std::abs(value - .5f) < 1e-6, "actual four-sample PCM mix");
  require(pp_rotate(input, 1, sequence++, 12) == PP_MOVEMENT, "song A gets signed movement");
  require(pf_select(engine.value, binding[0]) == 0, "fixture song A rotation selects a declared target");
  std::array<double, PF_FIELDS> state{};
  pf_snapshot(engine.value, state.data());
  require(state[PF_SELECTED_CHANNEL] == binding[0], "song A resolved target observed");
  require(pp_rotate(input, 1, sequence++, 12) == PP_MOVEMENT, "same movement delivered unchanged to song B");
  require(pf_set_click(engine.value, 1) == 0, "fixture song B rotation enables declared click operation");
  pf_snapshot(engine.value, state.data());
  require(state[PF_CLICK] == 1, "song B has a different declared meaning");
  require(pf_set_click(engine.value, 0) == 0, "isolate sample stop verification");
  reach(9);
  for (uint32_t slot = 0; slot < 4; ++slot) press(slot);
  process();
  for (float value : left) require(value == 0, "explicit stops silence all samples");
  pp_destroy(input);
  std::puts("Real PF PCM verified for four explicitly bound buttons and two fixture-only rotary meanings. Current PF compatibility meter is 4/4; new 6/8 and tempo-tap integration remains with Performance Engine.");
}
