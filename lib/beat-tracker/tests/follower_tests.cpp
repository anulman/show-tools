#include "beat_tracker.h"
#include <array>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <vector>

namespace {
using Snapshot = std::array<double, BT_S_COUNT>;
void require(bool okay, const char* text) { if (!okay) { std::cerr << text << '\n'; std::exit(1); } }
Snapshot state(bt_tracker* tracker) { Snapshot s{}; bt_snapshot(tracker, s.data()); return s; }
void advance(bt_tracker* tracker, double frame) {
    const auto now = uint64_t(state(tracker)[BT_S_FRAME]);
    const auto until = uint64_t(std::round(frame));
    if (until > now) bt_process(tracker, nullptr, uint32_t(until - now));
}
int observe(bt_tracker* tracker, double frame, double bpm) {
    advance(tracker, frame);
    const double available = state(tracker)[BT_S_FRAME];
    return bt_observe(tracker, std::min(frame, available), available, bpm, 1, 0.1);
}
bt_tracker* seeded(double bpm, bool manual = false) {
    auto* tracker = bt_create(48000);
    bt_command(tracker, manual ? BT_APPLY_BPM : BT_SEED, bpm, 0, 1, 1);
    return tracker;
}
void steady(double bpm) {
    auto* tracker = bt_create(48000);
    for (unsigned beat = 1; beat <= 16; ++beat) {
        observe(tracker, beat * 48000 * 60 / bpm, bpm);
        if (beat == 6) require(state(tracker)[BT_S_STARTED], "acquisition within six observations");
    }
    const auto s = state(tracker);
    require(s[BT_S_STARTED] && s[BT_S_STATUS] == BT_FOLLOWING, "unseeded ideal observations acquire");
    require(std::abs(s[BT_S_BPM] / bpm - 1) < 0.02, "steady ideal tempo within 2 percent");
    bt_destroy(tracker);
}
void transition(double start, double finish) {
    auto* tracker = seeded(start);
    double frame = 0;
    for (unsigned beat = 0; beat < 8; ++beat) { frame += 48000 * 60 / start; observe(tracker, frame, start); }
    for (unsigned beat = 0; beat < 32; ++beat) {
        frame += 48000 * 60 / finish;
        observe(tracker, frame, finish);
        const double tempo = state(tracker)[BT_S_BPM];
        require(finish > start ? tempo >= start - 1e-7 : tempo <= start + 1e-7, "step never reverses through octave folding");
    }
    require(std::abs(state(tracker)[BT_S_BPM] / finish - 1) < 0.02, "120/180 step converges within 32 beats");
    bt_destroy(tracker);
}
void ramp(double start, double finish) {
    auto* tracker = seeded(start);
    const double slope = (finish - start) / 20;
    for (unsigned beat = 1;; ++beat) {
        const double seconds = (-start + std::sqrt(start * start + 120 * slope * beat)) / slope;
        if (seconds > 20) break;
        const double bpm = start + slope * seconds;
        observe(tracker, seconds * 48000, bpm);
        if (seconds > 4) require(std::abs(state(tracker)[BT_S_BPM] / bpm - 1) < 0.05,
            "continuous ramp remains within five percent after four seconds");
    }
    bt_destroy(tracker);
}
void phase_recovery() {
    auto* tracker = seeded(120);
    for (unsigned beat = 1; beat <= 50; ++beat) observe(tracker, (0.2 + beat * 0.5) * 48000, 120);
    require(std::abs(state(tracker)[BT_S_PHASE_ERROR_SECONDS]) < 0.05, "phase slew converges within fifty milliseconds");
    std::array<double, BT_E_COUNT * 512> events{};
    const unsigned count = bt_drain_events(tracker, events.data(), 512);
    double previous_frame = -1, previous_id = -1;
    for (unsigned i = 0; i < count; ++i) if (events[i * BT_E_COUNT] == BT_CLOCK) {
        require(events[i * BT_E_COUNT + BT_E_ID] > previous_id && events[i * BT_E_COUNT + BT_E_FRAME] > previous_frame,
            "phase correction preserves unique increasing clock events");
        require(events[i * BT_E_COUNT + BT_E_AVAILABLE_FRAME] >= events[i * BT_E_COUNT + BT_E_FRAME],
            "clock availability cannot precede crossing");
        previous_id = events[i * BT_E_COUNT + BT_E_ID];
        previous_frame = events[i * BT_E_COUNT + BT_E_FRAME];
    }
    bt_destroy(tracker);
}
}
int main() {
    steady(90); steady(120); steady(180);
    transition(120, 180); transition(180, 120);
    ramp(90, 120); ramp(120, 90);
    phase_recovery();
    auto* t = seeded(120);
    for (unsigned beat = 1; beat <= 40; ++beat) {
        if (beat == 15 || beat == 22) continue;
        observe(t, beat * 24000.0, beat % 3 == 0 ? 60 : beat % 3 == 1 ? 120 : 240);
    }
    require(std::abs(state(t)[BT_S_BPM] - 120) < 0.01, "octave outliers and skipped detections preserve tempo");
    const double bpm = state(t)[BT_S_BPM];
    bt_process(t, nullptr, 20 * 48000);
    require(state(t)[BT_S_STATUS] == BT_COASTING && state(t)[BT_S_BPM] == bpm, "silence coasts at held tempo");
    const double now = state(t)[BT_S_FRAME];
    require(bt_observe(t, now - 3 * 48000, now, 120, 1, 0.1) == BT_STALE, "stale observation rejected");
    bt_command(t, BT_SELECT_MANUAL, 0, now, 2, 1);
    auto* reference = seeded(120, true);
    bt_process(reference, nullptr, uint32_t(now));
    for (unsigned beat = 1; beat <= 12; ++beat) {
        const double frame = now + beat * 16000;
        observe(t, frame, 180);
        advance(reference, frame);
        const auto actual = state(t), expected = state(reference);
        require(actual[BT_S_BPM] == expected[BT_S_BPM]
            && std::abs(actual[BT_S_PHASE] - expected[BT_S_PHASE]) < 1e-10, "manual isolated from conflicting audio");
    }
    bt_command(t, BT_SELECT_FOLLOW, 0, state(t)[BT_S_FRAME], 3, 1);
    require(state(t)[BT_S_ACCEPTED_COUNT] == 0, "Follow requires fresh observations");
    double frame = state(t)[BT_S_FRAME];
    observe(t, frame + 24000, 120);
    require(state(t)[BT_S_STATUS] != BT_FOLLOWING, "single fresh observation cannot follow");
    bt_command(t, BT_FRESH_AUDIO, 0, state(t)[BT_S_FRAME], 4, 1);
    frame = state(t)[BT_S_FRAME];
    require(bt_observe(t, frame - 100, frame, 120, 1, 0.1) == BT_STALE, "fresh segment excludes old detections");
    bt_destroy(t); bt_destroy(reference);
    std::cout << "follower tests passed\n";
}
