#pragma once
#include <aubio/aubio.h>

namespace beat {
struct Detection { double frame; double bpm; double confidence; double level; };
class Detector {
public:
    explicit Detector(unsigned rate);
    ~Detector();
    Detector(const Detector&) = delete;
    Detector& operator=(const Detector&) = delete;
    bool ready() const { return tempo_ && input_ && output_; }
    // Allocates a replacement before releasing the old analyzer. Call outside processing.
    bool restart(unsigned rate, unsigned long long origin);
    bool push(float sample, unsigned long long frame, Detection& result);
private:
    aubio_tempo_t* tempo_ = nullptr;
    fvec_t* input_ = nullptr;
    fvec_t* output_ = nullptr;
    unsigned long long origin_ = 0;
    unsigned cursor_ = 0;
    double energy_ = 0;
    double decay_;
};
}
