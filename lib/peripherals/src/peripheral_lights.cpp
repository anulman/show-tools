#include "peripheral_lights.h"
#include <cmath>

namespace {
bool unit(double value) { return std::isfinite(value) && value >= 0 && value <= 1; }
bool peak(int strength, const pp_light_levels* levels, double& out) {
  if (!levels || !unit(levels->low) || !unit(levels->mid) || !unit(levels->max) ||
      levels->low > levels->mid || levels->mid > levels->max) return false;
  switch (strength) {
    case PP_LIGHT_LOW: out = levels->low; return true;
    case PP_LIGHT_MID: out = levels->mid; return true;
    case PP_LIGHT_MAX: out = levels->max; return true;
    default: return false;
  }
}
bool timing(double origin, double period) { return std::isfinite(origin) && std::isfinite(period) && period > 0; }
}

int pp_light_off(uint32_t id, pp_light_recipe* out) {
  if (!out) return PP_INVALID;
  *out = {id, PP_LIGHT_OFF, 0, 0, 0, 0};
  return 0;
}
int pp_light_on(uint32_t id, int strength, const pp_light_levels* levels, pp_light_recipe* out) {
  double level;
  if (!out || !peak(strength, levels, level)) return PP_INVALID;
  *out = {id, PP_LIGHT_ON, level, 0, 0, 0};
  return 0;
}
int pp_light_pulse(uint32_t id, int strength, const pp_light_levels* levels,
    double origin, double period, pp_light_recipe* out) {
  double level;
  if (!out || !peak(strength, levels, level) || !timing(origin, period)) return PP_INVALID;
  *out = {id, PP_LIGHT_PULSE, level, origin, period, 0};
  return 0;
}
int pp_light_blink(uint32_t id, int strength, const pp_light_levels* levels,
    double origin, double period, double duty, pp_light_recipe* out) {
  double level;
  if (!out || !peak(strength, levels, level) || !timing(origin, period) || !std::isfinite(duty) || duty <= 0 || duty >= 1)
    return PP_INVALID;
  *out = {id, PP_LIGHT_BLINK, level, origin, period, duty};
  return 0;
}
int pp_light_evaluate(const pp_light_recipe* recipe, double position, pp_light_sample* out) {
  if (!recipe || !out || !std::isfinite(position) || !unit(recipe->level)) return PP_INVALID;
  double level;
  switch (recipe->kind) {
    case PP_LIGHT_OFF: level = 0; break;
    case PP_LIGHT_ON: level = recipe->level; break;
    case PP_LIGHT_PULSE:
    case PP_LIGHT_BLINK: {
      if (!timing(recipe->origin_beat, recipe->period_beats)) return PP_INVALID;
      const double elapsed = position - recipe->origin_beat;
      if (!std::isfinite(elapsed)) return PP_INVALID;
      double phase = std::fmod(elapsed, recipe->period_beats) / recipe->period_beats;
      if (phase < 0) phase += 1;
      if (recipe->kind == PP_LIGHT_PULSE) {
        constexpr double tau = 6.2831853071795864769;
        level = recipe->level * (1 + std::cos(tau * phase)) / 2;
      } else {
        if (!std::isfinite(recipe->duty) || recipe->duty <= 0 || recipe->duty >= 1) return PP_INVALID;
        level = phase < recipe->duty ? recipe->level : 0;
      }
      break;
    }
    default: return PP_INVALID;
  }
  *out = {recipe->led_id, level};
  return 0;
}
