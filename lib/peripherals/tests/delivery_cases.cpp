#include "peripheral_light_delivery.h"
#include "performance_light_output.h"
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>

namespace {
void require(bool value, const char* reason) {
  if (!value) { std::fprintf(stderr, "%s\n", reason); std::abort(); }
}
bool same_frame(const pp_light_delivery_frame& a, const pp_light_delivery_frame& b) {
  if (a.connection.engine_incarnation != b.connection.engine_incarnation || a.connection.device_session != b.connection.device_session ||
      a.connection.binding_revision != b.connection.binding_revision || a.connection.request_fence != b.connection.request_fence ||
      a.publication != b.publication || a.count != b.count) return false;
  for (unsigned row = 0; row < PP_LIGHT_OUTPUT_CAPACITY; ++row)
    for (unsigned byte = 0; byte < PP_LED_REPORT_BYTES; ++byte)
      if (a.reports[row][byte] != b.reports[row][byte]) return false;
  return true;
}
std::array<double, PF_LIGHT_FIELDS> image(double sequence) {
  std::array<double, PF_LIGHT_FIELDS> data{};
  data[PF_LIGHT_FORMAT] = PF_LIGHT_VERSION;
  data[PF_LIGHT_GENERATION] = 1;
  data[PF_LIGHT_EPOCH] = 1;
  data[PF_LIGHT_SEQUENCE] = sequence;
  data[PF_LIGHT_RATE] = 48000;
  data[PF_LIGHT_COUNT_BEAT] = -.5;
  return data;
}
void row(std::array<double, PF_LIGHT_FIELDS>& data, uint32_t index, double id, double level) {
  const auto offset = PF_LIGHT_SAMPLES + index * PF_LIGHT_SAMPLE_FIELDS;
  data[offset + PF_LIGHT_SAMPLE_ID] = id;
  data[offset + PF_LIGHT_SAMPLE_LEVEL] = level;
  data[PF_LIGHT_COUNT] = index + 1;
}
}

