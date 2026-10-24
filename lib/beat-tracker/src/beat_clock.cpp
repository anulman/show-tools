#include "beat_clock.h"
#include <algorithm>
#include <cmath>

namespace beat {
void Clock::start(double tempo, double anchor, double now) {
    bpm = tempo;
    phase = std::fmod(std::max(0.0, now - anchor) * bpm / (60 * sample_rate), 1.0);
    frequency_offset = 0;
}

double Clock::step() {
    if (!running()) return -1;
    const double previous = phase;
    const double increment = bpm / (60 * sample_rate) * (1 + frequency_offset);
    phase += increment;
    if (phase < 1) return -1;
    phase -= 1;
    ++serial;
    return (1 - previous) / increment;
}

void Clock::follow(double target) {
    const double maximum = bpm * 0.02;
    bpm += std::clamp(target - bpm, -maximum, maximum);
}
}
