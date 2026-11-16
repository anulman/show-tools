#ifndef SHOW_TOOLS_PERFORMANCE_LIGHT_OUTPUT_H
#define SHOW_TOOLS_PERFORMANCE_LIGHT_OUTPUT_H

/* Complete binary64 image: fourteen header fields and up to 32 (ID, level)
   pairs. Unused pairs are zero; absent IDs are off in the consumer's owned map.
   Sequence is an exact positive integer across runs in one engine incarnation.
   2^53-1 is reserved for terminal all-off output with no pending activation;
   it cannot be followed by further activation in that incarnation. */
enum pf_light_pattern { PF_LIGHT_OFF = 0, PF_LIGHT_ON = 1, PF_LIGHT_PULSE = 2, PF_LIGHT_BLINK = 3 };
enum pf_light_launch { PF_LIGHT_IMMEDIATE = 0, PF_LIGHT_GRID = 1 };
enum pf_light_limits { PF_LIGHT_VERSION = 1, PF_LIGHT_CAPACITY = 32 };
enum pf_light_row_field { PF_LIGHT_ID, PF_LIGHT_PATTERN, PF_LIGHT_PEAK, PF_LIGHT_PERIOD, PF_LIGHT_DUTY, PF_LIGHT_ROW_FIELDS };
enum pf_light_publication_field {
  PF_LIGHT_FORMAT, PF_LIGHT_GENERATION, PF_LIGHT_RUN, PF_LIGHT_EPOCH,
  PF_LIGHT_TIMELINE, PF_LIGHT_SEQUENCE, PF_LIGHT_FRAME, PF_LIGHT_RATE,
  PF_LIGHT_COUNT_BEAT, PF_LIGHT_RUNNING, PF_LIGHT_PENDING, PF_LIGHT_PENDING_BEAT,
  PF_LIGHT_ORIGIN_BEAT, PF_LIGHT_COUNT, PF_LIGHT_SAMPLES, PF_LIGHT_FIELDS = 78
};
enum pf_light_identity { PF_LIGHT_PHYSICAL_BASELINE_BASE = 513 };
enum pf_light_sample_field { PF_LIGHT_SAMPLE_ID, PF_LIGHT_SAMPLE_LEVEL, PF_LIGHT_SAMPLE_FIELDS };

#endif
