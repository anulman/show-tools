#pragma once
#include "beat_tracker.h"
#include "beat_clock.h"
#ifdef BT_MANUAL_ONLY
#include "manual_detector.h"
#else
#include "aubio_detector.h"
#endif
#include "tempo_follower.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <optional>

namespace {
constexpr double min_bpm = 40;
constexpr double max_bpm = 240;
constexpr unsigned event_capacity = 512;
constexpr unsigned command_capacity = 64;
constexpr unsigned history_capacity = 262144;
struct Command { int type; double value; double frame; double sequence; };
struct TempoTaps {
    std::optional<double> previous;
    std::array<double, 6> intervals{};
    unsigned count = 0;
    unsigned cursor = 0;

    int observe(double event_frame, double sample_rate, double& bpm) {
        bpm = 0;
        if (previous && event_frame <= *previous) return BT_OUT_OF_ORDER;
        const double interval = previous ? (event_frame - *previous) / sample_rate : 0;
        if (interval > 0 && interval < 60 / max_bpm) return BT_INVALID;
        if (interval > 60 / min_bpm || !previous) {
            count = cursor = 0;
        } else {
            intervals[cursor++ % intervals.size()] = interval;
            count = std::min(count + 1, unsigned(intervals.size()));
            auto sorted = intervals;
            std::sort(sorted.begin(), sorted.begin() + count);
            const double median = count % 2 ? sorted[count / 2]
                : (sorted[count / 2 - 1] + sorted[count / 2]) * 0.5;
            bpm = 60 / median;
        }
        previous = event_frame;
        return BT_OK;
    }
};
struct ScheduledTempo { unsigned long long beat; double bpm; };
}

struct bt_tracker {
    explicit bt_tracker(double rate) : clock{rate}, detector(unsigned(rate)) {}
    beat::Clock clock;
    beat::Detector detector;
    beat::Follower follower;
    uint64_t segment_origin = 0;
    struct Ack { double sequence = 0; std::array<double, BT_E_COUNT> event{}; };
    std::array<Ack, 64> acknowledgments{};
    unsigned acknowledgment_cursor = 0;
    uint64_t frame = 0;
    unsigned epoch = 1;
    unsigned revision = 0;
    int mode = BT_FOLLOW;
    int status = BT_LISTENING;
    double last_sequence = 0;
    TempoTaps manual_taps;
    TempoTaps pedal_taps;
    std::optional<ScheduledTempo> scheduled_tempo;
    std::array<Command, command_capacity> commands{};
    unsigned command_count = 0;
    std::array<std::array<double, BT_E_COUNT>, event_capacity> events{};
    unsigned event_head = 0;
    unsigned event_count = 0;
    uint64_t event_serial = 0;
    uint64_t drops = 0;
    std::array<double, history_capacity> history{};
    uint64_t history_origin = 0;
    double rms = 0;
    double peak = 0;
    double level_squared = 0;
    double raw_bpm = 0;
    double confidence = 0;
    double target_bpm = 0;
    double phase_error = 0;
    double last_detected = -1;
    double last_accepted = -1;
    unsigned accepted_count = 0;
    int rejection = BT_UNSTABLE;

    void enqueue(const std::array<double, BT_E_COUNT>& event) {
        if (event_count == event_capacity) {
            event_head = (event_head + 1) % event_capacity;
            --event_count;
            ++drops;
        }
        events[(event_head + event_count++) % event_capacity] = event;
    }

    void emit(int type, double event_frame, double bpm = 0, double conf = 0,
              int result = 0, int command_type = 0, double sequence = 0) {
        enqueue({double(type), double(type == BT_CLOCK ? clock.serial : ++event_serial),
                 event_frame, double(frame + (type == BT_CLOCK ? 1 : 0)), double(epoch), double(revision), bpm, conf,
                 phase_error, double(result), double(command_type), sequence});
    }

    void acknowledge(const Command& command, int result) {
        emit(BT_COMMAND_ACK, double(frame), clock.bpm, 0, result, command.type, command.sequence);
        acknowledgments[acknowledgment_cursor++ % acknowledgments.size()] = {
            command.sequence, events[(event_head + event_count - 1) % event_capacity]};
    }

    void fresh() {
        follower.clear(clock.bpm);
        segment_origin = frame;
        last_accepted = -1;
        accepted_count = 0;
        target_bpm = 0;
        clock.frequency_offset = 0;
        status = clock.running() ? BT_COASTING : BT_LISTENING;
    }

    int tap(double event_frame, bool rephase, int* estimated = nullptr) {
        double bpm = 0;
        const int result = manual_taps.observe(event_frame, clock.sample_rate, bpm);
        if (result != BT_OK) return result;
        mode = BT_MANUAL;
        fresh();
        if (bpm) clock.bpm = bpm;
        if (estimated) *estimated = bpm > 0;
        if (rephase && clock.running()) clock.start(clock.bpm, event_frame, double(frame));
        ++revision;
        return BT_OK;
    }

    int apply(const Command& command) {
        int result = BT_OK;
        switch (command.type) {
        case BT_SEED:
            if (clock.running()) { result = BT_ALREADY_STARTED; break; }
            clock.start(command.value, command.frame, double(frame));
            ++revision;
            break;
        case BT_APPLY_BPM:
            mode = BT_MANUAL;
            clock.start(command.value, command.frame, double(frame));
            manual_taps = {};
            pedal_taps = {};
            scheduled_tempo.reset();
            fresh();
            ++revision;
            break;
        case BT_TAP: result = tap(command.frame, true); break;
        case BT_SELECT_FOLLOW: mode = BT_FOLLOW; fresh(); break;
        case BT_SELECT_MANUAL: mode = BT_MANUAL; fresh(); break;
        case BT_FRESH_AUDIO: fresh(); break;
        case BT_RESET:
            clock.bpm = 0;
            clock.phase = 0;
            manual_taps = {};
            pedal_taps = {};
            scheduled_tempo.reset();
            event_head = event_count = 0;
            ++epoch;
            ++revision;
            history_origin = frame;
            raw_bpm = confidence = phase_error = 0;
            last_detected = -1;
            fresh();
            for (unsigned i = 0; i < command_count; ++i) acknowledge(commands[i], BT_OLD_EPOCH);
            command_count = 0;
            break;
        default: result = BT_INVALID; break;
        }
        if (mode == BT_MANUAL) status = clock.running() ? BT_COASTING : BT_LISTENING;
        else if (clock.running() && status == BT_LISTENING) status = BT_COASTING;
        acknowledge(command, result);
        return result;
    }
};
