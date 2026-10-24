#include "beat_tracker.h"
#include <array>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <vector>

void require(bool okay, const char* message) {
    if (!okay) { std::cerr << message << '\n'; std::exit(1); }
}
using Snapshot = std::array<double, BT_S_COUNT>;
Snapshot state(bt_tracker* t) { Snapshot s{}; bt_snapshot(t, s.data()); return s; }
std::vector<double> run(unsigned chunk) {
    auto* t = bt_create(48000);
    require(bt_command(t, BT_SEED, 123, 0, 1, 1) == BT_OK, "seed accepted");
    require(bt_command(t, BT_APPLY_BPM, 110, 100003, 2, 1) == BT_OK, "future apply accepted");
    std::vector<double> beats;
    std::array<double, BT_E_COUNT * 64> events{};
    for (unsigned frame = 0; frame < 960000;) {
        unsigned size = std::min(chunk, 960000 - frame);
        bt_process(t, nullptr, size);
        unsigned count = bt_drain_events(t, events.data(), 64);
        for (unsigned i = 0; i < count; ++i) if (events[i * BT_E_COUNT] == BT_CLOCK) beats.push_back(events[i * BT_E_COUNT + BT_E_FRAME]);
        frame += size;
    }
    require(state(t)[BT_S_MODE] == BT_MANUAL, "manual persists through silence");
    require(std::abs(state(t)[BT_S_BPM] - 110) < 1e-9, "manual tempo unchanged");
    bt_destroy(t);
    return beats;
}
int main() {
    require(bt_create(0) == nullptr, "invalid sample rate rejected");
    require(run(1) == run(127) && run(127) == run(2048), "sample times independent of chunk size");
    auto* t = bt_create(44100);
    bt_process(t, nullptr, 44100);
    require(state(t)[BT_S_STARTED] == 0, "no invented unseeded beats");
    require(bt_command(t, BT_TAP, 0, 22050, 1, 1) == BT_OK, "late first tap accepted");
    require(state(t)[BT_S_MODE] == BT_MANUAL && state(t)[BT_S_STARTED] == 0, "first tap owns manual without invented tempo");
    bt_process(t, nullptr, 22050);
    require(bt_command(t, BT_TAP, 0, 44100, 2, 1) == BT_OK, "late second tap accepted");
    require(std::abs(state(t)[BT_S_BPM] - 120) < 1e-9, "event-time taps survive delayed delivery");
    require(bt_command(t, BT_SEED, 90, 66150, 3, 1) == BT_ALREADY_STARTED, "repeat seed cannot overwrite manual");
    require(bt_command(t, BT_TAP, 0, 43000, 4, 1) == BT_OUT_OF_ORDER, "reordered tap rejected");
    require(bt_command(t, BT_SELECT_FOLLOW, 0, 66150, 4, 1) == BT_OUT_OF_ORDER,
        "completed retry replays the original rejected tap result");
    require(bt_command(t, BT_RESET, 0, 66150, 5, 1) == BT_OK, "reset accepted");
    require(state(t)[BT_S_MODE] == BT_MANUAL && state(t)[BT_S_EPOCH] == 2, "reset preserves manual and changes epoch");
    require(bt_command(t, BT_SEED, 120, 66150, 6, 1) == BT_OLD_EPOCH, "old epoch rejected");
    bt_destroy(t);
    t = bt_create(48000);
    require(bt_command(t, BT_TAP, 0, -24000, 1, 1) == BT_OK, "cold tap before engine origin accepted");
    bt_process(t, nullptr, 24000);
    require(bt_command(t, BT_TAP, 0, 0, 2, 1) == BT_OK, "second cold tap retains original event time");
    require(state(t)[BT_S_BPM] == 120 && state(t)[BT_S_MODE] == BT_MANUAL,
        "pre-origin tap interval establishes 120 BPM");
    require(std::abs(state(t)[BT_S_PHASE]) < 1e-12 && state(t)[BT_S_BEAT_ID] == 0,
        "late tap anchor projects forward without retrospective beats");
    require(bt_command(t, BT_SEED, 100, -1, 3, 1) == BT_INVALID, "negative non-tap command rejected");
    bt_destroy(t);
    t = bt_create(48000);
    std::array<double, BT_E_COUNT * 512> events{};
    auto drain = [&]() { return bt_drain_events(t, events.data(), 512); };
    require(bt_command(t, BT_SEED, 120, 0, 1, 1) == BT_OK, "initial seed accepted");
    require(bt_command(t, BT_SEED, 90, 0, 2, 1) == BT_ALREADY_STARTED, "reseed rejected");
    require(drain() == 2, "initial commands have terminal acknowledgments");
    const auto original_events = events;
    bt_process(t, nullptr, 137);
    require(bt_command(t, BT_SEED, 120, 0, 1, 1) == BT_OK, "successful retry returns original result");
    require(bt_command(t, BT_SEED, 90, 0, 2, 1) == BT_ALREADY_STARTED, "failed retry returns original failure");
    require(drain() == 2, "completed retries each replay an acknowledgment");
    for (unsigned i = 0; i < 2 * BT_E_COUNT; ++i)
        require(events[i] == original_events[i], "retry replays original acknowledgment exactly");
    require(bt_command(t, BT_RESET, 0, 200, 3, 1) == BT_INVALID, "future reset rejected");
    require(bt_command(t, BT_FRESH_AUDIO, 0, 200, 3, 1) == BT_INVALID, "future fresh audio rejected");
    require(state(t)[BT_S_EPOCH] == 1 && state(t)[BT_S_BPM] == 120,
        "rejected lifecycle scheduling does not change state");
    require(bt_command(t, BT_APPLY_BPM, 90, 200, 3, 1) == BT_OK, "future BPM accepted");
    require(bt_command(t, BT_TAP, 0, 300, 4, 1) == BT_OK, "future tap accepted");
    require(bt_command(t, BT_RESET, 0, 137, 5, 1) == BT_OK, "immediate reset accepted with pending commands");
    require(drain() == 3, "reset emits every cancellation and its own acknowledgment");
    for (unsigned i = 0; i < 3; ++i) {
        const auto* event = events.data() + i * BT_E_COUNT;
        require(event[BT_E_TYPE] == BT_COMMAND_ACK && event[BT_E_EPOCH] == 2,
            "reset terminal acknowledgments use the new epoch");
        require(event[BT_E_SEQUENCE] == 3 + i && event[BT_E_RESULT] == (i < 2 ? BT_OLD_EPOCH : BT_OK),
            "pending commands receive terminal cancellation before the reset acknowledgment");
    }
    const auto reset_events = events;
    require(bt_command(t, BT_APPLY_BPM, 90, 200, 3, 1) == BT_OLD_EPOCH,
        "cancelled command retry replays its terminal old-epoch result");
    require(bt_command(t, BT_RESET, 0, 137, 5, 1) == BT_OK,
        "reset retry replays success across its epoch boundary");
    require(drain() == 2, "cancelled and reset retries replay terminal acknowledgments");
    for (unsigned i = 0; i < BT_E_COUNT; ++i) {
        require(events[i] == reset_events[i], "cancelled retry keeps the recorded acknowledgment");
        require(events[BT_E_COUNT + i] == reset_events[2 * BT_E_COUNT + i], "reset retry keeps the recorded acknowledgment");
    }
    bt_process(t, nullptr, 400);
    require(state(t)[BT_S_STARTED] == 0 && state(t)[BT_S_EPOCH] == 2,
        "cancelled commands cannot apply after reset");
    bt_destroy(t);
    std::cout << "clock tests passed\n";
}
