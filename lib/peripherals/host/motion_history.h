#pragma once
#include <cstddef>
#include <cstdint>
#include <limits>
#include <optional>
#include <variant>
#include <vector>

namespace peripheral_host {
namespace motion_detail {
inline bool add(int64_t left, int64_t right, int64_t& out) {
  if ((right > 0 && left > std::numeric_limits<int64_t>::max() - right)
      || (right < 0 && left < std::numeric_limits<int64_t>::min() - right)) return false;
  out = left + right;
  return true;
}
inline bool subtract(int64_t left, int64_t right, int64_t& out) {
  if ((right > 0 && left < std::numeric_limits<int64_t>::min() + right)
      || (right < 0 && left > std::numeric_limits<int64_t>::max() + right)) return false;
  out = left - right;
  return true;
}
}

struct MotionUnanchored {};
struct MotionGap {};
struct MotionOverflow {};
struct MotionHistoryUnavailable {};
struct MotionPosition { uint64_t zero_id; int64_t counts; };
struct MotionRate {
  int64_t net_counts;
  uint64_t elapsed_ns, nonzero_event_count;
  double counts_per_second;
};
using MotionReference = std::variant<MotionUnanchored, MotionPosition, MotionGap, MotionOverflow>;
using MotionInterval = std::variant<MotionRate, MotionHistoryUnavailable, MotionGap, MotionOverflow>;
enum class MotionResult { Applied, StaleSession, InvalidSession, InvalidZero, Gap, Overflow };
struct MotionSnapshot {
  uint64_t device_session, earliest_retained_ns, observed_through_ns, latest_observation_ns;
  MotionReference reference;
};

// One owner supplies exactly-once observations and seals timestamps only after draining the source.
class MotionHistory {
 public:
  static std::optional<MotionHistory> create(size_t capacity) {
    if (capacity < 2) return std::nullopt;
    return MotionHistory(capacity);
  }
  MotionResult begin_session(uint64_t session, uint64_t time_ns) {
    if (!session || session <= session_) return MotionResult::InvalidSession;
    phase_ = session_ ? Phase::NeedsZero : Phase::Unanchored;
    session_ = session;
    head_ = 0;
    size_ = 1;
    counts_ = 0;
    events_ = 0;
    zero_id_ = 0;
    zero_offset_ = 0;
    last_event_ns_ = observed_through_ns_ = time_ns;
    points_[0] = {time_ns, 0, 0};
    return MotionResult::Applied;
  }
  MotionResult observe(uint64_t session, uint64_t time_ns, int32_t delta_counts) {
    if (!session || session != session_) return MotionResult::StaleSession;
    if (!healthy()) return failure();
    if (time_ns <= observed_through_ns_ || time_ns < last_event_ns_) return gap();
    int64_t next, displayed;
    if (!motion_detail::add(counts_, delta_counts, next)
        || (phase_ == Phase::Anchored && !motion_detail::subtract(next, zero_offset_, displayed))
        || (delta_counts && events_ == std::numeric_limits<uint64_t>::max())) {
      phase_ = Phase::Overflow;
      return MotionResult::Overflow;
    }
    last_event_ns_ = time_ns;
    if (!delta_counts) return MotionResult::Applied;
    counts_ = next;
    ++events_;
    if (point(size_ - 1).time_ns == time_ns) {
      point(size_ - 1) = {time_ns, counts_, events_};
    } else if (size_ < points_.size()) {
      point(size_) = {time_ns, counts_, events_};
      ++size_;
    } else {
      points_[head_] = {time_ns, counts_, events_};
      head_ = head_ + 1 == points_.size() ? 0 : head_ + 1;
    }
    return MotionResult::Applied;
  }
  MotionResult coverage_tick(uint64_t session, uint64_t time_ns) {
    if (!session || session != session_) return MotionResult::StaleSession;
    if (!healthy()) return failure();
    if (time_ns < observed_through_ns_ || time_ns < last_event_ns_) return gap();
    observed_through_ns_ = time_ns;
    return MotionResult::Applied;
  }
  MotionResult mark_gap(uint64_t session) {
    if (!session || session != session_) return MotionResult::StaleSession;
    if (phase_ == Phase::Overflow) return MotionResult::Overflow;
    return gap();
  }
  MotionResult zero(uint64_t session, uint64_t request_id, uint64_t expected_zero_id, uint64_t time_ns) {
    if (!session || session != session_) return MotionResult::StaleSession;
    if (request_id && request_id == last_zero_.id && last_zero_.session == session) {
      return expected_zero_id == last_zero_.expected && time_ns == last_zero_.time_ns
        ? MotionResult::Applied : MotionResult::InvalidZero;
    }
    if (!healthy()) return failure();
    if (!request_id || request_id <= last_zero_.id || expected_zero_id != zero_id_
        || time_ns != observed_through_ns_ || last_event_ns_ > time_ns) return MotionResult::InvalidZero;
    zero_offset_ = counts_;
    zero_id_ = request_id;
    last_zero_ = {session, request_id, expected_zero_id, time_ns};
    phase_ = Phase::Anchored;
    return MotionResult::Applied;
  }
  MotionSnapshot snapshot() const {
    MotionReference reference = MotionUnanchored{};
    if (phase_ == Phase::Gap || phase_ == Phase::NeedsZero) reference = MotionGap{};
    else if (phase_ == Phase::Overflow) reference = MotionOverflow{};
    else if (phase_ == Phase::Anchored) {
      int64_t value;
      if (motion_detail::subtract(counts_, zero_offset_, value)) reference = MotionPosition{zero_id_, value};
      else reference = MotionOverflow{};
    }
    return {session_, size_ ? point(0).time_ns : 0, observed_through_ns_, last_event_ns_, reference};
  }
  MotionInterval interval(uint64_t start_ns, uint64_t end_ns) const {
    if (phase_ == Phase::Overflow) return MotionOverflow{};
    if (phase_ == Phase::Gap || phase_ == Phase::NeedsZero) return MotionGap{};
    if (!session_ || start_ns >= end_ns || start_ns < point(0).time_ns
        || end_ns > observed_through_ns_) return MotionHistoryUnavailable{};
    const Point* start = &point(0);
    const Point* end = start;
    for (size_t index = 1; index < size_; ++index) {
      const auto& item = point(index);
      if (item.time_ns <= start_ns) start = &item;
      if (item.time_ns <= end_ns) end = &item;
      else break;
    }
    int64_t net;
    if (!motion_detail::subtract(end->counts, start->counts, net)) return MotionOverflow{};
    const auto elapsed = end_ns - start_ns;
    return MotionRate{net, elapsed, end->events - start->events, double(net) / double(elapsed) * 1e9};
  }

