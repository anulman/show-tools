#include "video_pose.h"
#include <cassert>
#include <cmath>
#include <cstdio>
#include <initializer_list>
#include <limits>

int main() {
  const double quarters[] = {0.0, 1.999, 2.0, 4.999, 5.0, 5.999, 6.0, 6.999, 7.0, 7.999, 8.0};
  const int expected[] = {0, 0, 1, 1, 2, 2, 1, 1, 0, 0, 0};
  for (int model = 0; model < 8; ++model) {
    for (unsigned i = 0; i < sizeof(quarters) / sizeof(quarters[0]); ++i) {
      assert(vp_pose(quarters[i], model) == expected[i]);
      assert(vp_pose(quarters[i] + 8000.0, model) == expected[i]);
      assert(vp_pose(quarters[i] - 8000.0, model) == expected[i]);
    }
    for (int sample = -8192; sample <= 8192; ++sample) {
      const double quarter = sample / 256.0;
      const double sway = vp_sway(quarter, model);
      const double breath = vp_breath(quarter, model);
      assert(std::isfinite(sway) && std::abs(sway) <= 0.0100000001);
      assert(std::isfinite(breath) && breath >= 0.0 && breath <= 0.0080000001);
      assert(std::abs(sway - vp_sway(quarter + 8.0, model)) < 1e-12);
      assert(std::abs(breath - vp_breath(quarter + 8.0, model)) < 1e-12);
    }
    const double at_three = vp_sway(3.0, model);
    const double breath_at_three = vp_breath(3.0, model);
    vp_pose(7.2, model);
    vp_sway(-10000.0, model);
    vp_breath(0.0, model);
    assert(vp_pose(3.0, model) == 1);
    assert(vp_sway(3.0, model) == at_three);
    assert(vp_breath(3.0, model) == breath_at_three);
  }
  for (const double invalid : {std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN()}) {
    assert(vp_pose(invalid, 0) == 0);
    assert(vp_sway(invalid, 0) == 0.0);
    assert(vp_breath(invalid, 0) == 0.0);
  }
  for (const int model : {-1, 8, 1000}) {
    assert(vp_pose(5.0, model) == 0);
    assert(vp_sway(2.0, model) == 0.0);
    assert(vp_breath(1.0, model) == 0.0);
  }
  std::puts("Video pose native checks passed.");
}
