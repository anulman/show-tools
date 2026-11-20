#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iterator>

#include "performance_engine.h"
#include "peripheral_controls.h"

namespace performance_input {
constexpr double maximum_identity = 9007199254740991.;
constexpr uint32_t knob = 6, knob_observation = 7;
inline bool is_axis(uint32_t kind, uint32_t input) {
  return kind == PF_INPUT_PHYSICAL ? input == knob || input == knob_observation : input == 5;
}
inline bool identity(double value) {
  return std::isfinite(value) && value >= 1 && value <= maximum_identity && std::floor(value) == value;
}
constexpr uint32_t pedal = 4, mushroom = 5;
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
  bool inherit(Router& previous) {
    const double watermark = std::max(session_high_watermark(), previous.session_high_watermark());
    const bool same_bindings = std::equal(std::begin(bindings_), std::end(bindings_), std::begin(previous.bindings_),
      [](const Binding& a, const Binding& b) { return a.kind == b.kind && a.rows == b.rows; });
    if ((!same_bindings && !previous.replaceable()) || watermark >= maximum_identity) return false;
    for (const auto& producer : producers_)
      if (producer.active) return false;
    generation_ = previous.generation_ + (same_bindings ? 0 : 1);
    inherited_watermark_ = watermark;
    if (same_bindings) for (uint32_t slot = 0; slot < PF_INPUT_PRODUCERS; ++slot) {
      auto& target = producers_[slot];
      std::swap(target, previous.producers_[slot]);
      std::fill(std::begin(target.ownership), std::end(target.ownership), 0);
    }
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
  Binding binding(uint32_t input) const {
    if (input == pedal) return {PF_INPUT_TEMPO, 0};
    if (input == mushroom) return {PF_INPUT_PANIC, 0};
    return bindings_[input];
  }
  Producer* producer(uint32_t slot) { return slot < PF_INPUT_PRODUCERS ? &producers_[slot] : nullptr; }
  const Producer* producer(uint32_t slot) const { return slot < PF_INPUT_PRODUCERS ? &producers_[slot] : nullptr; }
  int check(uint32_t slot, double session, double generation, double sequence, uint32_t input, double value) const {
    const auto* item = producer(slot);
    if (!item || !identity(session) || !identity(generation) || !identity(sequence) || !std::isfinite(value))
      return PF_INVALID_INPUT;
    if (!item->active || item->session != session || generation != generation_ || sequence <= item->sequence)
      return PF_STALE_INPUT;
    if (input > 7) return PF_INVALID_INPUT;
    if (is_axis(item->kind, input)) return std::abs(value) <= maximum_identity ? PF_OK : PF_INVALID_INPUT;
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
    const bool axis = is_axis(item.kind, input);
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
      if (binding(input).kind == PF_INPUT_PANIC) out[PF_INPUT_PANIC_MASK] += 1u << input;
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
