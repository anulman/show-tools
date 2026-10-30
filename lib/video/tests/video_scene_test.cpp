#include "video_scene.h"
#include <cassert>
#include <cmath>
#include <initializer_list>
int main() {
  const double keys[] = {0, 1, 0, 0, .25, 1, 0, 1, .5, 1, 2, 1, .75, 1, 3, 1};
  double output[3] = {-1, -1, -1};
  assert(vs_validate(keys, 4));
  for (double at : {.74999, .5, .49999, .75, 0.0}) {
    assert(vs_sample(keys, 4, at, output));
    assert(output[1] == (at < .5 ? 0 : at < .75 ? 2 : 3));
  }
  assert(!vs_sample(keys, 4, NAN, output));
  assert(output[1] == 0);
  const double bad[] = {0, 1, 0, 0, 0, 1, 2, 0};
  assert(!vs_validate(bad, 2));
  assert(!vs_validate(nullptr, 1));
}
