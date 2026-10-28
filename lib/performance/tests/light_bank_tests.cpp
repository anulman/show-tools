#include "performance_lights.h"
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <new>

namespace {
bool watch_heap = false;
unsigned allocations = 0, releases = 0;
void require(bool condition, const char* message) {
  if (!condition) { std::fprintf(stderr, "%s\n", message); std::abort(); }
}
using performanceLights::Bank;
using performanceLights::Row;
using performanceLights::Result;
double level(const Bank& bank, uint32_t index = 0) {
  pp_light_sample sample{};
  require(bank.sample(index, sample), "sample active light");
  require(sample.level >= 0 && sample.level <= 1 && std::isfinite(sample.level), "sample normalized level");
  return sample.level;
}
void close(double actual, double expected, const char* message) { require(std::abs(actual - expected) < 1e-12, message); }
const Row steady{19, PP_LIGHT_ON, .6, 0, 0};
const Row pulse{7, PP_LIGHT_PULSE, .8, 2, 0};
const Row blink{UINT32_MAX, PP_LIGHT_BLINK, .4, .5, .25};
const double not_number = std::numeric_limits<double>::quiet_NaN();
const double inf = std::numeric_limits<double>::infinity();
}
#ifndef __EMSCRIPTEN__
void* operator new(std::size_t size) {
  if (watch_heap) ++allocations;
  void* value = std::malloc(size ? size : 1);
  if (!value) std::abort();
  return value;
}
void* operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void* value) noexcept { if (watch_heap && value) ++releases; std::free(value); }
void operator delete[](void* value) noexcept { ::operator delete(value); }
void operator delete(void* value, std::size_t) noexcept { ::operator delete(value); }
void operator delete[](void* value, std::size_t) noexcept { ::operator delete(value); }
#endif

