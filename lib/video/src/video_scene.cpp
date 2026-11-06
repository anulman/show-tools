#include "video_scene.h"
#include <cmath>

int vs_validate(const double* keys, int count) {
  if (!keys || count <= 0 || keys[0] != 0) return 0;
  for (int i = 0; i < count; ++i) {
    const double* row = keys + i * 4;
    for (int field = 0; field < 4; ++field) if (!std::isfinite(row[field])) return 0;
    if (row[0] < 0 || (i > 0 && row[0] <= row[-4])) return 0;
    if (row[1] < 0 || row[2] < 0 || std::floor(row[1]) != row[1] || std::floor(row[2]) != row[2]) return 0;
    if (row[3] != 0 && row[3] != 1) return 0;
  }
  return 1;
}

int vs_sample(const double* keys, int count, double position, double* output) {
  if (!keys || count <= 0 || !output || !std::isfinite(position)) return 0;
  int low = 0, high = count;
  while (low + 1 < high) {
    const int middle = low + (high - low) / 2;
    if (keys[middle * 4] <= position) low = middle; else high = middle;
  }
  for (int field = 0; field < 3; ++field) output[field] = keys[low * 4 + field + 1];
  return 1;
}
