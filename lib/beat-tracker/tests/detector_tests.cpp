#include "beat_tracker.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <cstdint>
#include <iostream>
#include <vector>

void require(bool condition, const char* message) {
    if (!condition) { std::cerr << message << '\n'; std::exit(1); }
}


void fresh_detector_regression(int command_type, int signal) {
    constexpr unsigned rate = 48000;
    auto* trained = bt_create(rate);
    auto* control = bt_create(rate);
    require(trained && control, "freshness fixture initialized");
    std::array<float, 512> audio{};
    std::array<double, BT_S_COUNT> before{}, treatment{}, baseline{};
    uint32_t random = 1979;
    for (unsigned frame = 0; frame < rate * 20; frame += audio.size()) {
        const unsigned count = std::min(unsigned(audio.size()), rate * 20 - frame);
        for (unsigned i = 0; i < count; ++i) {
            const unsigned age = (frame + i) % 24000;
            audio[i] = 0;
            if (age < 1680) {
                random = random * 1664525u + 1013904223u;
                const double noise = double(int64_t(random) - (random > INT32_MAX ? 4294967296LL : 0)) / 2147483648.0;
                audio[i] = float(noise * std::exp(-double(age) / 336) * 0.7);
            }
        }
        bt_process(trained, audio.data(), count);
    }
    bt_snapshot(trained, before.data());
    require(before[BT_S_STARTED] == 1, "demo-style training actually acquired the rhythm");
    // Make the boundary fall inside an input hop and at a nonzero sample origin.
    bt_process(trained, nullptr, 137);
    constexpr unsigned origin = rate * 20 + 137;
    require(bt_command(trained, command_type, 0, origin, 1, 1) == BT_OK, "fresh lifecycle command accepted");
    std::array<double, BT_E_COUNT * 512> events{};
    bt_drain_events(trained, events.data(), 512);
    using Trace = std::vector<std::array<double, 4>>;
    Trace trained_trace, control_trace;
    auto collect = [&](bt_tracker* tracker, Trace& trace, unsigned offset) {
        const unsigned count = bt_drain_events(tracker, events.data(), 512);
        for (unsigned i = 0; i < count; ++i) {
            const auto* event = events.data() + i * BT_E_COUNT;
            if (event[BT_E_TYPE] == BT_DETECTION)
                trace.push_back({event[BT_E_FRAME] - offset, event[BT_E_AVAILABLE_FRAME] - offset,
                    event[BT_E_BPM], event[BT_E_CONFIDENCE]});
        }
    };
    for (unsigned frame = 0; frame < rate * 8; frame += audio.size()) {
        const unsigned count = std::min(unsigned(audio.size()), rate * 8 - frame);
        for (unsigned i = 0; i < count; ++i) {
            random = random * 1664525u + 1013904223u;
            const double noise = double(int64_t(random) - (random > INT32_MAX ? 4294967296LL : 0)) / 2147483648.0;
            audio[i] = signal == 0 ? float(0.3 * std::sin(2 * std::acos(-1.0) * 440 * (frame + i) / rate))
                : signal == 1 ? float(noise * 0.3) : 0;
        }
        bt_process(trained, audio.data(), count);
        bt_process(control, audio.data(), count);
        collect(trained, trained_trace, origin);
        collect(control, control_trace, 0);
    }
    bt_snapshot(trained, treatment.data());
    bt_snapshot(control, baseline.data());
    require(trained_trace == control_trace, "replacement analyzer exactly matches fresh detector observations and local timestamps");
    require(treatment[BT_S_ACCEPTED_COUNT] == baseline[BT_S_ACCEPTED_COUNT],
        "lifecycle boundary cannot inherit analyzer evidence into tone, noise, or silence");
    require(command_type != BT_RESET || treatment[BT_S_STARTED] == baseline[BT_S_STARTED],
        "reset clock acquisition matches the fresh control");
    require(command_type != BT_FRESH_AUDIO || signal != 2 || treatment[BT_S_STATUS] == BT_COASTING,
        "fresh audio keeps the old clock coasting in silence");
    std::cout << "freshness command=" << command_type << " signal=" << signal
        << " accepted=" << treatment[BT_S_ACCEPTED_COUNT] << " control=" << baseline[BT_S_ACCEPTED_COUNT] << '\n';
    bt_destroy(trained);
    bt_destroy(control);
}

