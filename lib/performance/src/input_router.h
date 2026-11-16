#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>

#include "performance_engine.h"
#include "peripheral_controls.h"

namespace performance_input {
constexpr double maximum_identity = 9007199254740991.;
inline bool identity(double value) {
  return std::isfinite(value) && value >= 1 && value <= maximum_identity && std::floor(value) == value;
}
struct Binding {
  int kind = -1;
  uint32_t rows = 0;
};
struct Producer {
  pp_inputs* latch = nullptr;
  bool active = false;
  double session = 0, sequence = 0;
  uint32_t kind = 0, released = 0, held = 0;
  uint64_t ownership[8]{};
};
class Router {
 public:
  Router() {
    for (auto& producer : producers_) producer.latch = pp_create();
  }
  ~Router() {
    for (auto& producer : producers_) pp_destroy(producer.latch);
  }
  Router(const Router&) = delete;
  Router& operator=(const Router&) = delete;
  bool ready() const {
    for (const auto& producer : producers_)
      if (!producer.latch) return false;
    return true;
  }
  double generation() const { return generation_; }
  bool replaceable() const { return generation_ < maximum_identity; }
  double session_high_watermark() const {
    double watermark = inherited_watermark_;
    for (const auto& item : producers_) watermark = std::max(watermark, item.session);
    return watermark;
  }
  bool inherit(const Router& previous) {
    const double watermark = std::max(session_high_watermark(), previous.session_high_watermark());
    if (!previous.replaceable() || watermark >= maximum_identity) return false;
    for (const auto& producer : producers_)
      if (producer.active) return false;
    generation_ = previous.generation_ + 1;
    inherited_watermark_ = watermark;
    return true;
  }
  void replace(const Binding* bindings) {
    ++generation_;
    for (auto& producer : producers_) {
      producer.active = false;
      std::fill(std::begin(producer.ownership), std::end(producer.ownership), 0);
    }
    std::copy(bindings, bindings + PF_INPUT_SWITCHES, bindings_);
  }
  const Binding& binding(uint32_t input) const { return bindings_[input]; }
  Producer* producer(uint32_t slot) { return slot < PF_INPUT_PRODUCERS ? &producers_[slot] : nullptr; }
  const Producer* producer(uint32_t slot) const { return slot < PF_INPUT_PRODUCERS ? &producers_[slot] : nullptr; }
  int check(uint32_t slot, double session, double generation, double sequence, uint32_t input, double value) const {
    const auto* item = producer(slot);
    if (!item || !identity(session) || !identity(generation) || !identity(sequence) || !std::isfinite(value))
      return PF_INVALID_INPUT;
    if (!item->active || item->session != session || generation != generation_ || sequence <= item->sequence)
      return PF_STALE_INPUT;
    const bool physical = item->kind == PF_INPUT_PHYSICAL;
    if (input > (physical ? 6u : 7u)) return PF_INVALID_INPUT;
    const bool axis = input == (physical ? 6u : 5u);
    if (axis) return std::abs(value) <= maximum_identity ? PF_OK : PF_INVALID_INPUT;
    return value == 0 || value == 1 ? PF_OK : PF_INVALID_INPUT;
  }
  int attach(uint32_t slot, double session, double generation, uint32_t kind, uint32_t released, uint32_t held) {
    auto* item = producer(slot);
    const uint32_t allowed = kind == PF_INPUT_PHYSICAL ? 63 : 223;
    if (!item || !identity(session) || !identity(generation) || kind > PF_INPUT_POINTER || (released & held) ||
        ((released | held) & ~allowed))
      return PF_INVALID_INPUT;
    if (generation != generation_ || session <= item->session || session <= inherited_watermark_) return PF_STALE_INPUT;
    if (pp_begin(item->latch, session, released, held) != PP_IGNORED) return PF_INVALID_INPUT;
    item->active = true;
    item->session = session;
    item->sequence = 0;
    item->kind = kind;
    item->released = released;
    item->held = held;
    std::fill(std::begin(item->ownership), std::end(item->ownership), 0);
    return PF_OK;
  }
  int observe(uint32_t slot, double session, double sequence, uint32_t input, double value) {
    auto& item = producers_[slot];
    const bool axis = input == (item.kind == PF_INPUT_PHYSICAL ? 6u : 5u);
    const int result = axis ? pp_rotate(item.latch, session, sequence, value)
                            : pp_key(item.latch, session, sequence, input, int(value));
    if (result < 0) return result;
    item.sequence = sequence;
    if (!axis) {
      const uint32_t bit = uint32_t(1) << input;
      if (value == 0) {
        item.released |= bit;
        item.held &= ~bit;
      } else {
        item.held |= bit;
        item.released &= ~bit;
      }
    }
    return result;
  }
  uint64_t ownership() { return ++next_ownership_; }
  bool physical_held(uint32_t input) const {
    for (const auto& item : producers_)
      if (item.active && item.kind == PF_INPUT_PHYSICAL && (item.held & (1u << input))) return true;
    return false;
  }
  void info(double* out) const {
    std::fill(out, out + PF_INPUT_INFO_FIELDS, 0);
    out[PF_INPUT_GENERATION] = generation_;
    out[PF_INPUT_SESSION_HIGH_WATERMARK] = session_high_watermark();
    for (uint32_t input = 0; input < PF_INPUT_SWITCHES; ++input)
      if (bindings_[input].kind == PF_INPUT_PANIC) out[PF_INPUT_PANIC_MASK] += 1u << input;
    uint32_t count = 0;
    for (uint32_t slot = 0; slot < PF_INPUT_PRODUCERS; ++slot) {
      const auto& item = producers_[slot];
      if (!item.active) continue;
      auto* row = out + PF_INPUT_RECORDS + count++ * PF_INPUT_PRODUCER_FIELDS;
      row[PF_INPUT_SLOT] = slot;
      row[PF_INPUT_SESSION] = item.session;
      row[PF_INPUT_KIND] = item.kind;
      row[PF_INPUT_RELEASED_MASK] = item.released;
      row[PF_INPUT_HELD_MASK] = item.held;
      row[PF_INPUT_LAST_SEQUENCE] = item.sequence;
    }
    out[PF_INPUT_COUNT] = count;
  }

 private:
  Producer producers_[PF_INPUT_PRODUCERS];
  Binding bindings_[PF_INPUT_SWITCHES];
  double generation_ = 1;
  double inherited_watermark_ = 0;
  uint64_t next_ownership_ = 16;
};
}  // namespace performance_input
