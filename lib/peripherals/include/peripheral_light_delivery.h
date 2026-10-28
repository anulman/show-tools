#ifndef SHOW_TOOLS_PERIPHERAL_LIGHT_DELIVERY_H
#define SHOW_TOOLS_PERIPHERAL_LIGHT_DELIVERY_H
#include "peripheral_controls.h"
#ifdef __cplusplus
extern "C" {
#endif

typedef struct pp_light_delivery pp_light_delivery;
enum pp_light_delivery_limits { PP_LIGHT_OUTPUT_CAPACITY = 96 };
typedef struct pp_light_binding { uint32_t led_id, sdk_channel; } pp_light_binding;
typedef struct pp_light_connection {
  double engine_incarnation, device_session, binding_revision, request_fence;
} pp_light_connection;
typedef struct pp_light_delivery_frame {
  pp_light_connection connection;
  double publication;
  uint32_t count;
  uint8_t reports[PP_LIGHT_OUTPUT_CAPACITY][PP_LED_REPORT_BYTES];
} pp_light_delivery_frame;

/* Allocate outside audio processing. One owner serializes bind, prepare,
   device delivery and commit. These routines never open or write a device. */
pp_light_delivery* pp_light_delivery_create(void);
void pp_light_delivery_destroy(pp_light_delivery* delivery);
/* All connection fields are exact positive integers <= 2^53-1. Request fences
   strictly increase across binds. Capture the fence when requesting a fresh
   PE snapshot; never retag a cached/queued image with a newer fence. Binding
   invalidates pending frames and device-delivery freshness. The latest seen
   publication and its immutable contents remain fenced across same-engine
   reconnects. New engines require a never-reused incarnation identity.
   Mappings must have
   unique logical IDs and unique SDK channels 0..95. The caller clears outputs
   removed from its ownership before changing mappings. Invalid input leaves
   state unchanged. Returns 0 or PP_INVALID. */
int pp_light_delivery_bind(pp_light_delivery* delivery, const pp_light_connection* connection,
  const pp_light_binding* bindings, uint32_t count);
/* Validate a complete PE publication and prepare one brightness report for
   each owned mapping. Absent logical IDs produce zero brightness. There are
   no enable-mask writes. Unsupported/malformed input returns PP_INVALID;
   wrong fences or nonnewer committed publications return PP_STALE. Success
   returns 1. Failure leaves state and output unchanged. Identical pending
   images may be prepared again for retry; conflicting equal-sequence images
   are invalid. A newer image replaces any pending frame. */
int pp_light_delivery_prepare(pp_light_delivery* delivery, const pp_light_connection* requested,
  const double* publication, uint32_t fields, pp_light_delivery_frame* out);
/* Call only after every prepared report was delivered successfully. Commit
   rejects a superseded, modified, or already committed frame. Failed device
   delivery must not commit; retry the identical image or fetch a newer full
   image. Disconnect/reconnect requires an explicit bind and fresh request.
   Returns 1, PP_STALE, or PP_INVALID. */
int pp_light_delivery_commit(pp_light_delivery* delivery, const pp_light_delivery_frame* delivered);
#ifdef __cplusplus
}
#endif
#endif
