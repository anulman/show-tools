#ifndef SHOW_TOOLS_PERIPHERAL_LIGHTS_H
#define SHOW_TOOLS_PERIPHERAL_LIGHTS_H
#include "peripheral_controls.h"
#ifdef __cplusplus
extern "C" {
#endif

enum pp_light_strength { PP_LIGHT_LOW = 0, PP_LIGHT_MID = 1, PP_LIGHT_MAX = 2 };
enum pp_light_kind { PP_LIGHT_OFF = 0, PP_LIGHT_ON = 1, PP_LIGHT_PULSE = 2, PP_LIGHT_BLINK = 3 };
typedef struct pp_light_levels { double low, mid, max; } pp_light_levels;
typedef struct pp_light_recipe {
  uint32_t led_id;
  int kind;
  double level, origin_beat, period_beats, duty;
} pp_light_recipe;
typedef struct pp_light_sample { uint32_t led_id; double level; } pp_light_sample;

/* IDs are opaque logical identities, not SDK indices. Levels must satisfy
   0 <= low <= mid <= max <= 1. No brightness or musical timing defaults exist.
   Constructors return 0 or PP_INVALID, leaving output unchanged on failure. */
int pp_light_off(uint32_t led_id, pp_light_recipe* out);
int pp_light_on(uint32_t led_id, int strength, const pp_light_levels* levels, pp_light_recipe* out);
/* Origin and position use PE's authoritative count-beat coordinate.
   Period is finite and positive; fractional beats are supported. Constructors
   never quantize or rephase. PE exclusively owns musical activation, keyframes,
   phase and tempo changes. Hosts sample/deliver PE-authored output.
   Pulse is cosine-smoothed from peak at origin to
   zero at half-period and back to peak. Blink starts on at origin and turns off
   at duty * period; duty must be strictly between 0 and 1. */
int pp_light_pulse(uint32_t led_id, int strength, const pp_light_levels* levels,
  double origin_beat, double period_beats, pp_light_recipe* out);
int pp_light_blink(uint32_t led_id, int strength, const pp_light_levels* levels,
  double origin_beat, double period_beats, double duty, pp_light_recipe* out);
/* Pure sampling: no timers, state mutation, device access, or allocation.
   Pre-origin sampling wraps periodically, as pp_pattern_value does. Duplicate
   samples cannot restart a recipe. Position must be finite. For periodic
   recipes the elapsed difference must also be finite. Returns 0 or PP_INVALID; failure leaves output unchanged. Caller
   gates recipes by run, clock epoch, device session, and binding revision. */
int pp_light_evaluate(const pp_light_recipe* recipe, double position_beat, pp_light_sample* out);
#ifdef __cplusplus
}
#endif
#endif
