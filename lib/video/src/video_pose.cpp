#include "video_pose.h"
#include <cmath>

namespace {
constexpr double tau = 6.283185307179586476925286766559;

bool valid(double quarter, int model) {
  return std::isfinite(quarter) && model >= 0 && model < 8;
}

double loop_position(double quarter) {
  double position = std::fmod(quarter, 8.0);
  return position < 0.0 ? position + 8.0 : position;
}
}

int vp_pose(double quarter, int model) {
  if (!valid(quarter, model)) return 0;
  const double position = loop_position(quarter);
  if (position < 2.0) return 0;
  if (position < 5.0) return 1;
  if (position < 6.0) return 2;
  if (position < 7.0) return 1;
  return 0;
}

double vp_sway(double quarter, int model) {
  if (!valid(quarter, model)) return 0.0;
  const double amplitude = model < 4 ? 0.010 : 0.006;
  return amplitude * std::sin(loop_position(quarter) * tau / 8.0);
}

double vp_breath(double quarter, int model) {
  if (!valid(quarter, model)) return 0.0;
  const double amplitude = model < 4 ? 0.006 : 0.008;
  const double wave = std::sin(loop_position(quarter) * tau / 4.0);
  return amplitude * wave * wave;
}
