#include "performance_lights.h"
#include <algorithm>
#include <cmath>

namespace performanceLights {
namespace {
bool coordinate(double value) { return std::isfinite(value) && std::abs(value) <= maximumCounter; }
bool counter(double value) { return coordinate(value) && value >= 1 && std::floor(value) == value; }
constexpr bool canIncrement(double value) { return value < maximumCounter - 1; }
static_assert(canIncrement(maximumCounter - 2));
static_assert(!canIncrement(maximumCounter - 1) && !canIncrement(maximumCounter));
bool same(const Row& a, const Row& b) {
  return a.id == b.id && a.kind == b.kind && a.peak == b.peak && a.period == b.period && a.duty == b.duty;
}
bool valid(const Row& row) {
  if (!std::isfinite(row.peak) || row.peak < 0 || row.peak > 1 || !std::isfinite(row.period) || !std::isfinite(row.duty)) return false;
  switch (row.kind) {
    case PP_LIGHT_OFF: return row.peak == 0 && row.period == 0 && row.duty == 0;
    case PP_LIGHT_ON: return row.period == 0 && row.duty == 0;
    case PP_LIGHT_PULSE: return row.period > 0 && row.duty == 0;
    case PP_LIGHT_BLINK: return row.period > 0 && row.duty > 0 && row.duty < 1;
    default: return false;
  }
}
}

Result Bank::replace(double expected, double revision, int launch, double quantum,
    const Row* rows, uint32_t size, double current) {
  if (exhausted_) return Result::Exhausted;
  if (!counter(expected) || !counter(revision) || !coordinate(current) || current < count_ ||
      size > capacity || (size && !rows) || (launch != 0 && launch != 1) || !std::isfinite(quantum) ||
      (launch == 0 ? quantum != 0 : quantum <= 0)) return Result::Invalid;
  if (expected != generation_) return Result::StaleGeneration;
  for (uint32_t index = 0; index < size; ++index) {
    if (!valid(rows[index])) return Result::Invalid;
    for (uint32_t other = 0; other < index; ++other) if (rows[index].id == rows[other].id) return Result::Invalid;
  }
  if (revision < revision_) return Result::StaleRevision;
  if (revision == revision_) {
    if (size != request_size_ || launch != request_launch_ || quantum != request_quantum_) return Result::Conflict;
    for (uint32_t index = 0; index < size; ++index) if (!same(rows[index], request_[index])) return Result::Conflict;
    return Result::Duplicate;
  }
  const double target = launch == 0 ? current : std::ceil(current / quantum) * quantum;
  if (!coordinate(target) || target < current) return Result::Invalid;

  advance(current);
  Image replacement;
  replacement.size = size;
  replacement.origin = target;
  if (size) std::copy_n(rows, size, replacement.rows.begin());
  if (target == current) {
    active_ = replacement;
    pending_present_ = false;
  } else {
    pending_ = replacement;
    pending_target_ = target;
    pending_present_ = true;
  }
  if (size) std::copy_n(rows, size, request_.begin());
  request_size_ = size;
  request_launch_ = launch;
  request_quantum_ = quantum;
  revision_ = revision;
  return Result::Applied;
}

bool Bank::advance(double current) {
  if (exhausted_ || !coordinate(current) || current < count_) return false;
  count_ = current;
  if (pending_present_ && current >= pending_target_) {
    active_ = pending_;
    pending_present_ = false;
  }
  return true;
}
void Bank::clear(double current) {
  active_ = {};
  pending_ = {};
  request_ = {};
  request_size_ = 0;
  revision_ = request_quantum_ = pending_target_ = 0;
  request_launch_ = 0;
  pending_present_ = false;
  count_ = current;
}
void Bank::exhaust() {
  clear(count_);
  generation_ = maximumCounter;
  exhausted_ = true;
}
bool Bank::invalidate(double current) {
  if (exhausted_ || !coordinate(current)) return false;
  if (!canIncrement(generation_)) { exhaust(); return false; }
  ++generation_;
  clear(current);
  return true;
}
bool Bank::start(double current) {
  if (exhausted_ || !coordinate(current)) return false;
  if (!canIncrement(generation_) || !canIncrement(run_)) { exhaust(); return false; }
  ++generation_;
  ++run_;
  clear(current);
  return true;
}
bool Bank::sample(uint32_t index, pp_light_sample& out) const {
  if (index >= active_.size) return false;
  const auto& row = active_.rows[index];
  const pp_light_recipe recipe{row.id, row.kind, row.peak, active_.origin, row.period, row.duty};
  return pp_light_evaluate(&recipe, count_, &out) == 0;
}
}
