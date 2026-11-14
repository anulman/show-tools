#define main compiled_program_original_test_main
#include "../../lib/performance/tests/compiled_program_tests.cpp"
#undef main

void complete_stop_retains_without_playback() {
  auto live = patches::Rack::create(nullptr, 0), backup = patches::Rack::create(nullptr, 0);
  const auto song = table();
  auto program = compiled::Program::create(song.data(), uint32_t(song.size()), 8000, *live, 1);
  require(bool(program), "complete Stop witness prepares the real compiled program");
  program->start(1, 1, 0, 120);
  program->beat(PF_COUNT_IN, 0, 1, 1, 0, 120);
  require(program->press(0, 0, 120, true) == PF_OK, "complete Stop witness arms during the lead-in");
  program->beat(PF_PLAYING, 1, 1, 0, 4000, 120);
  std::vector<float> input(16000, .25f), output(16000);
  program->render(input.data(), output.data(), nullptr, nullptr, nullptr, 16000, 4000, 120, true, *live, *backup);
  std::array<double, PF_TAKE_FIELDS> draft{}, retained{}, repeated{};
  program->take_info(0, draft.data());
  require(draft[PF_TAKE_LENGTH] == 16000 && !draft[PF_TAKE_READY],
    "complete Stop witness reaches the last captured frame before endpoint evaluation");
  program->stop(); program->take_info(0, retained.data());
  require(retained[PF_TAKE_READY] && retained[PF_TAKE_LENGTH] == 16000
    && retained[PF_TAKE_PLAYBACK_STATE] == int(patches::PlaybackState::idle),
    "Stop retains a complete valid draft without starting playback");
  program->stop(); program->take_info(0, repeated.data());
  require(repeated == retained, "repeated Stop leaves the already published complete take unchanged");
  std::array<float, 16> silence{};
  program->render(nullptr, silence.data(), nullptr, nullptr, nullptr, 16, 20000, 120, false, *live, *backup);
  require(std::all_of(silence.begin(), silence.end(), [](float sample) { return sample == 0; }),
    "complete Stop retains silence until a later authorized playback");
}

void sliced_endpoint_reuses_protected_banks() {
  const std::vector<double> song{
    PF_COMPILED_MAGIC, PF_COMPILED_LEGACY_VERSION, 4, 4, 120, 4, 25, 25, 1, 2, 1, 0, 0, 1, 2, 3,
    0, 1, 0, 3, 0, 1, 3, 0, 0,
    0, 0, 0, -1, PF_ARM, 1, 0, 0, -1, -1, 0,
    0, 0, 2, -1, PF_COMMIT, 1, 0, -1, 0, 0, 0,
    0, 0, 1,
    PF_COMPILED_WINDOW_MAGIC, 1, 0, 4, 8, 4};
  Engine engine; prepare(engine, song);
  for (int capture = 0; capture < 3; ++capture) {
    ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0));
    ok(engine, press(engine, 0)); until(engine, 1);
    until(engine, 3);
    auto retained = take(engine, 0);
    require(retained[PF_TAKE_READY] && retained[PF_TAKE_LENGTH] == 32000
      && retained[PF_TAKE_PERIOD] == 32000 && retained[PF_TAKE_SOURCE_END] == 32000
      && retained[PF_TAKE_SELECTION] == 0
      && retained[PF_TAKE_PLAYBACK_STATE] == int(patches::PlaybackState::playing),
      "sliced automatic completion publishes the full capture and autoplays its selected final bar across bank reuse");
    auto audio = render(engine, 1);
    require(std::abs(audio.left[0] - .3125f) < 1e-6,
      "sliced automatic completion has audible processed playback");
    pf_stop(engine);
    require(take(engine, 0)[PF_TAKE_READY] && take(engine, 0)[PF_TAKE_LENGTH] == 32000,
      "Stop preserves the immutable parent of the committed slice");
  }
}

