#ifndef SHOW_TOOLS_PERIPHERAL_CONTROLS_H
#define SHOW_TOOLS_PERIPHERAL_CONTROLS_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef struct pp_inputs pp_inputs;
enum pp_result { PP_INVALID = -1, PP_STALE = -2, PP_IGNORED = 0, PP_PRESS = 1, PP_RELEASE = 2, PP_MOVEMENT = 3 };
enum pp_pattern { PP_OFF = 0, PP_SOLID = 1, PP_PULSE = 2, PP_BLINK = 3 };
enum pp_limits { PP_ABI_VERSION = 1, PP_SWITCH_SLOTS = 32, PP_LED_REPORT_BYTES = 5 };

uint32_t pp_abi_version(void);
pp_inputs* pp_create(void);
void pp_destroy(pp_inputs* inputs);
/* Masks identify known released and initially held slots. Other slots remain
   unknown until released. Session IDs must increase on reconnect and stay at or
   below 2^53-1; recreate before exhaustion. Valid ignored observations consume
   sequence, invalid observations do not. Initial held/unknown release rearms
   without emitting RELEASE. This latch does not implement mechanical debounce. */
int pp_begin(pp_inputs* inputs, double session, uint32_t released, uint32_t held);
int pp_key(pp_inputs* inputs, double session, double sequence, uint32_t slot, int down);
/* Signed distance stays caller-owned, with its raw units and binding revision.
   This call validates and orders observations; it never accumulates motion. */
int pp_rotate(pp_inputs* inputs, double session, double sequence, double distance);

/* Position and period use the same caller-supplied frame or continuous-beat
   coordinate. These functions neither advance nor extrapolate musical time.
   Invalid inputs return -1. Negative pattern elapsed wraps periodically; negative
   trigger elapsed returns the current baseline. Trigger timing shares one unit.
   Trigger replaces baseline while active, including zero-based attack/decay;
   this math shape is not an approved production overlap/blending policy.
   Pattern choices and timing have no defaults. */
double pp_pattern_value(int pattern, double elapsed, double period, double low, double high, double fraction);
double pp_trigger_value(double elapsed, double attack, double hold, double decay, double peak, double current_baseline);

/* This is the SDK's zero-based channel index, not a PCB terminal label.
   Caller supplies PP_LED_REPORT_BYTES writable bytes. No USB write occurs. See licenses/PacDriveSDK.txt for protocol provenance. */
int pp_ipac_led_report(uint32_t channel, uint32_t level, uint8_t* out);
/* Require a well-formed observed descriptor with a 32-bit Output report 3.
   Returns 1 for supported shape, 0 for another shape, -1 for malformed data. */
int pp_ipac_led_descriptor(const uint8_t* bytes, uint32_t length);
#ifdef __cplusplus
}
#endif
#endif
