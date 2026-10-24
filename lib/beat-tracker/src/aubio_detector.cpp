#include "aubio_detector.h"
#include <cmath>
#include <cstdint>
#include <utility>

namespace beat {
Detector::Detector(unsigned rate) : decay_(std::exp(-1.0 / (0.2 * rate))) {
    tempo_ = new_aubio_tempo("default", 2048, 512, rate);
    input_ = new_fvec(512);
    output_ = new_fvec(1);
}
Detector::~Detector() {
    if (tempo_) del_aubio_tempo(tempo_);
    if (input_) del_fvec(input_);
    if (output_) del_fvec(output_);
}
bool Detector::restart(unsigned rate, unsigned long long origin) {
    Detector replacement(rate);
    if (!replacement.ready()) return false;
    std::swap(tempo_, replacement.tempo_);
    std::swap(input_, replacement.input_);
    std::swap(output_, replacement.output_);
    cursor_ = 0;
    energy_ = 0;
    origin_ = origin;
    return true;
}
bool Detector::push(float sample, unsigned long long frame, Detection& result) {
    energy_ = decay_ * energy_ + (1 - decay_) * sample * sample;
    input_->data[cursor_++] = sample;
    if (cursor_ != 512) return false;
    cursor_ = 0;
    aubio_tempo_do(tempo_, input_, output_);
    if (output_->data[0] == 0) return false;
    const uint64_t raw = aubio_tempo_get_last(tempo_);
    const uint64_t local_frame = frame - origin_;
    uint64_t estimated = (local_frame & ~uint64_t(UINT32_MAX)) | raw;
    if (estimated > local_frame && estimated >= (uint64_t(1) << 32)) estimated -= uint64_t(1) << 32;
    result = {double(origin_ + estimated), aubio_tempo_get_bpm(tempo_),
              aubio_tempo_get_confidence(tempo_), std::sqrt(energy_)};
    return true;
}
}
