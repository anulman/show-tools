#ifndef SHOW_TOOLS_VIDEO_POSE_H
#define SHOW_TOOLS_VIDEO_POSE_H

#ifdef __cplusplus
extern "C" {
#endif

/* Position is continuous quarter notes supplied by the caller. Models 0..3 are
   Gator treatments; models 4..7 are Tapir treatments. The loop spans 8 quarters.
   Invalid models or nonfinite positions return the neutral pose and offsets.
   Offsets are fractions of the rendered figure's height. The renderer anchors
   the feet and applies them to upper-body vertices, not the entire figure. */
int vp_pose(double quarter, int model);
double vp_sway(double quarter, int model);
double vp_breath(double quarter, int model);

#ifdef __cplusplus
}
#endif
#endif
