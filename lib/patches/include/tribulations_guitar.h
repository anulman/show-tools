#ifndef SHOW_TOOLS_TRIBULATIONS_GUITAR_H
#define SHOW_TOOLS_TRIBULATIONS_GUITAR_H
#include "patch_engine.h"

namespace patches {
// Fixed operator-approved Legato fuzz; averages stereo source and emits centered mono.
std::unique_ptr<Effect> make_tribulations_guitar(double sample_rate) noexcept;
}
#endif
