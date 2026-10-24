#pragma once

namespace beat {
struct Detection { double frame; double bpm; double confidence; double level; };

class Detector {
public:
    explicit Detector(unsigned) {}
    bool ready() const { return true; }
    bool restart(unsigned, unsigned long long) { return true; }
    bool push(float, unsigned long long, Detection&) { return false; }
};
}