void tuner_isolation() {
  Engine engine; prepare(engine, table());
  std::array<double, PF_TUNER_FIELDS> tuning{};
  pf_tuner_info(engine, tuning.data());
  ok(engine, pf_tuner_command_apply(engine, PF_TUNER_PLAY_SCALE, uint32_t(tuning[PF_TUNER_REVISION]), 0, 0));
  pf_tuner_info(engine, tuning.data());
  ok(engine, pf_tuner_command_apply(engine, PF_TUNER_LISTEN, uint32_t(tuning[PF_TUNER_REVISION]), 1, 0));
  require(pf_audio_needed(engine), "stopped utility audio uses the existing engine");
  ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0));
  pf_tuner_info(engine, tuning.data());
  require(!tuning[PF_TUNER_LISTENING] && !tuning[PF_TUNER_PREVIEW_KIND],
    "Start clears tuning before recording");
  ok(engine, press(engine, 0)); until(engine, 1);
  const auto draft = take(engine, 0);
  require(pf_tuner_command_apply(engine, PF_TUNER_CUE, uint32_t(tuning[PF_TUNER_REVISION]), 0, 0) < 0,
    "reference playback rejects during capture");
  require(take(engine, 0) == draft, "rejected tuner operation preserves the capture draft");
  for (int command : {PF_TUNER_CLOSE, PF_TUNER_SILENCE}) {
    pf_tuner_info(engine, tuning.data());
    ok(engine, pf_tuner_command_apply(engine, command, uint32_t(tuning[PF_TUNER_REVISION]), 0, 0));
    require(take(engine, 0) == draft, "closing tuning preserves active capture");
  }
  until(engine, 2);
  const auto retained = take(engine, 0);
  require(retained[PF_TAKE_READY] && retained[PF_TAKE_LENGTH] == 16000,
    "capture still commits at its authored endpoint after tuner controls");
  const auto audio = render(engine, 1);
  require(std::abs(audio.left[0] - .3125f) < 1e-6,
    "capture playback retains microphone PCM without reference contamination");
}

void store_only_endpoint() {
  const std::vector<double> song{
    PF_COMPILED_MAGIC, PF_COMPILED_VERSION, 4, 4, 120, 4, 25, 25, 1, 4, 2, 0, 0, 1, 2, 3,
    0, 1, 0, 2, 0, 1, 2, 0, 0,
    0, 0, 0, -1, PF_ARM, 1, 0, 0, -1, -1, 0, PF_AUTOPLAY, PF_LOOP_MODE, 0, -1, 0,
    0, 0, 1, -1, PF_COMMIT, 1, 0, -1, 0, 0, 0, PF_STORE_ONLY, PF_LOOP_MODE, 0, -1, 0,
    0, 0, 3, 0, PF_PLAY, 0, 0, -1, -1, 0, 0, PF_AUTOPLAY, PF_LOOP_MODE, 0, -1, 0,
    0, 0, 4, 0, PF_PLAY, 0, 0, -1, -1, 1, 0, PF_AUTOPLAY, PF_HELD_MODE, 0, -1, 0,
    0, 0, 1, 1, 0, 1,
    PF_COMPILED_SUSTAIN_MAGIC, 1, 1};
  for (int profile : {0, 4, 5}) for (double rate : {8000., 44100., 48000.}) for (bool press_finish : {false, true}) {
    auto program = song;
    if (profile) program.insert(program.end(), {PF_COMPILED_PROFILES_MAGIC, 1, 0, double(profile)});
    Engine engine(rate); prepare(engine, program);
    ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0));
    ok(engine, press(engine, 0)); until(engine, 1);
    if (press_finish) ok(engine, press(engine, 0));
    until(engine, 2);
    const auto retained = take(engine, 0);
    require(retained[PF_TAKE_READY] && retained[PF_TAKE_LENGTH] == rate * 2
      && retained[PF_TAKE_PERIOD] == rate * 2,
      "store-only completion retains the exact source at its authored endpoint");
    require(retained[PF_TAKE_PLAYBACK_STATE] == int(patches::PlaybackState::idle),
      "store-only completion never starts playback");
    const auto silent = render(engine, 64);
    require(std::all_of(silent.left.begin(), silent.left.end(), [](float sample) { return sample == 0; }),
      "store-only completion produces no sample audio");
    until(engine, 3);
    require(take(engine, 0)[PF_TAKE_PLAYBACK_STATE] == int(patches::PlaybackState::idle),
      "missing later play remains silent after store-only completion");
    ok(engine, press(engine, 0));
    const auto playback = render(engine, 64);
    require(take(engine, 0)[PF_TAKE_PLAYBACK_STATE] == int(patches::PlaybackState::playing)
      && std::any_of(playback.left.begin(), playback.left.end(), [](float sample) { return sample != 0; }),
      "explicit play later launches the stored source");
    require(take(engine, 0)[PF_TAKE_LENGTH] == retained[PF_TAKE_LENGTH]
      && take(engine, 0)[PF_TAKE_REVISION] == retained[PF_TAKE_REVISION],
      "later playback preserves immutable stored source length and revision");
    until(engine, 4);
    require(press(engine, 0) < 0 && state(engine)[PF_ERROR] == PF_NO_SAMPLE,
      "unavailable periodic sustain rejects without admitting another playback");
    require(take(engine, 0)[PF_TAKE_READY]
      && take(engine, 0)[PF_TAKE_LENGTH] == retained[PF_TAKE_LENGTH]
      && take(engine, 0)[PF_TAKE_REVISION] == retained[PF_TAKE_REVISION]
      && take(engine, 0)[PF_TAKE_PLAYBACK_STATE] == int(patches::PlaybackState::playing),
      "rejected periodic sustain preserves the published source and existing loop");
  }
}

