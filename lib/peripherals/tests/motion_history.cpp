#include "motion_history.h"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <new>

static bool forbid_allocations = false;
void* operator new(size_t bytes) {
  if (forbid_allocations) std::abort();
  if (auto* memory = std::malloc(bytes ? bytes : 1)) return memory;
  std::abort();
}
void operator delete(void* memory) noexcept { std::free(memory); }
void operator delete(void* memory, size_t) noexcept { std::free(memory); }

using namespace peripheral_host;
void require(bool condition, const char* message) {
  if (!condition) { std::fprintf(stderr, "%s\n", message); std::abort(); }
}
MotionRate rate(const MotionHistory& history, uint64_t start, uint64_t end) {
  const auto result = history.interval(start, end);
  require(std::holds_alternative<MotionRate>(result), "Interval should be measured");
  return std::get<MotionRate>(result);
}
MotionPosition position(const MotionHistory& history) {
  const auto snapshot = history.snapshot();
  require(std::holds_alternative<MotionPosition>(snapshot.reference), "Position should be anchored");
  return std::get<MotionPosition>(snapshot.reference);
}

int main() {
  require(!MotionHistory::create(0) && !MotionHistory::create(1), "Capacity must hold a baseline and an observation");
  auto history = *MotionHistory::create(8);
  require(std::holds_alternative<MotionUnanchored>(history.snapshot().reference), "No source has no reference");
  require(std::holds_alternative<MotionHistoryUnavailable>(history.interval(0, 1)), "No source has no measured interval");
  require(history.begin_session(0, 0) == MotionResult::InvalidSession, "Session zero is reserved");
  require(history.begin_session(1, 100) == MotionResult::Applied, "Explicit source begins");
  require(history.zero(1, 1, 0, 100) == MotionResult::Applied, "Explicit software zero anchors position");
  require(history.observe(1, 200, 7) == MotionResult::Applied, "Positive raw counts accepted");
  require(history.observe(1, 200, -3) == MotionResult::Applied, "Same-timestamp sign reversal is real motion");
  require(history.observe(1, 300, -4) == MotionResult::Applied, "Negative raw counts accepted");
  require(position(history).counts == 0, "Opposite directions retain exact net position");
  require(std::holds_alternative<MotionHistoryUnavailable>(history.interval(100, 300)), "Unsealed future coverage cannot be invented");
  require(history.coverage_tick(1, 300) == MotionResult::Applied, "Drain seals source coverage");
  const auto all = rate(history, 100, 300);
  require(all.net_counts == 0 && all.nonzero_event_count == 3, "Zero net movement still reports three rotations");
  require(rate(history, 100, 200).net_counts == 4 && rate(history, 200, 300).net_counts == -4,
    "Intervals include end-time events and exclude start-time events");
  require(rate(history, 201, 299).nonzero_event_count == 0, "Covered quiet interval is measured rather than extrapolated");
  require(history.coverage_tick(1, 400) == MotionResult::Applied, "Source-owned idle coverage advances");
  require(history.zero(1, 2, 1, 400) == MotionResult::Applied, "Healthy zero changes reference");
  require(history.observe(1, 500, -2) == MotionResult::Applied && history.coverage_tick(1, 500) == MotionResult::Applied,
    "New motion follows healthy zero");
  require(history.zero(1, 2, 1, 400) == MotionResult::Applied && position(history).counts == -2,
    "Retrying exact zero does not zero subsequent motion");
  require(history.zero(1, 2, 1, 500) == MotionResult::InvalidZero, "A request ID cannot change meaning");
  require(history.zero(1, 3, 0, 500) == MotionResult::InvalidZero, "Zero requires current reference identity");
  require(rate(history, 100, 500).net_counts == -2 && rate(history, 100, 500).nonzero_event_count == 4,
    "Software zero preserves rate history");
  require(std::abs(rate(history, 400, 500).counts_per_second + 20000000.) < .001,
    "Rate uses raw counts and elapsed nanoseconds");
  require(history.observe(1, 500, 1) == MotionResult::Gap, "An event at an already sealed time invalidates coverage");
  require(std::holds_alternative<MotionGap>(history.snapshot().reference)
    && std::holds_alternative<MotionGap>(history.interval(100, 500)), "A gap is never presented as a position or rate");
  require(history.zero(1, 4, 2, 500) == MotionResult::Gap, "Zero alone cannot conceal missing source history");
  require(history.zero(1, 2, 1, 400) == MotionResult::Applied
    && std::holds_alternative<MotionGap>(history.snapshot().reference), "Old acknowledgement does not heal a gap");
  require(history.begin_session(1, 600) == MotionResult::InvalidSession, "Qualified source sessions cannot be reused");
  require(history.begin_session(2, 600) == MotionResult::Applied, "New qualification begins a new source session");
  require(std::holds_alternative<MotionGap>(history.snapshot().reference), "Changed source requires explicit new zero");
  require(history.observe(1, 900, 10) == MotionResult::StaleSession
    && history.mark_gap(1) == MotionResult::StaleSession, "Old callbacks do not corrupt replacement source");
  require(history.zero(2, 4, 0, 600) == MotionResult::Applied && position(history).counts == 0,
    "Fresh qualification and explicit zero recover continuity");
  require(history.mark_gap(2) == MotionResult::Gap && history.observe(2, 700, 1) == MotionResult::Gap,
    "Cancellation or explicit source loss remains sticky");

  auto time = *MotionHistory::create(4);
  time.begin_session(1, 0);
  require(time.observe(1, 20, 1) == MotionResult::Applied && time.observe(1, 19, 1) == MotionResult::Gap,
    "Out-of-order observations cannot silently reorder motion");
  time.begin_session(2, 0);
  time.zero(2, 1, 0, 0);
  time.observe(2, 20, 1);
  require(time.coverage_tick(2, 19) == MotionResult::Gap, "A drain cannot seal before already observed motion");
  time.begin_session(3, 0);
  time.zero(3, 2, 0, 0);
  time.observe(3, 10, 0);
  time.coverage_tick(3, 20);
  require(rate(time, 0, 20).nonzero_event_count == 0, "Zero reports do not invent rotation activity");
  require(time.coverage_tick(3, 20) == MotionResult::Applied, "Duplicate coverage is idempotent");
  require(time.coverage_tick(3, 19) == MotionResult::Gap, "Coverage cannot move backward");

  auto bounded = *MotionHistory::create(3);
  bounded.begin_session(1, 0);
  bounded.zero(1, 1, 0, 0);
  for (uint64_t index = 1; index <= 1000; ++index) {
    const int32_t delta = index % 2 ? 5 : -3;
    require(bounded.observe(1, index, delta) == MotionResult::Applied, "Bounded ring accepts signed motion");
    bounded.coverage_tick(1, index);
    const auto earliest = bounded.snapshot().earliest_retained_ns;
    require(earliest == (index > 2 ? index - 2 : 0), "Eviction exposes exact retained boundary");
    if (earliest) require(std::holds_alternative<MotionHistoryUnavailable>(bounded.interval(earliest - 1, index)),
      "Evicted prefixes cannot produce a rate");
    const auto previous = rate(bounded, index - 1, index);
    require(previous.net_counts == delta && previous.nonzero_event_count == 1, "Ring wrap preserves exact prefix differences");
  }
  require(position(bounded).counts == 1000, "Bounded history does not truncate cumulative position");
  require(std::holds_alternative<MotionHistoryUnavailable>(bounded.interval(1000, 1000))
    && std::holds_alternative<MotionHistoryUnavailable>(bounded.interval(1000, 999)), "Invalid intervals reject");
  bounded.observe(1, 1001, 2);
  require(bounded.zero(1, 2, 1, 1000) == MotionResult::InvalidZero, "Zero cannot use a stale drain with pending motion");
  require(bounded.snapshot().latest_observation_ns == 1001 && bounded.snapshot().observed_through_ns == 1000,
    "Observed events and sealed coverage remain distinct");

  auto limits = *MotionHistory::create(2);
  const auto maximum = std::numeric_limits<uint64_t>::max();
  limits.begin_session(1, maximum - 2);
  limits.zero(1, maximum, 0, maximum - 2);
  limits.observe(1, maximum - 1, std::numeric_limits<int32_t>::min());
  limits.coverage_tick(1, maximum);
  require(rate(limits, maximum - 2, maximum).net_counts == std::numeric_limits<int32_t>::min(),
    "Timestamp arithmetic and minimum signed delta do not wrap");
  require(limits.zero(1, 1, maximum, maximum) == MotionResult::InvalidZero, "Exhausted zero identity never wraps or reuses");
  int64_t checked = 0;
  const auto high = std::numeric_limits<int64_t>::max(), low = std::numeric_limits<int64_t>::min();
  require(!motion_detail::add(high, 1, checked) && !motion_detail::add(low, -1, checked), "Count overflow rejects both directions");
  require(motion_detail::add(high - 1, 1, checked) && checked == high
    && motion_detail::add(low + 1, -1, checked) && checked == low, "Exact count limits remain representable");
  require(!motion_detail::subtract(high, -1, checked) && !motion_detail::subtract(low, 1, checked),
    "Position and interval difference overflow reject before arithmetic");
  require(motion_detail::subtract(low, low, checked) && checked == 0
    && motion_detail::subtract(high, high, checked) && checked == 0, "Extreme equal endpoints subtract safely");

  auto realtime = *MotionHistory::create(8);
  forbid_allocations = true;
  realtime.begin_session(1, 0);
  realtime.zero(1, 1, 0, 0);
  for (uint64_t index = 1; index <= 1000; ++index) {
    realtime.observe(1, index, 1);
    realtime.coverage_tick(1, index);
    const auto value = realtime.interval(index - 1, index);
    require(std::get<MotionRate>(value).net_counts == 1, "Allocation-free source remains measurable");
    require(std::get<MotionPosition>(realtime.snapshot().reference).counts == int64_t(index), "Allocation-free position is exact");
  }
  forbid_allocations = false;
  std::puts("Motion history tests passed without devices or runtime allocations.");
}
