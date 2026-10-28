#pragma once
#include "peripheral_lights.h"
#include <array>
#include <cstdint>

namespace performanceLights {
constexpr uint32_t capacity = 32;
constexpr double maximumCounter = 9007199254740991.0;
enum class Result { Applied, Duplicate, Invalid, StaleGeneration, StaleRevision, Conflict, Exhausted };
struct Row {
  uint32_t id = 0;
  int kind = PP_LIGHT_OFF;
  double peak = 0, period = 0, duty = 0;
};

class Bank {
public:
  double generation() const { return generation_; }
  double run() const { return run_; }
  double count() const { return count_; }
  uint32_t size() const { return active_.size; }
  bool pending() const { return pending_present_; }
  double pendingTarget() const { return pending_target_; }
  double origin() const { return active_.origin; }
  bool exhausted() const { return exhausted_; }

  // A replacement is a complete image: absent IDs are off. Revision identifies
  // the request, not its arrival count. Duplicate requests never restart phase.
  Result replace(double expected_generation, double revision, int launch, double quantum,
    const Row* rows, uint32_t size, double current_count);
  bool advance(double current_count);
  bool invalidate(double current_count);
  bool start(double current_count);
  bool sample(uint32_t index, pp_light_sample& out) const;

private:
  struct Image {
    std::array<Row, capacity> rows{};
    uint32_t size = 0;
    double origin = 0;
  };
  Image active_, pending_;
  std::array<Row, capacity> request_{};
  uint32_t request_size_ = 0;
  double generation_ = 1, run_ = 0, count_ = 0, revision_ = 0;
  double request_quantum_ = 0, pending_target_ = 0;
  int request_launch_ = 0;
  bool pending_present_ = false, exhausted_ = false;

  void clear(double current_count);
  void exhaust();
};
}