void store_only_preserves_other_source(bool replacement) {
  const std::vector<double> song{
    PF_COMPILED_MAGIC, PF_COMPILED_VERSION, 4, 4, 120, 4, 25, 25, 2, 3, 2, 0, 0, 1, 2, 3,
    0, 1, 0, 2, 0, 1, 2, 0, 0,
    0, 2, 0, 3, 0, 1, 3, 0, 1,
    0, 0, 0, -1, PF_ARM, 1, 0, 0, -1, -1, 0, PF_AUTOPLAY, PF_LOOP_MODE, 0, -1, 0,
    0, 0, 1, -1, PF_COMMIT_ARM, 1, 0, 1, 0, 0, 0, PF_AUTOPLAY, PF_LOOP_MODE, 0, -1, double(replacement),
    0, 0, 2, -1, PF_COMMIT, 1, 0, -1, 1, 1, 0, PF_STORE_ONLY, PF_LOOP_MODE, 0, -1, 0,
    0, 0, 1, 1, 1, 1};
  Engine engine; prepare(engine, song);
  ok(engine, pf_start(engine, 120, 1, 1, 4, 0, 0));
  ok(engine, press(engine, 0)); until(engine, 2);
  const auto original = take(engine, 0);
  require(original[PF_TAKE_PLAYBACK_STATE] == int(patches::PlaybackState::playing),
    "first source plays while another source in the same bank records");
  until(engine, 3);
  const auto continued = take(engine, 0);
  require(take(engine, 1)[PF_TAKE_READY]
    && take(engine, 1)[PF_TAKE_PLAYBACK_STATE] == int(patches::PlaybackState::idle)
    && continued[PF_TAKE_PLAYBACK_STATE] == int(patches::PlaybackState::playing)
    && continued[PF_TAKE_LENGTH] == original[PF_TAKE_LENGTH]
    && continued[PF_TAKE_REVISION] == original[PF_TAKE_REVISION],
    "store-only publication preserves the other immutable playing source");
  const auto output = render(engine, 64);
  require(std::all_of(output.left.begin(), output.left.end(), [](float sample) { return std::abs(sample - .3125f) < 1e-6; }),
    "store-only publication neither silences nor layers over another playing source");
}

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  const char* scenario = argv[1];
  if (std::strcmp(scenario, "combined-admission") == 0) crb_unavailable_start_preserves_old_capture();
  else if (std::strcmp(scenario, "independent-admission") == 0) independent_unavailable_arm_does_not_rollback_commit();
  else if (std::strcmp(scenario, "invalid-outgoing") == 0) failed_period_blocks_same_boundary_start();
  else if (std::strcmp(scenario, "retained-bank") == 0) stopped_partial_capture_preserves_latest();
  else if (std::strcmp(scenario, "autoplay") == 0) capture_layers_and_boundaries();
  else if (std::strcmp(scenario, "stop-complete") == 0) complete_stop_retains_without_playback();
  else if (std::strcmp(scenario, "automatic-endpoint") == 0) { authored_capture_end_finishes_without_finish_press(); sliced_endpoint_reuses_protected_banks(); }
  else if (std::strcmp(scenario, "selection-preflight") == 0) commit_preflights_entire_selection_before_publication();
  else if (std::strcmp(scenario, "boundary-orders") == 0) { disjoint_reservation_handoff_both_orders(); unified_button_and_light_priority(); unified_button_reports_independent_failures(); }
  else if (std::strcmp(scenario, "wrap-preserves-latest") == 0) loop_wrap_discards_unfinished_capture_and_preserves_latest();
  else if (std::strcmp(scenario, "store-only-endpoint") == 0) { store_only_endpoint(); store_only_preserves_other_source(false); store_only_preserves_other_source(true); }
  else if (std::strcmp(scenario, "tuner-isolation") == 0) tuner_isolation();
  else return 2;
  std::printf("PASS capture witness %s\n", scenario);
  return 0;
}
