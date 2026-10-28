#include "peripheral_light_delivery.h"
#include "performance_light_output.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <new>

namespace {
static_assert(PF_LIGHT_FIELDS == PF_LIGHT_SAMPLES + PF_LIGHT_CAPACITY * PF_LIGHT_SAMPLE_FIELDS, "Complete publication layout");
constexpr double safe_integer = 9007199254740991.0;
bool integer(double value, double minimum, double maximum = safe_integer) {
  return std::isfinite(value) && value >= minimum && value <= maximum && std::floor(value) == value;
}
bool connection_valid(const pp_light_connection& value) {
  return integer(value.engine_incarnation, 1) && integer(value.device_session, 1) &&
    integer(value.binding_revision, 1) && integer(value.request_fence, 1);
}
bool same_connection(const pp_light_connection& left, const pp_light_connection& right) {
  return left.engine_incarnation == right.engine_incarnation && left.device_session == right.device_session &&
    left.binding_revision == right.binding_revision && left.request_fence == right.request_fence;
}
bool publication_valid(const double* data, uint32_t fields) {
  if (!data || fields != PF_LIGHT_FIELDS || data[PF_LIGHT_FORMAT] != PF_LIGHT_VERSION ||
      !integer(data[PF_LIGHT_GENERATION], 1) || !integer(data[PF_LIGHT_RUN], 0) ||
      !integer(data[PF_LIGHT_EPOCH], 1) || !integer(data[PF_LIGHT_TIMELINE], 0) ||
      !integer(data[PF_LIGHT_SEQUENCE], 1) || !integer(data[PF_LIGHT_FRAME], 0) ||
      !integer(data[PF_LIGHT_RATE], 8000, 192000) ||
      !std::isfinite(data[PF_LIGHT_COUNT_BEAT]) || !integer(data[PF_LIGHT_RUNNING], 0, 1) ||
      !integer(data[PF_LIGHT_PENDING], 0, 1) || !std::isfinite(data[PF_LIGHT_PENDING_BEAT]) ||
      !std::isfinite(data[PF_LIGHT_ORIGIN_BEAT]) || !integer(data[PF_LIGHT_COUNT], 0, PF_LIGHT_CAPACITY)) return false;
  const auto count = uint32_t(data[PF_LIGHT_COUNT]);
  for (uint32_t row = 0; row < PF_LIGHT_CAPACITY; ++row) {
    const auto offset = PF_LIGHT_SAMPLES + row * PF_LIGHT_SAMPLE_FIELDS;
    const auto id = data[offset + PF_LIGHT_SAMPLE_ID], level = data[offset + PF_LIGHT_SAMPLE_LEVEL];
    if (row >= count) {
      if (id != 0 || level != 0) return false;
      continue;
    }
    if (!integer(id, 0, std::numeric_limits<uint32_t>::max()) || !std::isfinite(level) || level < 0 || level > 1)
      return false;
    for (uint32_t prior = 0; prior < row; ++prior)
      if (id == data[PF_LIGHT_SAMPLES + prior * PF_LIGHT_SAMPLE_FIELDS + PF_LIGHT_SAMPLE_ID]) return false;
    if (data[PF_LIGHT_SEQUENCE] == safe_integer && level != 0) return false;
  }
  return data[PF_LIGHT_SEQUENCE] != safe_integer || data[PF_LIGHT_PENDING] == 0;
}
}

struct pp_light_delivery {
  bool bound = false, pending = false;
  pp_light_connection connection{};
  uint32_t count = 0;
  std::array<pp_light_binding, PP_LIGHT_OUTPUT_CAPACITY> bindings{};
  double committed = 0, newest = 0;
  std::array<double, PF_LIGHT_FIELDS> image{};
  pp_light_delivery_frame prepared{};
};

