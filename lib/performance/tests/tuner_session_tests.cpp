#include "performance_engine.h"
#include <array>
#include <cstdlib>
#include <cmath>
#include <algorithm>

namespace {
void require(bool condition) { if (!condition) std::abort(); }
}

int main() {
  constexpr double rate = 48000;
  auto* engine = pf_create(rate, PF_PRACTICE, 8, 2, 4);
  require(engine);
  require(pf_configure(engine, 120, 4, 1, 1, 4, nullptr, 0, nullptr, 0, nullptr, 0) == 0);
  std::array<double, PF_TUNER_FIELDS> tuner{};
  auto read = [&] { pf_tuner_info(engine, tuner.data()); return uint32_t(tuner[PF_TUNER_REVISION]); };
  auto command = [&](int op, int value = 0, int scale = 0) { return pf_tuner_command_apply(engine, op, read(), value, scale); };
  require(tuner.size() == 72);
  require(command(PF_TUNER_CONFIGURE, 48) == 0);
  read(); require(tuner[PF_TUNER_COUNT] == 8 && tuner[PF_TUNER_ROOT] == 48);
  require(!pf_audio_needed(engine));
  require(command(PF_TUNER_CUE) == 0 && pf_audio_needed(engine));
  const auto cue_revision = read();
  std::array<float, 128> input{}, left{}, right{}, live_left{}, live_right{};
  double energy = 0;
  for (int block = 0; block < 800; ++block) {
    for (unsigned i = 0; i < input.size(); ++i) input[i] = float(.2 * std::sin(2 * std::acos(-1.) * 130.81278265 * (block * input.size() + i) / rate));
    left.fill(0); right.fill(0); live_left.fill(0); live_right.fill(0);
    require(pf_process_stems(engine, input.data(), left.data(), right.data(), live_left.data(), live_right.data(), input.size()) == 0);
    for (auto value : left) energy += value * value;
    require(std::all_of(live_left.begin(), live_left.end(), [](float value) { return value == 0; }));
  }
  require(energy > 1 && !pf_audio_needed(engine));
  require(read() == cue_revision && !tuner[PF_TUNER_PREVIEW_KIND]);
  require(command(PF_TUNER_LISTEN, 1) < 0);
  require(pf_set_microphone(engine, 1) == 0);
  require(command(PF_TUNER_LISTEN, 1) == 0);
  const auto listening_revision = read();
  for (int block = 0; block < 200; ++block) {
    for (unsigned i = 0; i < input.size(); ++i) input[i] = float(.2 * std::sin(2 * std::acos(-1.) * 130.81278265 * (block * input.size() + i) / rate));
    require(pf_process_stems(engine, input.data(), nullptr, nullptr, nullptr, nullptr, input.size()) == 0);
  }
  require(read() == listening_revision && tuner[PF_TUNER_PITCH_STATUS] == 5);
  require(std::abs(tuner[PF_TUNER_FREQUENCY] - 130.81278265) < .5);
  require(command(PF_TUNER_CONFIRM) == 0);
  require(pf_tuner_command_apply(engine, PF_TUNER_CONFIRM, listening_revision, 0, 0) < 0);
  read(); require(tuner[PF_TUNER_STEP] == 1);
  const auto before_stop = read();
  pf_stop(engine);
  require(!pf_audio_needed(engine));
  require(pf_tuner_command_apply(engine, PF_TUNER_CUE, before_stop, 0, 0) < 0);
  require(command(PF_TUNER_CUE) == 0);
  require(pf_start(engine, 120, 0, 1, 1, 0, 0) == 0);
  read(); require(!tuner[PF_TUNER_PREVIEW_KIND] && !tuner[PF_TUNER_LISTENING]);
  require(command(PF_TUNER_CUE) < 0);
  pf_stop(engine);
  require(command(PF_TUNER_CUE) == 0);
  const auto before_panic = read();
  require(pf_control(engine, 4, 0, nullptr, 0) == 0 && !pf_audio_needed(engine));
  require(pf_tuner_command_apply(engine, PF_TUNER_CUE, before_panic, 0, 0) < 0);
  require(command(PF_TUNER_LISTEN, 1) == 0);
  require(pf_set_microphone(engine, 0) == 0 && !pf_audio_needed(engine));
  pf_destroy(engine);
}
