#include "beat_tracker_internal.h"
#include <new>

namespace {
bool valid_bpm(double value) { return std::isfinite(value) && value >= min_bpm && value <= max_bpm; }
}

extern "C" {
bt_tracker* bt_create(double sample_rate) {
    if (!std::isfinite(sample_rate) || sample_rate < 8000 || sample_rate > 192000 || std::floor(sample_rate) != sample_rate) return nullptr;
    auto* tracker = new (std::nothrow) bt_tracker(sample_rate);
    if (tracker && !tracker->detector.ready()) { delete tracker; return nullptr; }
    return tracker;
}
void bt_destroy(bt_tracker* tracker) { delete tracker; }

int bt_command(bt_tracker* t, int type, double value, double event_frame, double sequence, double epoch) {
    auto reject = [&](int result) {
        if (t) t->emit(BT_COMMAND_ACK, double(t->frame), t->clock.bpm, 0, result, type, sequence);
        return result;
    };
    if (!t || !std::isfinite(event_frame) || (event_frame < 0 && type != BT_TAP) || !std::isfinite(sequence)
        || sequence < 1 || sequence > 9007199254740991.0 || std::floor(sequence) != sequence
        || std::abs(event_frame) > 9007199254740991.0 || !std::isfinite(value)
        || type < BT_SEED || type > BT_FRESH_AUDIO
        || ((type == BT_SEED || type == BT_APPLY_BPM) && !valid_bpm(value))) return reject(BT_INVALID);
    for (const auto& ack : t->acknowledgments) {
        if (ack.sequence == sequence) {
            t->enqueue(ack.event);
            return int(ack.event[BT_E_RESULT]);
        }
    }
    if (epoch != t->epoch) return reject(BT_OLD_EPOCH);
    if (sequence <= t->last_sequence) {
        for (unsigned i = 0; i < t->command_count; ++i)
            if (t->commands[i].sequence == sequence) return reject(BT_DUPLICATE);
        return reject(BT_OUT_OF_ORDER);
    }
    const bool lifecycle = type == BT_RESET || type == BT_FRESH_AUDIO;
    if (lifecycle && event_frame > double(t->frame)) return reject(BT_INVALID);
    if (!lifecycle && t->command_count == command_capacity) return reject(BT_QUEUE_FULL);
    if (lifecycle && !t->detector.restart(unsigned(t->clock.sample_rate), t->frame))
        return reject(BT_ALLOCATION_FAILED);
    t->last_sequence = sequence;
    Command command{type, value, event_frame, sequence};
    if (event_frame <= double(t->frame)) return t->apply(command);
    auto end = t->commands.begin() + t->command_count++;
    auto position = std::upper_bound(t->commands.begin(), end, command,
        [](const Command& a, const Command& b) { return a.frame < b.frame; });
    std::move_backward(position, end, end + 1);
    *position = command;
    return BT_OK;
}

void bt_process(bt_tracker* t, const float* mono, uint32_t frames) {
    if (!t) return;
    const double decay = std::exp(-1.0 / (0.05 * t->clock.sample_rate));
    for (uint32_t index = 0; index < frames; ++index) {
        while (t->command_count && t->commands[0].frame <= double(t->frame)) {
            const Command command = t->commands[0];
            --t->command_count;
            std::move(t->commands.begin() + 1, t->commands.begin() + t->command_count + 1, t->commands.begin());
            t->apply(command);
        }
        const double sample = mono && std::isfinite(mono[index]) ? std::clamp(double(mono[index]), -1.0, 1.0) : 0;
        t->level_squared = decay * t->level_squared + (1 - decay) * sample * sample;
        t->peak = std::max(std::abs(sample), t->peak * decay);
        t->history[t->frame % history_capacity] = t->clock.running() ? t->clock.phase : -1;
        const double crossing = t->clock.step();
        if (crossing >= 0) {
            t->emit(BT_CLOCK, double(t->frame) + crossing, t->clock.bpm);
            if (t->mode == BT_FOLLOW && t->status == BT_FOLLOWING) {
                t->clock.follow(t->target_bpm);
                ++t->revision;
            }
        }
        ++t->frame;
        beat::Detection detection{};
        if (t->detector.push(float(sample), t->frame, detection))
            bt_observe(t, detection.frame, double(t->frame), detection.bpm, detection.confidence, detection.level);
        if (t->mode == BT_FOLLOW) {
            if (t->status == BT_FOLLOWING
                && double(t->frame) - t->last_accepted > 4 * t->clock.sample_rate) t->fresh();
        }
    }
    t->rms = std::sqrt(t->level_squared);
}

void bt_snapshot(const bt_tracker* t, double* out) {
    if (!t || !out) return;
    std::fill(out, out + BT_S_COUNT, 0.0);
    out[BT_S_FRAME] = double(t->frame);
    out[BT_S_EPOCH] = t->epoch;
    out[BT_S_REVISION] = t->revision;
    out[BT_S_MODE] = t->mode;
    out[BT_S_STATUS] = t->status;
    out[BT_S_STARTED] = t->clock.running();
    out[BT_S_BPM] = t->clock.bpm;
    out[BT_S_PHASE] = t->clock.phase;
    out[BT_S_NEXT_BEAT_FRAME] = t->clock.running() ? double(t->frame) + (1 - t->clock.phase)
        * 60 * t->clock.sample_rate / (t->clock.bpm * (1 + t->clock.frequency_offset)) : -1;
    out[BT_S_BEAT_ID] = double(t->clock.serial);
    out[BT_S_RAW_BPM] = t->raw_bpm;
    out[BT_S_CONFIDENCE] = t->confidence;
    out[BT_S_TARGET_BPM] = t->target_bpm;
    out[BT_S_PHASE_ERROR_SECONDS] = t->phase_error;
    out[BT_S_RMS] = t->rms;
    out[BT_S_PEAK] = t->peak;
    out[BT_S_OBSERVATION_AGE_SECONDS] = t->last_accepted < 0 ? -1 : (double(t->frame) - t->last_accepted) / t->clock.sample_rate;
    out[BT_S_DROPPED_EVENTS] = double(t->drops);
    out[BT_S_LAST_DETECTED_FRAME] = t->last_detected;
    out[BT_S_ACCEPTED_COUNT] = t->accepted_count;
    out[BT_S_SAMPLE_RATE] = t->clock.sample_rate;
    out[BT_S_REJECTION] = t->rejection;
}

uint32_t bt_drain_events(bt_tracker* t, double* out, uint32_t capacity) {
    if (!t || !out) return 0;
    const unsigned count = std::min(capacity, t->event_count);
    for (unsigned i = 0; i < count; ++i)
        std::copy(t->events[(t->event_head + i) % event_capacity].begin(),
                  t->events[(t->event_head + i) % event_capacity].end(), out + i * BT_E_COUNT);
    t->event_head = (t->event_head + count) % event_capacity;
    t->event_count -= count;
    return count;
}

int bt_observe(bt_tracker* t, double beat_frame, double available_frame, double bpm, double confidence, double level) {
    if (!t) return BT_BAD_OBSERVATION;
    if (!std::isfinite(beat_frame) || !std::isfinite(available_frame) || !std::isfinite(bpm)
        || !std::isfinite(confidence) || confidence < 0 || !std::isfinite(level) || level < 0
        || available_frame != double(t->frame) || beat_frame < 0 || beat_frame > available_frame)
        return BT_BAD_OBSERVATION;
    int rejection = valid_bpm(bpm) ? BT_ACCEPT : BT_BAD_OBSERVATION;
    const double previous_detected = t->last_detected;
    t->raw_bpm = bpm;
    t->confidence = confidence;
    t->last_detected = std::max(previous_detected, beat_frame);
    if (rejection == BT_ACCEPT && (beat_frame <= previous_detected || beat_frame < double(t->segment_origin)
        || available_frame - beat_frame > 2 * t->clock.sample_rate)) rejection = BT_STALE;
    if (rejection == BT_ACCEPT && t->mode == BT_MANUAL) rejection = BT_MANUAL_OWNER;
    if (rejection == BT_ACCEPT && level < 0.001) rejection = BT_QUIET;
    const uint64_t historical_frame = rejection == BT_BAD_OBSERVATION ? t->frame : uint64_t(beat_frame);
    double historical_phase = -1;
    if (historical_frame == t->frame && t->clock.running()) historical_phase = t->clock.phase;
    else if (historical_frame >= t->history_origin && t->frame - historical_frame < history_capacity)
        historical_phase = t->history[historical_frame % history_capacity];
    t->phase_error = historical_phase < 0 || !t->clock.running() ? 0
        : std::remainder(historical_phase, 1.0) * 60 / t->clock.bpm;
    if (rejection == BT_ACCEPT) {
        if (!t->follower.observe(bpm, beat_frame, confidence, t->clock.sample_rate)) {
            rejection = BT_UNSTABLE;
            t->status = t->clock.running() ? BT_COASTING : BT_LISTENING;
            t->clock.frequency_offset = 0;
        } else {
            t->target_bpm = std::clamp(t->follower.target, min_bpm, max_bpm);
            if (!t->clock.running()) t->clock.start(t->target_bpm, beat_frame, available_frame);
            t->clock.frequency_offset = std::clamp(-t->phase_error * t->clock.bpm / 60 * 0.3, -0.02, 0.02);
            t->last_accepted = available_frame;
            ++t->accepted_count;
            ++t->revision;
            t->status = BT_FOLLOWING;
        }
    }
    t->rejection = rejection;
    t->emit(BT_DETECTION, beat_frame, bpm, confidence, rejection);
    if (rejection == BT_ACCEPT) t->emit(BT_ACCEPTED, beat_frame, t->target_bpm, confidence);
    return rejection;
}
}