 private:
  explicit MotionHistory(size_t capacity) : points_(capacity) {}
  enum class Phase { NoSession, Unanchored, Anchored, NeedsZero, Gap, Overflow };
  struct Point { uint64_t time_ns; int64_t counts; uint64_t events; };
  struct Zero { uint64_t session = 0, id = 0, expected = 0, time_ns = 0; };
  size_t slot(size_t offset) const {
    const auto tail = points_.size() - head_;
    return offset < tail ? head_ + offset : offset - tail;
  }
  Point& point(size_t offset) { return points_[slot(offset)]; }
  const Point& point(size_t offset) const { return points_[slot(offset)]; }
  bool healthy() const {
    return phase_ == Phase::Unanchored || phase_ == Phase::Anchored || phase_ == Phase::NeedsZero;
  }
  MotionResult failure() const { return phase_ == Phase::Overflow ? MotionResult::Overflow : MotionResult::Gap; }
  MotionResult gap() { phase_ = Phase::Gap; return MotionResult::Gap; }
  std::vector<Point> points_;
  size_t head_ = 0, size_ = 0;
  Phase phase_ = Phase::NoSession;
  uint64_t session_ = 0, last_event_ns_ = 0, observed_through_ns_ = 0, events_ = 0, zero_id_ = 0;
  int64_t counts_ = 0, zero_offset_ = 0;
  Zero last_zero_;
};
}
