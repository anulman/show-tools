#ifndef BEAT_TRACKER_H
#define BEAT_TRACKER_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct bt_tracker bt_tracker;

enum bt_mode { BT_FOLLOW = 0, BT_MANUAL = 1 };
enum bt_status { BT_LISTENING = 0, BT_FOLLOWING = 1, BT_COASTING = 2 };
enum bt_command_type {
    BT_SEED = 1, BT_APPLY_BPM = 2, BT_TAP = 3, BT_SELECT_FOLLOW = 4,
    BT_SELECT_MANUAL = 5, BT_RESET = 6, BT_FRESH_AUDIO = 7
};
enum bt_result {
    BT_OK = 0, BT_INVALID = 1, BT_DUPLICATE = 2, BT_OLD_EPOCH = 3,
    BT_QUEUE_FULL = 4, BT_ALREADY_STARTED = 5, BT_OUT_OF_ORDER = 6,
    BT_ALLOCATION_FAILED = 7
};
enum bt_event_type { BT_CLOCK = 1, BT_DETECTION = 2, BT_ACCEPTED = 3, BT_COMMAND_ACK = 4 };
enum bt_rejection {
    BT_ACCEPT = 0, BT_MANUAL_OWNER = 1, BT_STALE = 2, BT_QUIET = 3,
    BT_UNSTABLE = 4, BT_BAD_OBSERVATION = 5
};

/* Snapshot and event records are arrays of doubles for a stable C/WASM ABI.
   Frames use the engine sample clock, which starts at zero. Times can be fractional.
   One tracker has one owner. Functions are not thread safe. */
enum bt_snapshot_index {
    BT_S_FRAME, BT_S_EPOCH, BT_S_REVISION, BT_S_MODE, BT_S_STATUS,
    BT_S_STARTED, BT_S_BPM, BT_S_PHASE, BT_S_NEXT_BEAT_FRAME, BT_S_BEAT_ID,
    BT_S_RAW_BPM, BT_S_CONFIDENCE, BT_S_TARGET_BPM, BT_S_PHASE_ERROR_SECONDS,
    BT_S_RMS, BT_S_PEAK, BT_S_OBSERVATION_AGE_SECONDS, BT_S_DROPPED_EVENTS,
    BT_S_LAST_DETECTED_FRAME, BT_S_ACCEPTED_COUNT, BT_S_SAMPLE_RATE,
    BT_S_REJECTION, BT_S_COUNT
};
enum bt_event_index {
    BT_E_TYPE, BT_E_ID, BT_E_FRAME, BT_E_AVAILABLE_FRAME, BT_E_EPOCH,
    BT_E_REVISION, BT_E_BPM, BT_E_CONFIDENCE, BT_E_PHASE_ERROR_SECONDS,
    BT_E_RESULT, BT_E_COMMAND_TYPE, BT_E_SEQUENCE, BT_E_COUNT
};

bt_tracker* bt_create(double sample_rate);
void bt_destroy(bt_tracker* tracker);
/* No input means silence. Arbitrary block sizes are supported. No allocation occurs here. */
void bt_process(bt_tracker* tracker, const float* mono, uint32_t frames);
/* Sequences must increase. Future commands apply at event_frame, including inside
   process blocks. Late taps retain their event timestamp and project forward.
   Only tap timestamps may precede frame zero, preserving taps during startup.
   Reset and Fresh audio are immediate-only lifecycle calls: event_frame must be at
   or before the current frame. They replace the analyzer and may allocate/free;
   call them outside the processing callback. Allocation failure leaves state intact.
   Reset preserves Manual and increments the timeline epoch. It clears old events,
   then emits terminal BT_OLD_EPOCH ACKs for all cancelled queued commands, tagged
   with the new epoch, followed by its own ACK. Fresh audio preserves mode and clock.
   Completed retries replay the original ACK (including its epoch, time, and result)
   from a bounded cache of the 64 most recent completions without reapplying.
   BT_DUPLICATE means a sequence is still queued; its terminal ACK remains pending.
   Seed applies only before the clock starts. */
int bt_command(bt_tracker* tracker, int type, double value, double event_frame,
               double sequence, double epoch);
void bt_snapshot(const bt_tracker* tracker, double* out);
/* Returns record count. On overflow oldest events are dropped and counted. */
uint32_t bt_drain_events(bt_tracker* tracker, double* out, uint32_t capacity);
/* Diagnostic injection traverses the same follower as aubio. available_frame must
   equal the current engine frame; beat_frame is its historical estimate. */
int bt_observe(bt_tracker* tracker, double beat_frame, double available_frame,
               double bpm, double confidence, double level);

#ifdef __cplusplus
}
#endif
#endif