int main() {
    for (int command : {BT_RESET, BT_FRESH_AUDIO})
        for (int signal = 0; signal < 3; ++signal) fresh_detector_regression(command, signal);
    for (unsigned rate : {44100u, 48000u}) {
        auto* tracker = bt_create(rate);
        require(tracker, "detector initialized");
        bt_command(tracker, BT_SEED, 120, 0, 1, 1);
        std::array<float, 127> audio{};
        std::array<double, BT_E_COUNT * 512> events{};
        std::array<double, BT_S_COUNT> state{};
        unsigned random = 0x13579;
        unsigned detections = 0, accepted = 0, silence_detections = 0;
        std::vector<double> phase_errors;
        double first_accept = -1;
        for (unsigned frame = 0; frame < rate * 50;) {
            const unsigned size = std::min(unsigned(audio.size()), rate * 50 - frame);
            for (unsigned i = 0; i < size; ++i) {
                const unsigned position = frame + i;
                const unsigned age = position % (rate / 2);
                float sample = 0;
                if (position < rate * 30 && age < rate / 100) {
                    random = 1664525u * random + 1013904223u;
                    const double noise = double(random) / 4294967295.0 * 2 - 1;
                    sample = float(0.9 * noise * std::exp(-double(age) / (rate * 0.002)));
                }
                audio[i] = sample;
            }
            bt_process(tracker, audio.data(), size);
            frame += size;
            const unsigned count = bt_drain_events(tracker, events.data(), 512);
            for (unsigned i = 0; i < count; ++i) {
                const auto* event = events.data() + i * BT_E_COUNT;
                if (event[BT_E_TYPE] == BT_CLOCK && event[BT_E_FRAME] >= rate * 10 && event[BT_E_FRAME] <= rate * 30)
                    phase_errors.push_back(std::abs(std::remainder(event[BT_E_FRAME] / rate, 0.5)));
                if (event[BT_E_TYPE] == BT_DETECTION) {
                    ++detections;
                    if (event[BT_E_AVAILABLE_FRAME] > rate * 31) ++silence_detections;
                }
                if (event[BT_E_TYPE] == BT_ACCEPTED) {
                    ++accepted;
                    if (first_accept < 0) first_accept = event[BT_E_AVAILABLE_FRAME] / rate;
                }
            }
            if (frame >= rate * 30 && frame - size < rate * 30) {
                bt_command(tracker, BT_FRESH_AUDIO, 0, frame, 2, 1);
                bt_snapshot(tracker, state.data());
                require(state[BT_S_STATUS] == BT_COASTING && state[BT_S_ACCEPTED_COUNT] == 0,
                    "new capture segment immediately invalidates old accepted evidence");
            }
        }
        bt_snapshot(tracker, state.data());
        std::sort(phase_errors.begin(), phase_errors.end());
        require(!phase_errors.empty() && phase_errors[phase_errors.size() / 2] < 0.05,
            "seeded burst clock median phase error below fifty milliseconds in fixed 10-to-30s window");
        require(std::abs(state[BT_S_BPM] / 120 - 1) < 0.02, "held burst tempo within two percent");
        require(detections > 0 && accepted > 0, "real aubio pulse output reaches follower");
        require(first_accept <= 8, "named seeded burst fixture acquires within eight seconds");
        require(silence_detections == 0, "aubio getters in silence never fabricate beat events");
        require(state[BT_S_STATUS] == BT_COASTING && state[BT_S_ACCEPTED_COUNT] == 0,
            "old strong analyzer state cannot reacquire during silence after fresh audio");
        std::cout << "rate=" << rate << " detections=" << detections << " accepted=" << accepted
            << " first_accept_seconds=" << first_accept
            << " median_phase_error_seconds=" << phase_errors[phase_errors.size() / 2] << '\n';
        bt_destroy(tracker);
    }
}
