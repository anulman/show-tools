#include "tempo_follower.h"
#include <algorithm>
#include <cmath>

namespace beat {
void Follower::clear(double prior) {
    candidate = 0;
    reference = prior;
    last_frame = -1;
    confidence_peak = 0;
    target = 0;
    timing_count = timing_cursor = 0;
    support = 0;
}
bool Follower::observe(double bpm, double frame, double confidence, double sample_rate) {
    if (reference > 0) {
        // Preserve an established metrical level only near exact octave aliases.
        // A 120-to-180 change therefore remains an increase toward 180.
        const double ratio = bpm / reference;
        if (ratio > 1.84 && ratio < 2.16) bpm *= 0.5;
        else if (ratio > 0.46 && ratio < 0.54) bpm *= 2;
    }
    confidence_peak = std::max(confidence, confidence_peak * 0.98);
    if (confidence_peak > 0.05 && confidence < confidence_peak * 0.1) return false;
    bool consistent = candidate > 0 && std::abs(std::log(bpm / candidate)) < 0.055;
    double elapsed = 0;
    double elapsed_beats = 0;
    if (consistent && last_frame >= 0) {
        elapsed = (frame - last_frame) / sample_rate;
        const double beats = elapsed * (bpm + candidate) / 120;
        elapsed_beats = std::round(beats);
        consistent = beats > 0.45 && std::abs(beats - elapsed_beats) < 0.22;
    }
    if (!consistent) {
        candidate = bpm;
        support = 1;
        timing_count = timing_cursor = 0;
    } else {
        candidate += 0.65 * (bpm - candidate);
        ++support;
        const unsigned slot = timing_cursor++ % timing_seconds.size();
        timing_seconds[slot] = elapsed;
        timing_beats[slot] = elapsed_beats;
        timing_count = std::min(timing_count + 1, unsigned(timing_seconds.size()));
    }
    last_frame = frame;
    if (support < 4) return false;
    reference = candidate;
    double beats = 0, seconds = 0;
    for (unsigned i = 0; i < timing_count; ++i) {
        beats += timing_beats[i];
        seconds += timing_seconds[i];
    }
    target = seconds > 0 ? 60 * beats / seconds : candidate;
    return true;
}
}
