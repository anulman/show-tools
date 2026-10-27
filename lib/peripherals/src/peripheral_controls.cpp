#include "peripheral_controls.h"
#include <algorithm>
#include <cmath>
#include <new>

namespace {
constexpr double exact_integer = 9007199254740991.0;
bool counter(double value) { return std::isfinite(value) && value >= 0 && value <= exact_integer && std::floor(value) == value; }
bool level(double value) { return std::isfinite(value) && value >= 0 && value <= 1; }
}

struct pp_inputs {
  double session = 0, sequence = -1;
  uint32_t armed = 0, down = 0;
};

uint32_t pp_abi_version() { return PP_ABI_VERSION; }
pp_inputs* pp_create() { return new (std::nothrow) pp_inputs; }
void pp_destroy(pp_inputs* inputs) { delete inputs; }
int pp_begin(pp_inputs* inputs, double session, uint32_t released, uint32_t held) {
  if (!inputs || !counter(session) || session == 0 || (released & held)) return PP_INVALID;
  if (session <= inputs->session) return PP_STALE;
  inputs->session = session;
  inputs->sequence = -1;
  inputs->armed = released;
  inputs->down = held;
  return PP_IGNORED;
}

namespace {
int order(const pp_inputs* inputs, double session, double sequence) {
  if (!inputs || !counter(session) || session == 0 || !counter(sequence)) return PP_INVALID;
  if (inputs->session != session || sequence <= inputs->sequence) return PP_STALE;
  return PP_IGNORED;
}
}

int pp_key(pp_inputs* inputs, double session, double sequence, uint32_t slot, int down) {
  if (slot >= PP_SWITCH_SLOTS || (down != 0 && down != 1)) return PP_INVALID;
  int result = order(inputs, session, sequence);
  if (result < 0) return result;
  inputs->sequence = sequence;
  uint32_t bit = uint32_t(1) << slot;
  bool was_down = inputs->down & bit;
  if (!down) {
    bool was_armed = inputs->armed & bit;
    inputs->down &= ~bit;
    inputs->armed |= bit;
    return was_down && was_armed ? PP_RELEASE : PP_IGNORED;
  }
  inputs->down |= bit;
  return !was_down && (inputs->armed & bit) ? PP_PRESS : PP_IGNORED;
}

int pp_rotate(pp_inputs* inputs, double session, double sequence, double distance) {
  if (!std::isfinite(distance) || std::abs(distance) > exact_integer) return PP_INVALID;
  int result = order(inputs, session, sequence);
  if (result < 0) return result;
  inputs->sequence = sequence;
  return distance == 0 ? PP_IGNORED : PP_MOVEMENT;
}

double pp_pattern_value(int pattern, double elapsed, double period, double low, double high, double fraction) {
  if (!std::isfinite(elapsed) || !level(low) || !level(high) || low > high) return -1;
  if (pattern == PP_OFF) return 0;
  if (pattern == PP_SOLID) return high;
  if ((pattern != PP_PULSE && pattern != PP_BLINK) || !std::isfinite(period) || period <= 0 ||
      !std::isfinite(fraction) || fraction <= 0 || fraction >= 1) return -1;
  double phase = std::fmod(elapsed, period) / period;
  if (phase < 0) phase += 1;
  if (pattern == PP_BLINK) return phase < fraction ? high : low;
  double amount = phase < fraction ? phase / fraction : (1 - phase) / (1 - fraction);
  return low + (high - low) * amount;
}

double pp_trigger_value(double elapsed, double attack, double hold, double decay, double peak, double baseline) {
  if (!std::isfinite(elapsed) || !std::isfinite(attack) || attack < 0 || !std::isfinite(hold) || hold < 0 ||
      !std::isfinite(decay) || decay < 0 || !level(peak) || !level(baseline)) return -1;
  double end = attack + hold + decay;
  if (!std::isfinite(end) || end == 0) return -1;
  if (elapsed < 0 || elapsed >= end) return baseline;
  if (elapsed < attack) return peak * elapsed / attack;
  if (elapsed < attack + hold) return peak;
  return decay > 0 ? peak * (end - elapsed) / decay : baseline;
}

int pp_ipac_led_report(uint32_t channel, uint32_t level, uint8_t* out) {
  if (!out || channel >= 96 || level > 255) return PP_INVALID;
  out[0] = 3;
  out[1] = uint8_t(channel);
  out[2] = uint8_t(level);
  out[3] = out[4] = 0;
  return 5;
}

int pp_ipac_led_descriptor(const uint8_t* bytes, uint32_t length) {
  if (!bytes || length == 0 || length > 4096) return PP_INVALID;
  struct Globals { uint32_t size = 0, count = 0, id = 0; } globals, stack[8];
  unsigned depth = 0, collections = 0;
  uint32_t output_bits = 0;
  for (uint32_t cursor = 0; cursor < length;) {
    uint8_t prefix = bytes[cursor++];
    if (prefix == 0xfe) return PP_INVALID;
    unsigned size = prefix & 3;
    if (size == 3) size = 4;
    if (size > length - cursor) return PP_INVALID;
    uint32_t value = 0;
    for (unsigned index = 0; index < size; ++index) value |= uint32_t(bytes[cursor++]) << (index * 8);
    unsigned type = (prefix >> 2) & 3, tag = prefix >> 4;
    if (type == 1) {
      if (tag == 7) globals.size = value;
      if (tag == 8) { if (size != 1 || value == 0) return PP_INVALID; globals.id = value; }
      if (tag == 9) globals.count = value;
      if (tag == 10) { if (depth == 8 || size != 0) return PP_INVALID; stack[depth++] = globals; }
      if (tag == 11) { if (!depth || size != 0) return PP_INVALID; globals = stack[--depth]; }
    }
    if (type == 0 && tag == 10) { if (size != 1) return PP_INVALID; ++collections; }
    if (type == 0 && tag == 12) { if (!collections || size != 0) return PP_INVALID; --collections; }
    if (type == 0 && (tag == 8 || tag == 9 || tag == 11) && size == 0) return PP_INVALID;
    if (type == 0 && tag == 9 && globals.id == 3) {
      if (value & 1) return 0;
      if (!collections || !globals.size || !globals.count) return PP_INVALID;
      uint64_t bits = uint64_t(globals.size) * globals.count;
      if (bits > 32 || bits + output_bits > 32) return 0;
      output_bits += uint32_t(bits);
    }
  }
  if (depth || collections) return PP_INVALID;
  return output_bits == 32 ? 1 : 0;
}
