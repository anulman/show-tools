#include "performance_engine.h"
#include "peripheral_light_delivery.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

namespace {
unsigned held_pairs = 0, delivery_cases = 0;
void require(bool condition, const char* property) {
  if (!condition) { std::fprintf(stderr, "%s\n", property); std::exit(1); }
}
void ok(int value) { require(value >= 0, "NATIVE_COMMAND_APPLIED"); }
struct Engine {
  pf_engine* value = pf_create(8000, PF_PRACTICE, 32, 30, 4);
  Engine() { require(value, "ENGINE_CREATED"); }
  ~Engine() { pf_destroy(value); }
  operator pf_engine*() const { return value; }
};
std::array<double, PF_LIGHT_FIELDS> image(pf_engine* engine) {
  std::array<double, PF_LIGHT_FIELDS> result{};
  pf_light_output(engine, result.data());
  return result;
}
double level(const std::array<double, PF_LIGHT_FIELDS>& data, unsigned input) {
  for (unsigned row = 0; row < unsigned(data[PF_LIGHT_COUNT]); ++row) {
    const auto offset = PF_LIGHT_SAMPLES + row * PF_LIGHT_SAMPLE_FIELDS;
    if (data[offset + PF_LIGHT_SAMPLE_ID] == PF_INPUT_LIGHT_BASE + input)
      return data[offset + PF_LIGHT_SAMPLE_LEVEL];
  }
  return -1;
}
double generation(pf_engine* engine) {
  std::array<double, PF_INPUT_INFO_FIELDS> data{};
  pf_input_info(engine, data.data());
  return data[PF_INPUT_GENERATION];
}
std::vector<double> empty_program() {
  return {PF_COMPILED_MAGIC, PF_COMPILED_VERSION, 4, 5, 120, 5, 25, 25,
    0, 0, 0, 0, 0, 1, 2, 3, PF_INPUT_MAGIC, 0};
}
void load(pf_engine* engine, const std::vector<double>& packet) {
  ok(pf_configure_compiled(engine, packet.data(), uint32_t(packet.size())));
}
void attach(pf_engine* engine, unsigned slot, double session, unsigned held) {
  ok(pf_input_attach(engine, slot, session, generation(engine), PF_INPUT_PHYSICAL, 63 ^ held, held));
}
void held_domain() {
  Engine engine;
  load(engine, empty_program());
  unsigned session = 0;
  for (unsigned first = 0; first < 64; ++first) for (unsigned second = 0; second < 64; ++second) {
    ++held_pairs;
    const unsigned first_session = ++session, second_session = ++session;
    attach(engine, 0, first_session, first);
    attach(engine, 1, second_session, second);
    const auto together = image(engine);
    require(together[PF_LIGHT_COUNT] == 7, "HELD_IMAGE_COMPLETE");
    for (unsigned input = 0; input < 6; ++input)
      require(level(together, input) == double(((first | second) >> input) & 1), "HELD_IMAGE_OR");
    ok(pf_input_revoke(engine, 0, first_session));
    const auto remaining = image(engine);
    for (unsigned input = 0; input < 6; ++input)
      require(level(remaining, input) == double((second >> input) & 1), "HELD_REVOKE_ISOLATION");
    ok(pf_input_revoke(engine, 1, second_session));
    const auto cleared = image(engine);
    for (unsigned input = 0; input < 6; ++input)
      require(level(cleared, input) == 0, "HELD_ALL_REVOKED_OFF");
  }
}
void render(pf_engine* engine, unsigned frames = 1) {
  std::array<float, 128> input{}, left{}, right{};
  input.fill(.25f);
  while (frames) {
    const unsigned count = std::min(frames, unsigned(input.size()));
    ok(pf_process(engine, input.data(), left.data(), right.data(), count));
    frames -= count;
  }
}
void until(pf_engine* engine, int bar, int beat = 1) {
  std::array<double, PF_FIELDS> state{};
  for (unsigned attempt = 0; attempt < 200000; ++attempt) {
    pf_snapshot(engine, state.data());
    if (state[PF_PHASE] == PF_PLAYING && state[PF_BAR_NUMBER] == bar && state[PF_BEAT_NUMBER] == beat) return;
    render(engine);
  }
  require(false, "BASELINE_REACH_POSITION");
}
std::vector<double> capture_program() {
  std::vector<double> data{PF_COMPILED_MAGIC, PF_COMPILED_VERSION, 4, 5, 120, 5, 25, 25,
    1, 3, 1, 0, 0, 1, 2, 3, 0, 2, 0, 3, 0, 1, 3, 0, 0};
  auto cue = [&](int bar, int kind, int take, int commit, int selection) {
    const double row[]{0, 0, double(bar), -1, double(kind), 1, 0, double(take),
      double(commit), double(selection), 0, PF_AUTOPLAY, PF_LOOP_MODE, 0, -1, 0};
    data.insert(data.end(), std::begin(row), std::end(row));
  };
  cue(1, PF_ARM, 0, -1, -1);
  cue(2, PF_COMMIT, -1, 0, 0);
  cue(5, PF_STOP, -1, -1, -1);
  const double tail[]{0, 0, 1, PF_INPUT_MAGIC, 1, 0, PF_INPUT_CUES, 1};
  data.insert(data.end(), std::begin(tail), std::end(tail));
  return data;
}
void baseline_witness() {
  Engine engine;
  load(engine, capture_program());
  attach(engine, 0, 1, 0);
  unsigned sequence = 0;
  auto edge = [&](unsigned input, int value) {
    ok(pf_input_event(engine, 0, 1, generation(engine), ++sequence, input, value));
  };
  ok(pf_set_microphone(engine, 1));
  ok(pf_start(engine, 120, 1, 1, 5, 0, 0));
  until(engine, 1);
  edge(0, 1); edge(0, 0);
  until(engine, 2);
  render(engine, 1000);
  const double pulse = level(image(engine), 0);
  require(pulse > .3 && pulse < .4, "BASELINE_RECORDING_PULSE");
  edge(0, 1);
  require(level(image(engine), 0) == 1, "BASELINE_HELD_FULL");
  edge(0, 0);
  require(level(image(engine), 0) == pulse, "BASELINE_RELEASE_PULSE");
  until(engine, 3);
  require(level(image(engine), 0) == .7, "BASELINE_PLAYING_LEVEL");
  for (unsigned input = 0; input < 4; ++input) edge(input, 1);
  for (unsigned input = 0; input < 4; ++input)
    require(level(image(engine), input) == 1, "BASELINE_FOUR_HELD_FULL");
  edge(0, 0);
  require(level(image(engine), 0) == .7, "BASELINE_RELEASE_PLAYING");
  for (unsigned input = 1; input < 4; ++input)
    require(level(image(engine), input) == 1, "BASELINE_OTHER_HELD_UNCHANGED");
  ok(pf_input_revoke(engine, 0, 1));
  require(level(image(engine), 0) == .7, "BASELINE_REVOKE_PRESERVES_PLAYING");
}
std::array<double, PF_LIGHT_FIELDS> publication(unsigned revision, const std::array<double, 4>& levels) {
  std::array<double, PF_LIGHT_FIELDS> data{};
  data[PF_LIGHT_FORMAT] = PF_LIGHT_VERSION;
  data[PF_LIGHT_GENERATION] = data[PF_LIGHT_EPOCH] = 1;
  data[PF_LIGHT_SEQUENCE] = revision;
  data[PF_LIGHT_RATE] = 8000;
  data[PF_LIGHT_COUNT] = 4;
  for (unsigned input = 0; input < 4; ++input) {
    const auto offset = PF_LIGHT_SAMPLES + input * PF_LIGHT_SAMPLE_FIELDS;
    data[offset + PF_LIGHT_SAMPLE_ID] = PF_INPUT_LIGHT_BASE + input;
    data[offset + PF_LIGHT_SAMPLE_LEVEL] = levels[input];
  }
  return data;
}
void report_bytes(const pp_light_delivery_frame& frame, const std::array<pp_light_binding, 4>& bindings,
    const std::array<double, 4>& levels) {
  require(frame.count == 4, "FOUR_LED_REPORT_COUNT");
  for (unsigned row = 0; row < 4; ++row) {
    const auto& report = frame.reports[row];
    const unsigned logical = bindings[row].led_id - PF_INPUT_LIGHT_BASE;
    require(report[0] == 3 && report[1] == bindings[row].sdk_channel &&
      report[2] == unsigned(std::lround(levels[logical] * 255)) && report[3] == 0 && report[4] == 0,
      "FOUR_LED_REPORT_BYTES");
  }
  for (unsigned row = 4; row < PP_LIGHT_OUTPUT_CAPACITY; ++row)
    for (auto byte : frame.reports[row]) require(byte == 0, "FOUR_LED_UNUSED_ZERO");
}
void delivery_domain() {
  constexpr std::array<double, 4> alphabet{0, .25, .7, 1};
  unsigned revision = 0, fence = 0;
  for (unsigned final_channel : {3u, 48u}) {
    std::array<unsigned, 4> order{0, 1, 2, 3};
    do {
      pp_light_delivery* delivery = pp_light_delivery_create();
      require(delivery, "DELIVERY_CREATED");
      const pp_light_connection connection{1, 1, 1, double(++fence)};
      std::array<pp_light_binding, 4> bindings{};
      for (unsigned row = 0; row < 4; ++row) {
        const unsigned control = order[row];
        bindings[row] = {PF_INPUT_LIGHT_BASE + control, control == 3 ? final_channel : control};
      }
      ok(pp_light_delivery_bind(delivery, &connection, bindings.data(), bindings.size()));
      for (unsigned code = 0; code < 256; ++code) {
        ++delivery_cases;
        unsigned digits = code;
        std::array<double, 4> levels{};
        for (auto& value : levels) { value = alphabet[digits % 4]; digits /= 4; }
        const auto data = publication(++revision, levels);
        pp_light_delivery_frame frame{};
        require(pp_light_delivery_prepare(delivery, &connection, data.data(), data.size(), &frame) == 1, "DELIVERY_PREPARED");
        report_bytes(frame, bindings, levels);
        pp_light_delivery_frame retry{};
        require(pp_light_delivery_prepare(delivery, &connection, data.data(), data.size(), &retry) == 1, "DELIVERY_UNCOMMITTED_RETRY");
        auto partial = frame; --partial.count;
        require(pp_light_delivery_commit(delivery, &partial) == PP_INVALID, "DELIVERY_COMPLETE_COMMIT");
        auto modified = frame; modified.reports[0][2] ^= 1;
        require(pp_light_delivery_commit(delivery, &modified) == PP_INVALID, "DELIVERY_IMMUTABLE_COMMIT");
        require(pp_light_delivery_commit(delivery, &frame) == 1, "DELIVERY_FULL_COMMIT");
        require(pp_light_delivery_commit(delivery, &frame) == PP_STALE, "DELIVERY_DUPLICATE_COMMIT");
        require(pp_light_delivery_prepare(delivery, &connection, data.data(), data.size(), &retry) == PP_STALE,
          "DELIVERY_COMMITTED_REPLAY");
      }
      pp_light_delivery_destroy(delivery);
    } while (std::next_permutation(order.begin(), order.end()));
  }
}
}
int main() {
  held_domain();
  baseline_witness();
  delivery_domain();
  require(held_pairs == 4096 && delivery_cases == 12288, "FINITE_DOMAIN_CARDINALITY");
  std::puts("{\"status\":\"PASS\",\"heldPairs\":4096,\"physicalControls\":6,\"outputLayouts\":2,\"mappingOrders\":24,\"levelAssignments\":256,\"deliveryCases\":12288,\"baselineWitnesses\":1}");
}
