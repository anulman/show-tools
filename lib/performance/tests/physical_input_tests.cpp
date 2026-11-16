#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <vector>

#include "performance_engine.h"

namespace {
void require(bool valid, const char* message) {
  if (!valid) {
    std::cerr << message << '\n';
    std::abort();
  }
}
void ok(pf_engine* engine, int result) {
  if (result < 0) {
    std::cerr << pf_error(engine) << '\n';
    std::abort();
  }
}
struct Engine {
  pf_engine* value = pf_create(8000, PF_PRACTICE, 32, 30, 4);
  Engine() { require(value, "engine creation"); }
  ~Engine() { pf_destroy(value); }
  operator pf_engine*() const { return value; }
};
std::array<double, PF_INPUT_INFO_FIELDS> info(pf_engine* engine) {
  std::array<double, PF_INPUT_INFO_FIELDS> result;
  result.fill(-123);
  pf_input_info(engine, result.data());
  return result;
}
std::array<double, PF_LIGHT_FIELDS> lights(pf_engine* engine) {
  std::array<double, PF_LIGHT_FIELDS> result{};
  pf_light_output(engine, result.data());
  return result;
}
double level(pf_engine* engine, int id) {
  auto image = lights(engine);
  for (int index = 0; index < image[PF_LIGHT_COUNT]; ++index) {
    auto* row = image.data() + PF_LIGHT_SAMPLES + index * PF_LIGHT_SAMPLE_FIELDS;
    if (row[PF_LIGHT_SAMPLE_ID] == id) return row[PF_LIGHT_SAMPLE_LEVEL];
  }
  return -1;
}
std::vector<double> empty_program(std::initializer_list<double> bindings = {}) {
  std::vector<double> data{PF_COMPILED_MAGIC, PF_COMPILED_VERSION, 4, 6, 120, 6, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3};
  data.push_back(PF_INPUT_MAGIC);
  data.push_back(bindings.size() / PF_INPUT_BINDING_FIELDS);
  data.insert(data.end(), bindings);
  return data;
}
void load(pf_engine* engine, const std::vector<double>& data) {
  ok(engine, pf_configure_compiled(engine, data.data(), uint32_t(data.size())));
}
double generation(pf_engine* engine) { return info(engine)[PF_INPUT_GENERATION]; }
void attach(pf_engine* engine, int slot, int session, int kind, uint32_t released, uint32_t held = 0) {
  ok(engine, pf_input_attach(engine, slot, session, generation(engine), kind, released, held));
}
void event(pf_engine* engine, int slot, int session, int sequence, int input, double value) {
  ok(engine, pf_input_event(engine, slot, session, generation(engine), sequence, input, value));
}
void render(pf_engine* engine, uint32_t frames = 32) {
  std::array<float, 128> input{}, left{}, right{};
  input.fill(.25f);
  require(frames <= input.size(), "render bound");
  ok(engine, pf_process(engine, input.data(), left.data(), right.data(), frames));
}
void until(pf_engine* engine, int bar, int beat = 1) {
  double snapshot[PF_FIELDS];
  for (int attempt = 0; attempt < 16000; ++attempt) {
    pf_snapshot(engine, snapshot);
    if (snapshot[PF_PHASE] == PF_PLAYING && snapshot[PF_BAR_NUMBER] == bar && snapshot[PF_BEAT_NUMBER] == beat) return;
    render(engine);
  }
  require(false, "transport target reached");
}
void start(pf_engine* engine) {
  ok(engine, pf_set_microphone(engine, 1));
  ok(engine, pf_start(engine, 120, 1, 1, 6, 0, 0));
}
bool playing(pf_engine* engine, int take) {
  double data[PF_TAKE_FIELDS];
  pf_compiled_take_info(engine, take, data);
  return data[PF_TAKE_PLAYBACK_STATE] == 1;
}
std::vector<double> held_program(bool grouped_failure) {
  const int cue_count = grouped_failure ? 7 : 6;
  std::vector<double> data{
      PF_COMPILED_MAGIC, PF_COMPILED_VERSION, 4, 6, 120, 6, 25, 25, 2, double(cue_count), 2, 0, 0, 1, 2, 3};
  const double takes[]{0, 1, 0, 2, 0, 1, 2, 0, 0, 1, 2, 0, 3, 0, 1, 3, 0, 1};
  data.insert(data.end(), std::begin(takes), std::end(takes));
  auto cue = [&](int button, int voice, int bar, int kind, int timing, int take, int commit, int selection,
                 int mode = PF_LOOP_MODE, int group = -1) {
    const double row[]{double(button),
                       double(voice),
                       double(bar),
                       -1,
                       double(kind),
                       double(timing),
                       0,
                       double(take),
                       double(commit),
                       double(selection),
                       0,
                       double(kind == PF_COMMIT ? PF_STORE_ONLY : PF_AUTOPLAY),
                       double(mode),
                       0,
                       double(group),
                       0};
    data.insert(data.end(), std::begin(row), std::end(row));
  };
  cue(0, 0, 0, PF_ARM, 1, 0, -1, -1);
  cue(0, 0, 1, PF_COMMIT, 1, -1, 0, 0);
  cue(0, 0, 3, PF_PLAY, 0, -1, -1, 0, PF_HELD_MODE);
  cue(1, 1, 3, PF_PLAY, 0, -1, -1, 1, PF_GATED_MODE, grouped_failure ? 1 : -1);
  if (grouped_failure) cue(1, 1, 3, PF_STOP, 0, -1, -1, -1, PF_LOOP_MODE, 1);
  cue(1, 1, 1, PF_ARM, 1, 1, -1, -1);
  cue(1, 1, 2, PF_COMMIT, 1, -1, 1, 1);
  const double members[]{0, 0, 1, 1, 1, 1};
  data.insert(data.end(), std::begin(members), std::end(members));
  const double bindings[]{PF_INPUT_MAGIC, 2, 0, PF_INPUT_CUES, 1, 1, PF_INPUT_CUES, 2};
  data.insert(data.end(), std::begin(bindings), std::end(bindings));
  return data;
}
void prepare_first_take(pf_engine* engine) {
  start(engine);
  ok(engine, pf_control(engine, 0, 0, nullptr, 0));
  until(engine, 1);
  ok(engine, pf_control(engine, 0, 0, nullptr, 0));
  until(engine, 3);
}
void unbound_light_checks() {
  Engine engine;
  load(engine, empty_program());
  attach(engine, 0, 1, PF_INPUT_PHYSICAL, 63);
  for (int input = 0; input < 6; ++input)
    require(level(engine, PF_INPUT_LIGHT_BASE + input) == 0, "unbound controls publish an off baseline");
  for (int input = 0; input < 4; ++input) event(engine, 0, 1, input + 1, input, 1);
  for (int input = 0; input < 4; ++input)
    require(level(engine, PF_INPUT_LIGHT_BASE + input) == 1, "four unbound arcade buttons light simultaneously");
  event(engine, 0, 1, 5, 1, 0);
  require(level(engine, PF_INPUT_LIGHT_BASE + 1) == 0, "released unbound button restores its off baseline");
  for (int input : {0, 2, 3})
    require(level(engine, PF_INPUT_LIGHT_BASE + input) == 1, "one release preserves other held lights");
  event(engine, 0, 1, 6, 4, 1);
  event(engine, 0, 1, 7, 5, 1);
  require(level(engine, PF_INPUT_LIGHT_BASE + 4) == 1 && level(engine, PF_INPUT_LIGHT_BASE + 5) == 1,
          "pedal and mushroom observations are independent of musical bindings");
  ok(engine, pf_input_revoke(engine, 0, 1));
  for (int input = 0; input < 6; ++input)
    require(level(engine, PF_INPUT_LIGHT_BASE + input) == 0, "revoke clears only physical held overrides");
}
void exhaustive_held_image_checks() {
  Engine engine;
  load(engine, empty_program());
  int session = 0;
  for (uint32_t first = 0; first < 64; ++first) for (uint32_t second = 0; second < 64; ++second) {
    const int first_session = ++session, second_session = ++session;
    attach(engine, 0, first_session, PF_INPUT_PHYSICAL, 63 ^ first, first);
    attach(engine, 1, second_session, PF_INPUT_PHYSICAL, 63 ^ second, second);
    for (int input = 0; input < 6; ++input)
      require(level(engine, PF_INPUT_LIGHT_BASE + input) == double(((first | second) >> input) & 1),
              "all 4096 two-source held combinations preserve six independent light levels");
    ok(engine, pf_input_revoke(engine, 0, first_session));
    for (int input = 0; input < 6; ++input)
      require(level(engine, PF_INPUT_LIGHT_BASE + input) == double((second >> input) & 1),
              "source revoke preserves every other source held combination");
    ok(engine, pf_input_revoke(engine, 1, second_session));
  }
}
void protocol_checks() {
  Engine engine;
  load(engine, empty_program({0, PF_INPUT_CUES, 1, 1, PF_INPUT_CUES, 2, 5, PF_INPUT_PANIC, 0}));
  const auto first = generation(engine);
  attach(engine, 0, 10, PF_INPUT_PHYSICAL, 1, 2);
  require(level(engine, 257) == 0 && level(engine, 258) == 1, "independent physical held image");
  event(engine, 0, 10, 1, 1, 0);
  require(level(engine, 258) == 0, "initial held release clears barrier without action");
  event(engine, 0, 10, 100, 1, 1);
  require(level(engine, 258) == 1, "valid sequence jumps and fresh held edge");
  require(pf_input_event(engine, 0, 10, first, 99, 1, 0) < 0, "stale event rejected");
  require(level(engine, 258) == 1, "stale release leaves held image unchanged");
  event(engine, 0, 10, 101, 1, 1);
  event(engine, 0, 10, 102, 1, 0);
  require(level(engine, 258) == 0, "repeat does not require a second release");
  require(pf_input_attach(engine, 0, 11, first, PF_INPUT_PHYSICAL, 1, 1) < 0, "contradictory masks rejected");
  require(pf_input_attach(engine, 0, 11, first, PF_INPUT_PHYSICAL, 64, 0) < 0, "axis mask rejected");
  require(info(engine)[PF_INPUT_RECORDS + PF_INPUT_SESSION] == 10, "failed attach preserves lease");
  event(engine, 0, 10, 103, 5, 1);
  require(pf_input_is_panic(engine, 0, 10, first, 104, 5, 1) == 0, "initial unknown held does not become Panic");
  event(engine, 0, 10, 104, 5, 0);
  require(pf_input_is_panic(engine, 0, 10, first, 105, 5, 1) == 1, "fresh bound Panic classified");
  require(pf_input_is_panic(engine, 0, 10, first - 1, 105, 5, 1) == 0, "stale binding cannot gain priority");
  ok(engine, pf_input_revoke(engine, 0, 10));
  auto revoked = info(engine);
  require(revoked[PF_INPUT_COUNT] == 0 && revoked[PF_INPUT_SESSION_HIGH_WATERMARK] == 10 &&
              revoked[PF_INPUT_PANIC_MASK] == 32,
          "revocation retains allocator state and bindings");
  require(std::all_of(revoked.begin() + PF_INPUT_RECORDS, revoked.end(), [](double value) { return value == 0; }),
          "unused readback zero");
  for (int slot = 0; slot < PF_INPUT_PRODUCERS; ++slot) attach(engine, slot, 100 + slot, PF_INPUT_KEYBOARD, 223);
  require(info(engine)[PF_INPUT_COUNT] == PF_INPUT_PRODUCERS, "bounded producer table full");
  require(pf_input_attach(engine, PF_INPUT_PRODUCERS, 999, first, PF_INPUT_POINTER, 223, 0) < 0,
          "out of bounds producer rejected");
  start(engine);
  pf_stop(engine);
  require(generation(engine) == first && info(engine)[PF_INPUT_COUNT] == PF_INPUT_PRODUCERS,
          "Stop and Start retain bindings and producer leases");
  auto malformed = empty_program({0, PF_INPUT_CUES, 1, 1, PF_INPUT_CUES, 1});
  require(pf_configure_compiled(engine, malformed.data(), uint32_t(malformed.size())) < 0,
          "overlapping bindings rejected");
  for (auto invalid : {empty_program({0, PF_INPUT_CUES, 0}), empty_program({0, PF_INPUT_PANIC, 1}),
                       empty_program({0, PF_INPUT_CUES, 1, 0, PF_INPUT_TEMPO, 0})})
    require(pf_configure_compiled(engine, invalid.data(), uint32_t(invalid.size())) < 0,
            "invalid physical binding table rejected");
  auto old_packet = empty_program();
  old_packet[1] = PF_COMPILED_LEGACY_VERSION;
  require(pf_configure_compiled(engine, old_packet.data(), uint32_t(old_packet.size())) < 0,
          "packet six cannot acquire new binding semantics");
  require(generation(engine) == first && info(engine)[PF_INPUT_COUNT] == PF_INPUT_PRODUCERS,
          "failed load preserves producer table");
  load(engine, empty_program());
  require(generation(engine) == first + 1 && info(engine)[PF_INPUT_COUNT] == 0,
          "successful song replacement invalidates leases");
  require(pf_input_event(engine, 0, 100, first, 200, 0, 1) < 0, "old generation cannot cross song replacement");
  Engine replacement;
  load(replacement, empty_program());
  ok(replacement, pf_input_inherit(replacement, engine));
  require(
      generation(replacement) == generation(engine) + 1 && info(replacement)[PF_INPUT_SESSION_HIGH_WATERMARK] == 131,
      "candidate swap inherits epoch and watermark");
  require(pf_input_attach(replacement, 0, 131, generation(replacement), PF_INPUT_POINTER, 223, 0) < 0,
          "inherited session cannot be reused");
  attach(replacement, 0, 132, PF_INPUT_POINTER, 223);
  require(pf_input_inherit(replacement, engine) < 0, "active candidate cannot overwrite leases");
  Engine exhausted, candidate;
  ok(exhausted, pf_input_attach(exhausted, 0, 9007199254740991., generation(exhausted), PF_INPUT_POINTER, 223, 0));
  const auto before = info(candidate);
  require(pf_input_inherit(candidate, exhausted) < 0 && info(candidate) == before,
          "exhausted watermark fails before candidate mutation");
}
void ownership_checks(bool grouped_failure) {
  Engine engine;
  load(engine, held_program(grouped_failure));
  prepare_first_take(engine);
  attach(engine, 0, 1, PF_INPUT_PHYSICAL, 3);
  attach(engine, 1, 2, PF_INPUT_POINTER, 223);
  event(engine, 0, 1, 1, 0, 1);
  require(playing(engine, 0), "physical held selection admitted");
  require(pf_input_event(engine, 1, 2, generation(engine), 1, 1, 1) < 0, "unready other-row selection rejected");
  require(playing(engine, 0), "rejected admission preserves another producer's held sample");
  event(engine, 1, 2, 2, 1, 0);
  ok(engine, pf_input_revoke(engine, 1, 2));
  require(playing(engine, 0), "failed producer release and revoke cannot steal held ownership");
  ok(engine, pf_control(engine, 7, 0, nullptr, 0));
  ok(engine, pf_control(engine, 8, 0, nullptr, 0));
  require(playing(engine, 0), "legacy releases cannot release physical owner");
  event(engine, 0, 1, 2, 0, 0);
  require(!playing(engine, 0), "matching physical release stops its held sample");
}
void all_row_binding(std::vector<double>& data) {
  data.resize(data.size() - 8);
  const double binding[]{PF_INPUT_MAGIC, 1, 0, PF_INPUT_CUES, 3};
  data.insert(data.end(), std::begin(binding), std::end(binding));
}
void partial_batch_checks() {
  Engine engine;
  auto data = held_program(true);
  all_row_binding(data);
  load(engine, data);
  prepare_first_take(engine);
  attach(engine, 0, 1, PF_INPUT_PHYSICAL, 1);
  attach(engine, 1, 2, PF_INPUT_POINTER, 223);
  require(pf_input_event(engine, 0, 1, generation(engine), 1, 0, 1) < 0, "partial batch reports failed row");
  require(playing(engine, 0), "partial batch still admits successful held row");
  event(engine, 1, 2, 1, 0, 1);
  event(engine, 1, 2, 2, 0, 0);
  require(playing(engine, 0), "already-used cue cannot acquire another producer's ownership");
  event(engine, 0, 1, 2, 0, 0);
  require(!playing(engine, 0), "partial batch's successful held owner can release");
}
void superseded_owner_checks() {
  Engine engine;
  auto data = held_program(false);
  data[PF_COMPILED_HEADER_FIELDS + 2 * PF_COMPILED_TAKE_FIELDS + 2 * PF_COMPILED_CUE_FIELDS + 12] = PF_GATED_MODE;
  load(engine, data);
  prepare_first_take(engine);
  attach(engine, 0, 1, PF_INPUT_PHYSICAL, 1);
  attach(engine, 1, 2, PF_INPUT_POINTER, 223);
  event(engine, 0, 1, 1, 0, 1);
  until(engine, 4);
  event(engine, 1, 2, 1, 0, 1);
  require(playing(engine, 0), "later gated press admits a fresh owner");
  ok(engine, pf_input_revoke(engine, 0, 1));
  require(playing(engine, 0), "old owner revocation cannot stop superseding owner");
  attach(engine, 0, 3, PF_INPUT_PHYSICAL, 1);
  require(pf_input_event(engine, 0, 1, generation(engine), 200, 0, 0) < 0,
          "old session release rejected after replacement");
  require(playing(engine, 0), "old session release leaves current held sample");
  event(engine, 1, 2, 2, 0, 0);
  require(!playing(engine, 0), "superseding owner can release its sample");
}
void superseded_pending_checks(bool revoke_before_boundary) {
  Engine engine;
  auto data = held_program(false);
  data[PF_COMPILED_HEADER_FIELDS + 2 * PF_COMPILED_TAKE_FIELDS + 2 * PF_COMPILED_CUE_FIELDS + 12] = PF_GATED_MODE;
  const double pending[]{0, 0, 4, 0, PF_PLAY, 1, 0, -1, -1, 0, 0, PF_AUTOPLAY, PF_HELD_MODE, 0, -1, 0};
  data.insert(data.begin() + PF_COMPILED_HEADER_FIELDS + 2 * PF_COMPILED_TAKE_FIELDS + 6 * PF_COMPILED_CUE_FIELDS,
              std::begin(pending), std::end(pending));
  data[9] = 7;
  load(engine, data);
  prepare_first_take(engine);
  attach(engine, 0, 1, PF_INPUT_PHYSICAL, 1);
  attach(engine, 1, 2, PF_INPUT_POINTER, 223);
  event(engine, 0, 1, 1, 0, 1);
  event(engine, 0, 1, 2, 0, 0);
  until(engine, 4);
  event(engine, 0, 1, 3, 0, 1);
  until(engine, 4, 2);
  event(engine, 1, 2, 1, 0, 1);
  require(playing(engine, 0), "current gated owner admitted over another source's pending held launch");
  if (revoke_before_boundary) {
    ok(engine, pf_input_revoke(engine, 0, 1));
    require(playing(engine, 0), "revoking superseded pending owner preserves current gated playback");
  }
  until(engine, 5);
  event(engine, 1, 2, 2, 0, 0);
  event(engine, 1, 2, 3, 0, 1);
  require(playing(engine, 0), "superseded pending launch cannot replace the current gated instrument");
}
void staged_owner_invalidation_checks(int mode, bool revoke) {
  Engine engine;
  auto data = held_program(false);
  const double added[]{
    0, 0, 4, -1, PF_PLAY, 1, 0, -1, -1, 0, 0, PF_AUTOPLAY, PF_HELD_MODE, 0, -1, 0,
    1, 1, 4, -1, PF_PLAY, 1, 0, -1, -1, 1, 0, PF_AUTOPLAY, double(mode), 0, -1, 0
  };
  data.insert(data.begin() + PF_COMPILED_HEADER_FIELDS + 2 * PF_COMPILED_TAKE_FIELDS + 6 * PF_COMPILED_CUE_FIELDS,
              std::begin(added), std::end(added));
  data[9] = 8;
  load(engine, data);
  start(engine);
  ok(engine, pf_control(engine, 0, 0, nullptr, 0));
  until(engine, 1);
  ok(engine, pf_control(engine, 0, 0, nullptr, 0));
  ok(engine, pf_control(engine, 1, 0, nullptr, 0));
  until(engine, 2);
  ok(engine, pf_control(engine, 1, 0, nullptr, 0));
  until(engine, 3);
  attach(engine, 0, 1, PF_INPUT_PHYSICAL, 3);
  attach(engine, 1, 2, PF_INPUT_POINTER, 223);
  event(engine, 0, 1, 1, 1, 1);
  require(playing(engine, 1), "earlier Yellow held playback admitted");
  until(engine, 4);
  event(engine, 0, 1, 2, 0, 1);
  event(engine, 1, 2, 1, 1, 1);
  until(engine, 5);
  if (revoke) {
    ok(engine, pf_input_revoke(engine, 1, 2));
    ok(engine, pf_input_revoke(engine, 0, 1));
  } else {
    event(engine, 1, 2, 2, 1, 0);
    event(engine, 0, 1, 3, 1, 0);
    event(engine, 0, 1, 4, 0, 0);
  }
  require(!playing(engine, 0) && !playing(engine, 1), "staged launches cannot survive every admitted owner's release");
}
void ordered_batch_checks() {
  Engine engine;
  auto data = held_program(false);
  all_row_binding(data);
  data[12] = 1;
  data[13] = 0;
  for (int cue = 0; cue < data[9]; ++cue) {
    const auto offset = PF_COMPILED_HEADER_FIELDS + 2 * PF_COMPILED_TAKE_FIELDS + cue * PF_COMPILED_CUE_FIELDS;
    data[offset] = 1 - data[offset];
  }
  load(engine, data);
  start(engine);
  attach(engine, 0, 1, PF_INPUT_PHYSICAL, 1);
  event(engine, 0, 1, 1, 0, 1);
  event(engine, 0, 1, 2, 0, 0);
  until(engine, 1);
  std::array<double, PF_EVENT_FIELDS * PF_EVENT_CAPACITY> events{};
  pf_drain_events(engine, events.data(), PF_EVENT_CAPACITY);
  event(engine, 0, 1, 3, 0, 1);
  const auto count = pf_drain_events(engine, events.data(), PF_EVENT_CAPACITY);
  std::vector<int> cues;
  for (uint32_t index = 0; index < count; ++index) {
    const auto* row = events.data() + index * PF_EVENT_FIELDS;
    if (row[PF_EVENT_TYPE] == PF_CONTROL && row[PF_EVENT_CUE] >= 0) cues.push_back(int(row[PF_EVENT_CUE]));
  }
  require(cues == std::vector<int>({1, 4}), "one selected-row batch commits before incoming lower row arm");
  event(engine, 0, 1, 4, 0, 0);
  until(engine, 2);
  double first[PF_TAKE_FIELDS], second[PF_TAKE_FIELDS];
  pf_compiled_take_info(engine, 0, first);
  pf_compiled_take_info(engine, 1, second);
  require(first[PF_TAKE_READY] == 1 && second[PF_TAKE_READY] == 0, "commit and incoming capture share boundary");
  until(engine, 3);
  pf_compiled_take_info(engine, 1, second);
  require(second[PF_TAKE_READY] == 1, "missed commit still completes incoming capture");
  require(!playing(engine, 0) && !playing(engine, 1), "missed play remains manual");
}
}  // namespace
int main() {
  unbound_light_checks();
  exhaustive_held_image_checks();
  protocol_checks();
  ownership_checks(false);
  ownership_checks(true);
  partial_batch_checks();
  superseded_owner_checks();
  superseded_pending_checks(false);
  superseded_pending_checks(true);
  staged_owner_invalidation_checks(PF_HELD_MODE, false);
  staged_owner_invalidation_checks(PF_HELD_MODE, true);
  staged_owner_invalidation_checks(PF_GATED_MODE, false);
  staged_owner_invalidation_checks(PF_GATED_MODE, true);
  ordered_batch_checks();
  std::cout << "Physical input checks passed.\n";
}