int main() {
  Bank bank;
  require(bank.size() == 0 && !bank.pending() && bank.generation() == 1 && bank.run() == 0, "initial complete image empty");
  require(bank.start(0) && bank.run() == 1 && bank.generation() == 2, "start increments run and validity generation");
  const double generation = bank.generation();
  require(bank.replace(generation, 1, 0, 0, &steady, 1, .125) == Result::Applied, "immediate steady request accepted");
  require(level(bank) == .6 && bank.origin() == .125, "immediate origin is authoritative coordinate");
  require(bank.replace(generation, 2, 1, 1, &pulse, 1, .25) == Result::Applied, "quantized replacement accepted");
  require(bank.pending() && bank.pendingTarget() == 1 && level(bank) == .6, "old image remains before keyframe");
  require(bank.advance(std::nextafter(1., 0.)) && level(bank) == .6, "one representable coordinate before target keeps old bank");
  require(bank.advance(1) && !bank.pending() && bank.origin() == 1 && level(bank) == .8, "inclusive exact boundary activates at peak");
  require(bank.advance(1.5), "advance quarter-period");
  close(level(bank), .4, "pulse quarter-period is half brightness");
  require(bank.replace(generation, 2, 1, 1, &pulse, 1, 1.75) == Result::Duplicate, "same request revision is idempotent despite later arrival");
  require(bank.origin() == 1 && bank.count() == 1.5, "duplicate neither resets origin nor mutates observation coordinate");
  require(bank.advance(2) && level(bank) == 0, "pulse trough exact half-period");
  require(bank.advance(3) && level(bank) == .8, "pulse full-period returns peak");
  pp_light_sample identity{};
  require(bank.sample(0, identity) && identity.led_id == 7, "logical ID copied without physical remapping");
  identity = {42, .2};
  require(!bank.sample(1, identity) && identity.led_id == 42 && identity.level == .2, "invalid sample index preserves output");

  require(bank.replace(generation, 3, 1, 2, &blink, 1, 3.25) == Result::Applied && bank.pendingTarget() == 4,
    "pending blink selected by PE grid");
  require(bank.replace(generation, 4, 1, 4, &steady, 1, 3.5) == Result::Applied && bank.pendingTarget() == 4,
    "new revision supersedes pending image");
  require(bank.advance(4) && level(bank) == .6, "superseded blink never activates");
  require(bank.replace(generation, 5, 0, 0, &blink, 1, 4.25) == Result::Applied, "immediate blink accepted");
  require(level(bank) == .4, "blink begins on at native origin");
  require(bank.advance(4.375) && level(bank) == 0, "blink is off exactly at duty endpoint");
  require(bank.advance(4.75) && level(bank) == .4, "blink period endpoint begins on");

  const auto reject = [&](Result expected, double gen, double revision, int launch, double quantum,
      const Row* rows, uint32_t size, double position) {
    const double before_count = bank.count(), before_origin = bank.origin(), before_level = level(bank);
    const uint32_t before_size = bank.size();
    const bool before_pending = bank.pending();
    const double before_target = bank.pendingTarget();
    require(bank.replace(gen, revision, launch, quantum, rows, size, position) == expected, "invalid/conflicting request rejected");
    require(bank.count() == before_count && bank.origin() == before_origin && bank.size() == before_size &&
      bank.pending() == before_pending && bank.pendingTarget() == before_target && level(bank) == before_level,
      "failed replacement preserves complete active/pending bank and observation coordinate");
  };
  reject(Result::StaleGeneration, generation - 1, 6, 0, 0, &steady, 1, 5);
  reject(Result::StaleRevision, generation, 4, 0, 0, &steady, 1, 5);
  reject(Result::Conflict, generation, 5, 0, 0, &steady, 1, 5);
  for (double bad : {not_number, inf, -1., 0., 1.5, performanceLights::maximumCounter + 1}) {
    reject(Result::Invalid, generation, bad, 0, 0, &steady, 1, 5);
  }
  reject(Result::Invalid, generation, 6, 2, 0, &steady, 1, 5);
  reject(Result::Invalid, generation, 6, 0, 1, &steady, 1, 5);
  for (double bad : {not_number, inf, -1., 0., std::numeric_limits<double>::denorm_min()}) {
    reject(Result::Invalid, generation, 6, 1, bad, &steady, 1, 5);
  }
  for (double bad : {not_number, inf, 4., performanceLights::maximumCounter + 1}) {
    reject(Result::Invalid, generation, 6, 0, 0, &steady, 1, bad);
  }
  reject(Result::Invalid, generation, 6, 0, 0, nullptr, 1, 5);
  reject(Result::Invalid, generation, 6, 0, 0, &steady, performanceLights::capacity + 1, 5);
  const std::array<Row, 2> duplicate_ids{{steady, steady}};
  reject(Result::Invalid, generation, 6, 0, 0, duplicate_ids.data(), duplicate_ids.size(), 5);
  for (const Row bad : {Row{1, PP_LIGHT_OFF, .1, 0, 0}, Row{1, PP_LIGHT_ON, .5, 1, 0},
      Row{1, PP_LIGHT_PULSE, .5, 2, .2}, Row{1, PP_LIGHT_PULSE, .5, 0, 0},
      Row{1, PP_LIGHT_BLINK, .5, 2, 0}, Row{1, PP_LIGHT_BLINK, .5, 2, 1},
      Row{1, PP_LIGHT_ON, -1, 0, 0}, Row{1, PP_LIGHT_ON, 1.1, 0, 0},
      Row{1, 4, .5, 0, 0}, Row{1, PP_LIGHT_ON, not_number, 0, 0},
      Row{1, PP_LIGHT_PULSE, .5, inf, 0}, Row{1, PP_LIGHT_BLINK, .5, 1, not_number}}) {
    reject(Result::Invalid, generation, 6, 0, 0, &bad, 1, 5);
  }
  require(!bank.advance(0) && !bank.advance(not_number) && !bank.invalidate(inf) && !bank.start(not_number), "invalid time/lifecycle input rejected");
  require(bank.generation() == generation && bank.run() == 1 && bank.count() == 4.75 && level(bank) == .4,
    "invalid time/lifecycle input preserves output and counters");
  require(bank.replace(generation, 6, 0, 0, nullptr, 0, 5) == Result::Applied && bank.size() == 0,
    "zero-row replacement is complete all-off image");

  require(bank.replace(generation, 7, 0, 0, &steady, 1, 5) == Result::Applied, "old revision rejection did not consume new revision");
  require(bank.replace(generation, 8, 1, 1, &pulse, 1, 5.25) == Result::Applied && bank.pending(), "pending before reset");
  const std::array<Row, 2> invalid_pending{{steady, Row{7, PP_LIGHT_BLINK, .4, 1, 1}}};
  require(bank.replace(generation, 9, 0, 0, invalid_pending.data(), invalid_pending.size(), 5.5) == Result::Invalid &&
    bank.pending() && bank.pendingTarget() == 6 && bank.count() == 5.25 && level(bank) == .6,
    "malformed later row preserves old active bank, pending target and observation coordinate atomically");
  require(bank.invalidate(0) && bank.generation() == generation + 1 && bank.run() == 1 && bank.size() == 0 && !bank.pending(),
    "invalidate clears active and pending, changes validity but not run");
  require(bank.replace(generation, 9, 0, 0, &steady, 1, 0) == Result::StaleGeneration, "stale token cannot rearm after invalidation");
  require(bank.start(0) && bank.run() == 2 && bank.generation() == generation + 2, "restart increments run independently");
  require(bank.replace(bank.generation(), 1, 1, .5, &pulse, 1, 0) == Result::Applied && !bank.pending() && level(bank) == .8,
    "inclusive grid request on exact boundary activates now");
  require(bank.replace(bank.generation(), 2, 1, .5, &blink, 1, std::nextafter(.5, 1.)) == Result::Applied && bank.pendingTarget() == 1,
    "one representable step after boundary waits for following grid, no millisecond tolerance");

  std::array<Row, performanceLights::capacity> many{};
  for (uint32_t index = 0; index < many.size(); ++index) many[index] = {index, PP_LIGHT_ON, index / 32., 0, 0};
  require(bank.replace(bank.generation(), 3, 0, 0, many.data(), many.size(), 1) == Result::Applied && bank.size() == many.size(),
    "full bounded bank supported");
  watch_heap = true;
  for (unsigned index = 0; index < 1000; ++index) {
    require(bank.advance(1 + index / 128.), "advance without allocation");
    require(bank.replace(bank.generation(), 4 + index, 0, 0, many.data(), many.size(), bank.count()) == Result::Applied,
      "replace without allocation");
    for (uint32_t row = 0; row < bank.size(); ++row) close(level(bank, row), row / 32., "sample full bank without allocation");
  }
  watch_heap = false;
  require(allocations == 0 && releases == 0, "light domain operations allocate and free no heap");

  std::printf("Light bank domain tests passed.\n");
}