pp_light_delivery* pp_light_delivery_create() { return new (std::nothrow) pp_light_delivery; }
void pp_light_delivery_destroy(pp_light_delivery* delivery) { delete delivery; }
int pp_light_delivery_bind(pp_light_delivery* state, const pp_light_connection* connection,
    const pp_light_binding* bindings, uint32_t count) {
  if (!state || !connection || !connection_valid(*connection) || count > PP_LIGHT_OUTPUT_CAPACITY ||
      (count && !bindings) || (state->bound && connection->request_fence <= state->connection.request_fence)) return PP_INVALID;
  std::array<pp_light_binding, PP_LIGHT_OUTPUT_CAPACITY> mapped{};
  for (uint32_t index = 0; index < count; ++index) {
    if (bindings[index].sdk_channel >= PP_LIGHT_OUTPUT_CAPACITY) return PP_INVALID;
    for (uint32_t prior = 0; prior < index; ++prior)
      if (bindings[prior].led_id == bindings[index].led_id || bindings[prior].sdk_channel == bindings[index].sdk_channel)
        return PP_INVALID;
    mapped[index] = bindings[index];
  }
  if (!state->bound || state->connection.engine_incarnation != connection->engine_incarnation) state->newest = 0;
  state->connection = *connection;
  state->bindings = mapped;
  state->count = count;
  state->bound = true;
  state->pending = false;
  state->committed = 0;
  return 0;
}
int pp_light_delivery_prepare(pp_light_delivery* state, const pp_light_connection* requested,
    const double* data, uint32_t fields, pp_light_delivery_frame* out) {
  if (!state || !requested || !out || !connection_valid(*requested)) return PP_INVALID;
  if (!state->bound || !same_connection(state->connection, *requested)) return PP_STALE;
  if (!publication_valid(data, fields)) return PP_INVALID;
  const double sequence = data[PF_LIGHT_SEQUENCE];
  if (sequence <= state->committed || sequence < state->newest) return PP_STALE;
  if (sequence == state->newest &&
      !std::equal(state->image.begin(), state->image.end(), data)) return PP_INVALID;
  pp_light_delivery_frame frame{};
  frame.connection = *requested;
  frame.publication = sequence;
  frame.count = state->count;
  for (uint32_t index = 0; index < state->count; ++index) {
    double level = 0;
    for (uint32_t row = 0; row < uint32_t(data[PF_LIGHT_COUNT]); ++row) {
      const auto offset = PF_LIGHT_SAMPLES + row * PF_LIGHT_SAMPLE_FIELDS;
      if (data[offset + PF_LIGHT_SAMPLE_ID] == state->bindings[index].led_id) {
        level = data[offset + PF_LIGHT_SAMPLE_LEVEL];
        break;
      }
    }
    pp_ipac_led_report(state->bindings[index].sdk_channel, uint32_t(std::lround(level * 255)), frame.reports[index]);
  }
  std::copy_n(data, PF_LIGHT_FIELDS, state->image.begin());
  state->newest = sequence;
  state->prepared = frame;
  state->pending = true;
  *out = frame;
  return 1;
}
int pp_light_delivery_commit(pp_light_delivery* state, const pp_light_delivery_frame* frame) {
  if (!state || !frame || !connection_valid(frame->connection) || !integer(frame->publication, 1) ||
      frame->count > PP_LIGHT_OUTPUT_CAPACITY) return PP_INVALID;
  if (!state->bound || !state->pending || !same_connection(state->connection, frame->connection) ||
      frame->publication != state->prepared.publication || frame->publication <= state->committed) return PP_STALE;
  if (frame->count != state->prepared.count) return PP_INVALID;
  for (uint32_t row = 0; row < PP_LIGHT_OUTPUT_CAPACITY; ++row)
    for (uint32_t byte = 0; byte < PP_LED_REPORT_BYTES; ++byte)
      if (frame->reports[row][byte] != state->prepared.reports[row][byte]) return PP_INVALID;
  state->committed = frame->publication;
  state->pending = false;
  return 1;
}
