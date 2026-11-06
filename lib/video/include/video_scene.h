#ifndef SHOW_TOOLS_VIDEO_SCENE_H
#define SHOW_TOOLS_VIDEO_SCENE_H
#ifdef __cplusplus
extern "C" {
#endif
/* Immutable rows of four doubles: counted position, clip index, pose index,
   grayscale (0/1). Positions strictly increase, starting at zero. */
int vs_validate(const double* keys, int count);
/* Caller supplies output storage for clip, pose, grayscale. Invalid arguments
   return zero without changing output. Finite negative positions hold first key. */
int vs_sample(const double* keys, int count, double counted_position, double* output);
#ifdef __cplusplus
}
#endif
#endif
