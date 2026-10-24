#pragma once
#include <array>

namespace beat {
struct Follower {
    double candidate = 0;
    double reference = 0;
    double last_frame = -1;
    double confidence_peak = 0;
    double target = 0;
    std::array<double, 6> timing_beats{};
    std::array<double, 6> timing_seconds{};
    unsigned timing_count = 0;
    unsigned timing_cursor = 0;
    unsigned support = 0;
    void clear(double prior);
    bool observe(double bpm, double frame, double confidence, double sample_rate);
};
}
