#pragma once

namespace beat {
struct Clock {
    double sample_rate;
    double bpm = 0;
    double phase = 0;
    double frequency_offset = 0;
    unsigned long long serial = 0;
    bool running() const { return bpm > 0; }
    void start(double tempo, double anchor, double now);
    double step();
    void follow(double target);
};
}
