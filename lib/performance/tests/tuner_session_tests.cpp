#include "performance_engine.h"
#include <array>
#include <cstdlib>
#include <cstdio>
#include <cmath>
#include <algorithm>

#define require(condition) do { \
  if (!(condition)) { std::fprintf(stderr, "Line %d: %s\n", __LINE__, #condition); std::abort(); } \
} while (false)

void manual_tuning_session() {
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

void required_tuning_cues_captures_and_waits_for_the_reversal() {
  constexpr double rate = 8000;
  auto* engine = pf_create(rate, PF_PRACTICE, 8, 2, 4);
  require(engine);
  const std::array<double, 28> program{
    PF_COMPILED_MAGIC, PF_COMPILED_VERSION, 4, 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
    PF_COMPILED_NOTES_MAGIC, 2, 0, 0, 1, 0, 25, 0, 1, 1, 1, 25,
  };
  require(pf_configure_compiled(engine, program.data(), program.size()) == 0);
  const std::array<double, 8> slots{0, 1, 2, 3, 4, 5, 6, 7};
  std::array<double, PF_TUNER_FIELDS> tuner{};
  std::array<double, 32> bank{};
  auto read = [&] {
    pf_tuner_info(engine, tuner.data());
    pf_tuning_bank_info(engine, bank.data());
  };
  auto turn = [&](double delta) { require(pf_control(engine, 5, delta, nullptr, 0) == 0); };
  std::array<float, 128> input{}, output{};
  unsigned frame = 0;
  auto sing = [&](int midi, int blocks) {
    double energy = 0;
    for (int block = 0; block < blocks; ++block) {
      for (auto& value : input) {
        value = midi < 0 ? 0 : float(.2 * std::sin(2 * std::acos(-1.) * 440 * std::pow(2., (midi - 69) / 12.) * frame / rate));
        ++frame;
      }
      output.fill(0);
      require(pf_process(engine, input.data(), output.data(), nullptr, input.size()) == 0);
      for (float value : output) energy += value * value;
    }
    return energy;
  };
  auto begin = [&] { return pf_begin_tuning_bank(engine, 0, slots.data(), slots.size(), 52, 0); };

  require(begin() < 0);
  require(pf_set_microphone(engine, 1) == 0);
  require(begin() == 0);
  const std::array<int, 8> pitches{52, 54, 56, 57, 59, 61, 63, 64};
  for (unsigned step = 0; step < pitches.size(); ++step) {
    read();
    require(tuner[PF_TUNER_LISTENING] && tuner[PF_TUNER_STEP] == step);
    require(tuner[PF_TUNER_PREVIEW_KIND] == 1 && tuner[PF_TUNER_PREVIEW_STEP] == step && bank[1] == step);
    require(pf_start(engine, 120, 0, 1, 4, 0, 0) < 0);
    require(pf_tuner_command_apply(engine, PF_TUNER_CONFIRM, uint32_t(tuner[PF_TUNER_REVISION]), 0, 0) < 0);
    require(sing(pitches[step], 2) > .001);
    turn(4); turn(-2);
    read(); require(bank[1] == step && !bank[5]);
    std::array<double, PF_EVENT_FIELDS> event{};
    while (pf_drain_events(engine, event.data(), 1)) {}
    sing(pitches[step], 185);
    read(); require(bank[5] && tuner[PF_TUNER_PITCH_STATUS] == 5);
    bool published_tuner_transition = false;
    while (pf_drain_events(engine, event.data(), 1))
      if (event[PF_EVENT_TYPE] == PF_STATE) published_tuner_transition = true;
    require(published_tuner_transition);
    turn(-4);
    turn(1); turn(1); turn(1); turn(1);
    turn(-1);
    read(); require(bank[1] == step);
    turn(-1);
    read(); require(bank[1] == step + 1 && bank[6 + step] == 2000 && bank[19 + step] == pitches[step]);
  }
  require(tuner[PF_TUNER_COMPLETE] && !pf_audio_needed(engine));
  require(pf_start(engine, 120, 0, 1, 4, 0, 0) == 0);
  std::array<double, PF_FIELDS> transport{};
  for (int block = 0; block < 100; ++block) {
    pf_snapshot(engine, transport.data());
    if (transport[PF_BAR_NUMBER] == 1 && transport[PF_BEAT_NUMBER] == 1) break;
    sing(-1, 1);
  }
  require(transport[PF_BAR_NUMBER] == 1 && transport[PF_BEAT_NUMBER] == 1);
  require(pf_control(engine, 0, 0, nullptr, 0) == 0);
  require(sing(-1, 3) > .1);
  for (int block = 0; block < 550; ++block) {
    pf_snapshot(engine, transport.data());
    if (transport[PF_PHASE] == PF_ENDED) break;
    sing(-1, 1);
  }
  require(transport[PF_PHASE] == PF_ENDED);
  read(); require(bank[1] == pitches.size() && bank[6] == 2000);

  require(begin() == 0);
  pf_snapshot(engine, transport.data());
  require(transport[PF_PHASE] == PF_IDLE);
  sing(52, 185);
  turn(4);
  turn(-2);
  read(); require(bank[1] == 1 && bank[6] == 2000);
  pf_stop(engine);
  read(); require(bank[0] == 0 && !tuner[PF_TUNER_LISTENING] && !pf_audio_needed(engine));
  require(begin() == 0);
  read();
  require(pf_tuner_command_apply(engine, PF_TUNER_CLOSE, uint32_t(tuner[PF_TUNER_REVISION]), 0, 0) == 0);
  read(); require(bank[0] == 0 && !pf_audio_needed(engine));
  pf_destroy(engine);
}

int main() {
  manual_tuning_session();
  required_tuning_cues_captures_and_waits_for_the_reversal();
}