void pp_run_delivery_cases(void (*observe)(double)) {
  auto* gate = pp_light_delivery_create();
  require(gate, "delivery gate allocates outside audio processing");
  auto result = [&](int actual, int expected) { require(actual == expected, "delivery result matches contract"); observe(actual); };
  pp_light_connection connection{1, 1, 1, 1};
  const std::array<pp_light_binding, 3> bindings{{{17, 0}, {UINT32_MAX, 95}, {44, 8}}};
  auto data = image(1);
  row(data, 0, 17, .5); row(data, 1, UINT32_MAX, 1); row(data, 2, 999, .75);
  pp_light_delivery_frame frame{};
  frame.publication = 777;
  const auto untouched = frame;
  result(pp_light_delivery_prepare(gate, &connection, data.data(), data.size(), &frame), PP_STALE);
  require(same_frame(frame, untouched), "unbound gate leaves output unchanged");
  result(pp_light_delivery_bind(gate, &connection, bindings.data(), bindings.size()), 0);
  result(pp_light_delivery_prepare(gate, &connection, data.data(), data.size(), &frame), 1);
  require(frame.count == 3 && frame.publication == 1, "complete frame uses explicit owned mappings");
  require(frame.reports[0][0] == 3 && frame.reports[0][1] == 0 && frame.reports[0][2] == 128, "midpoint brightness quantizes at hardware boundary");
  require(frame.reports[1][1] == 95 && frame.reports[1][2] == 255, "opaque ID maps to chosen final SDK channel");
  require(frame.reports[2][1] == 8 && frame.reports[2][2] == 0, "absent mapped ID turns off without touching unmapped outputs");
  for (unsigned index = 0; index < frame.count; ++index) {
    observe(frame.reports[index][1]); observe(frame.reports[index][2]);
    require(frame.reports[index][3] == 0 && frame.reports[index][4] == 0, "reports contain brightness only, no enable masks");
  }
  const auto retry = frame;
  result(pp_light_delivery_prepare(gate, &connection, data.data(), data.size(), &frame), 1);
  require(same_frame(frame, retry), "failed or omitted physical delivery can retry identical image before commit");
  auto conflicting = data; conflicting[PF_LIGHT_SAMPLES + PF_LIGHT_SAMPLE_LEVEL] = .25;
  result(pp_light_delivery_prepare(gate, &connection, conflicting.data(), conflicting.size(), &frame), PP_INVALID);
  require(same_frame(frame, retry), "conflicting equal-sequence image leaves pending frame intact");
  auto modified = frame; modified.reports[0][2] = 9;
  result(pp_light_delivery_commit(gate, &modified), PP_INVALID);
  result(pp_light_delivery_commit(gate, &frame), 1);
  result(pp_light_delivery_commit(gate, &frame), PP_STALE);
  result(pp_light_delivery_prepare(gate, &connection, data.data(), data.size(), &frame), PP_STALE);

  data = image(2);
  result(pp_light_delivery_prepare(gate, &connection, data.data(), data.size(), &frame), 1);
  const auto superseded = frame;
  data = image(3); row(data, 0, 44, .25);
  result(pp_light_delivery_prepare(gate, &connection, data.data(), data.size(), &frame), 1);
  result(pp_light_delivery_commit(gate, &superseded), PP_STALE);
  result(pp_light_delivery_commit(gate, &frame), 1);
  auto older = image(2);
  result(pp_light_delivery_prepare(gate, &connection, older.data(), older.size(), &frame), PP_STALE);

  const auto old_connection = connection;
  connection.device_session = 2; connection.request_fence = 2;
  result(pp_light_delivery_bind(gate, &connection, bindings.data(), bindings.size()), 0);
  result(pp_light_delivery_prepare(gate, &old_connection, data.data(), data.size(), &frame), PP_STALE);
  result(pp_light_delivery_prepare(gate, &connection, data.data(), data.size(), &frame), 1);
  result(pp_light_delivery_commit(gate, &frame), 1);
  require(frame.publication == 3, "fresh getter response on explicit new connection may reseed unchanged current publication");
  const auto second_connection = connection;
  connection.engine_incarnation = 2; connection.device_session = 3; connection.binding_revision = 2; connection.request_fence = 3;
  result(pp_light_delivery_bind(gate, &connection, bindings.data(), bindings.size()), 0);
  data = image(1);
  result(pp_light_delivery_prepare(gate, &second_connection, data.data(), data.size(), &frame), PP_STALE);
  result(pp_light_delivery_prepare(gate, &connection, data.data(), data.size(), &frame), 1);
  result(pp_light_delivery_commit(gate, &frame), 1);

  auto next_connection = connection; next_connection.request_fence = 4;
  const std::array<pp_light_binding, 2> duplicate_id{{{17, 0}, {17, 1}}}, duplicate_channel{{{17, 0}, {18, 0}}};
  const pp_light_binding invalid_channel{17, 96};
  result(pp_light_delivery_bind(gate, &next_connection, duplicate_id.data(), 2), PP_INVALID);
  result(pp_light_delivery_bind(gate, &next_connection, duplicate_channel.data(), 2), PP_INVALID);
  result(pp_light_delivery_bind(gate, &next_connection, &invalid_channel, 1), PP_INVALID);
  result(pp_light_delivery_bind(gate, &next_connection, nullptr, 1), PP_INVALID);
  result(pp_light_delivery_bind(gate, &next_connection, bindings.data(), 97), PP_INVALID);
  result(pp_light_delivery_bind(gate, &connection, bindings.data(), bindings.size()), PP_INVALID);
  for (unsigned field = 0; field < 4; ++field) {
    auto bad = next_connection;
    if (field == 0) bad.engine_incarnation = 0;
    if (field == 1) bad.device_session = std::numeric_limits<double>::quiet_NaN();
    if (field == 2) bad.binding_revision = .5;
    if (field == 3) bad.request_fence = 9007199254740992.0;
    result(pp_light_delivery_bind(gate, &bad, bindings.data(), bindings.size()), PP_INVALID);
  }
  data = image(2);
  result(pp_light_delivery_prepare(gate, &connection, data.data(), data.size(), &frame), 1);
  result(pp_light_delivery_commit(gate, &frame), 1);

  auto invalid_image = [&](const std::array<double, PF_LIGHT_FIELDS>& bad, uint32_t fields = PF_LIGHT_FIELDS) {
    const auto previous = frame;
    result(pp_light_delivery_prepare(gate, &connection, bad.data(), fields, &frame), PP_INVALID);
    require(same_frame(frame, previous), "invalid publication never partially changes output or consumes freshness");
  };
  struct BadField { uint32_t index; double value; };
  for (auto bad_field : {BadField{PF_LIGHT_FORMAT, 2}, {PF_LIGHT_GENERATION, 0}, {PF_LIGHT_RUN, -1},
      {PF_LIGHT_EPOCH, 0}, {PF_LIGHT_TIMELINE, -1}, {PF_LIGHT_SEQUENCE, 0}, {PF_LIGHT_FRAME, -.5},
      {PF_LIGHT_RATE, 7999}, {PF_LIGHT_RATE, 192001}, {PF_LIGHT_RATE, 48000.5}, {PF_LIGHT_COUNT_BEAT, std::numeric_limits<double>::infinity()},
      {PF_LIGHT_RUNNING, 2}, {PF_LIGHT_PENDING, -1}, {PF_LIGHT_PENDING_BEAT, std::numeric_limits<double>::quiet_NaN()},
      {PF_LIGHT_ORIGIN_BEAT, std::numeric_limits<double>::infinity()}, {PF_LIGHT_COUNT, 33}, {PF_LIGHT_COUNT, .5}}) {
    auto bad = image(10); bad[bad_field.index] = bad_field.value; invalid_image(bad);
  }
  for (double bad_id : {-1., .5, 4294967296., std::numeric_limits<double>::quiet_NaN()}) {
    auto bad = image(10); row(bad, 0, bad_id, .5); invalid_image(bad);
  }
  for (double bad_level : {-1., 1.1, std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN()}) {
    auto bad = image(10); row(bad, 0, 17, bad_level); invalid_image(bad);
  }
  auto bad = image(10); row(bad, 0, 17, 1); row(bad, 1, 17, 0); invalid_image(bad);
  bad = image(10); bad[PF_LIGHT_SAMPLES] = 1; invalid_image(bad);
  bad = image(10); bad[PF_LIGHT_SAMPLES + 1] = std::numeric_limits<double>::quiet_NaN(); invalid_image(bad);
  invalid_image(image(10), PF_LIGHT_FIELDS - 1); invalid_image(image(10), PF_LIGHT_FIELDS + 1);
  result(pp_light_delivery_prepare(gate, &connection, nullptr, PF_LIGHT_FIELDS, &frame), PP_INVALID);
  data = image(10);
  result(pp_light_delivery_prepare(gate, &connection, data.data(), data.size(), nullptr), PP_INVALID);
  result(pp_light_delivery_prepare(gate, &connection, data.data(), data.size(), &frame), 1);
  result(pp_light_delivery_commit(gate, &frame), 1);

  data = image(11); row(data, 0, 17, .5);
  data[PF_LIGHT_RUNNING] = 1; data[PF_LIGHT_PENDING] = 1;
  data[PF_LIGHT_PENDING_BEAT] = 256; data[PF_LIGHT_COUNT_BEAT] = 123.25;
  result(pp_light_delivery_prepare(gate, &connection, data.data(), data.size(), &frame), 1);
  require(frame.reports[0][2] == 128, "pending replacement does not hide the engine's current active image");
  result(pp_light_delivery_commit(gate, &frame), 1);
  data[PF_LIGHT_SEQUENCE] = 12; data[PF_LIGHT_PENDING] = 0;
  data[PF_LIGHT_TIMELINE] = 1; data[PF_LIGHT_COUNT_BEAT] = -3.5;
  result(pp_light_delivery_prepare(gate, &connection, data.data(), data.size(), &frame), 1);
  require(frame.reports[0][2] == 128, "timeline and count changes do not independently cancel or rephase lights");
  result(pp_light_delivery_commit(gate, &frame), 1);
  observe(frame.reports[0][2]);
  data = image(9007199254740991.0); row(data, 0, 17, 1); invalid_image(data);
  data = image(9007199254740991.0); data[PF_LIGHT_PENDING] = 1; invalid_image(data);
  data = image(9007199254740991.0);
  result(pp_light_delivery_prepare(gate, &connection, data.data(), data.size(), &frame), 1);
  for (unsigned index = 0; index < frame.count; ++index) require(frame.reports[index][2] == 0, "terminal safe sequence is complete all-off");
  result(pp_light_delivery_commit(gate, &frame), 1);
  invalid_image(image(9007199254740992.0));

  connection.request_fence = 4;
  result(pp_light_delivery_bind(gate, &connection, bindings.data(), bindings.size()), 0);
  auto rolled_back = image(1);
  result(pp_light_delivery_prepare(gate, &connection, rolled_back.data(), rolled_back.size(), &frame), PP_STALE);
  result(pp_light_delivery_prepare(gate, &connection, data.data(), data.size(), &frame), 1);
  result(pp_light_delivery_commit(gate, &frame), 1);
  std::array<pp_light_binding, PP_LIGHT_OUTPUT_CAPACITY> all{};
  for (uint32_t index = 0; index < all.size(); ++index) all[index] = {index, index};
  connection.engine_incarnation = 3; connection.device_session = 4; connection.request_fence = 5;
  result(pp_light_delivery_bind(gate, &connection, all.data(), all.size()), 0);
  data = image(1);
  for (uint32_t index = 0; index < PF_LIGHT_CAPACITY; ++index) row(data, index, index, (index % 4) / 3.0);
  result(pp_light_delivery_prepare(gate, &connection, data.data(), data.size(), &frame), 1);
  require(frame.count == 96, "full explicit mapping fits bounded frame");
  for (uint32_t index = 0; index < frame.count; ++index) {
    require(frame.reports[index][0] == 3 && frame.reports[index][1] == index && frame.reports[index][3] == 0 && frame.reports[index][4] == 0,
      "every mapped output gets its own brightness-only report");
    require(frame.reports[index][2] == (index < 32 ? (index % 4) * 85 : 0), "complete image extinguishes every absent owned output");
    observe(frame.reports[index][2]);
  }
  result(pp_light_delivery_commit(gate, &frame), 1);
  connection.request_fence = 9007199254740991.0;
  result(pp_light_delivery_bind(gate, &connection, nullptr, 0), 0);
  result(pp_light_delivery_prepare(gate, &connection, data.data(), data.size(), &frame), 1);
  require(frame.count == 0, "empty owned mapping produces no hardware reports");
  result(pp_light_delivery_commit(gate, &frame), 1);
  result(pp_light_delivery_bind(gate, &connection, nullptr, 0), PP_INVALID);
  connection.request_fence = 9007199254740992.0;
  result(pp_light_delivery_bind(gate, &connection, nullptr, 0), PP_INVALID);
  result(pp_light_delivery_bind(nullptr, &connection, nullptr, 0), PP_INVALID);
  result(pp_light_delivery_commit(gate, nullptr), PP_INVALID);
  pp_light_delivery_destroy(gate);
  pp_light_delivery_destroy(nullptr);
}
