#include "beat_tracker.h"
#include <sndfile.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

namespace {
void usage() { std::cerr << "Usage: beat-tracker FILE.wav [--bpm N] [--manual] [--chunk N]\n"; }
bool number(const char* text, double& result) {
    char* end = nullptr;
    result = std::strtod(text, &end);
    return end != text && !*end && std::isfinite(result);
}
void extras(const std::array<double, BT_S_COUNT>& state) {
    for (int index : {BT_S_TARGET_BPM, BT_S_STATUS, BT_S_MODE, BT_S_RMS, BT_S_PHASE,
                      BT_S_NEXT_BEAT_FRAME, BT_S_ACCEPTED_COUNT, BT_S_RAW_BPM})
        std::cout << ',' << state[index];
    std::cout << '\n';
}
void drain(bt_tracker* tracker, bool snapshot) {
    std::array<double, BT_S_COUNT> state{};
    std::array<double, BT_E_COUNT * 64> events{};
    bt_snapshot(tracker, state.data());
    unsigned count;
    while ((count = bt_drain_events(tracker, events.data(), 64))) {
        for (unsigned row = 0; row < count; ++row) {
            for (unsigned column = 0; column < BT_E_COUNT; ++column)
                std::cout << (column ? "," : "") << events[row * BT_E_COUNT + column];
            extras(state);
        }
    }
    if (snapshot) {
        std::cout << "5," << state[BT_S_BEAT_ID] << ',' << state[BT_S_FRAME] << ',' << state[BT_S_FRAME]
            << ',' << state[BT_S_EPOCH] << ',' << state[BT_S_REVISION] << ',' << state[BT_S_BPM]
            << ',' << state[BT_S_CONFIDENCE] << ',' << state[BT_S_PHASE_ERROR_SECONDS] << ','
            << state[BT_S_REJECTION] << ",0,0";
        extras(state);
    }
}
}

int main(int argc, char** argv) {
    if (argc < 2 || std::string(argv[1]) == "--help") { usage(); return argc < 2 ? 2 : 0; }
    double bpm = 0;
    unsigned chunk = 512;
    bool manual = false;
    for (int i = 2; i < argc; ++i) {
        const std::string option = argv[i];
        double value = 0;
        if (option == "--manual") manual = true;
        else if ((option == "--bpm" || option == "--chunk") && i + 1 < argc && number(argv[++i], value)) {
            if (option == "--bpm" && value >= 40 && value <= 240) bpm = value;
            else if (option == "--chunk" && value >= 1 && value <= 65536 && std::floor(value) == value) chunk = unsigned(value);
            else { usage(); return 2; }
        } else { usage(); return 2; }
    }
    SF_INFO info{};
    std::unique_ptr<SNDFILE, decltype(&sf_close)> file(sf_open(argv[1], SFM_READ, &info), sf_close);
    if (!file) { std::cerr << "Cannot open audio: " << sf_strerror(nullptr) << '\n'; return 1; }
    if (info.channels < 1 || info.channels > 64) { std::cerr << "Expected 1 to 64 audio channels\n"; return 1; }
    std::unique_ptr<bt_tracker, decltype(&bt_destroy)> tracker(bt_create(info.samplerate), bt_destroy);
    if (!tracker) { std::cerr << "Unsupported sample rate or detector initialization failed\n"; return 1; }
    double sequence = 0;
    if (bpm) bt_command(tracker.get(), BT_SEED, bpm, 0, ++sequence, 1);
    if (manual) bt_command(tracker.get(), BT_SELECT_MANUAL, 0, 0, ++sequence, 1);
    std::vector<float> interleaved(size_t(chunk) * info.channels);
    std::vector<float> mono(chunk);
    std::cout << std::setprecision(14)
        << "kind,id,frame,available_frame,epoch,revision,bpm,confidence,phase_error_seconds,result,command_type,sequence,target_bpm,status,mode,rms,phase,next_beat_frame,accepted_count,raw_bpm\n";
    sf_count_t frames;
    uint64_t total = 0;
    uint64_t next_snapshot = 0;
    while ((frames = sf_readf_float(file.get(), interleaved.data(), chunk)) > 0) {
        for (sf_count_t frame = 0; frame < frames; ++frame) {
            double sum = 0;
            for (int channel = 0; channel < info.channels; ++channel)
                sum += interleaved[size_t(frame) * info.channels + channel];
            mono[size_t(frame)] = float(sum / info.channels);
        }
        bt_process(tracker.get(), mono.data(), uint32_t(frames));
        total += uint64_t(frames);
        const bool snapshot = total >= next_snapshot;
        if (snapshot) next_snapshot = total + uint64_t(info.samplerate / 10);
        drain(tracker.get(), snapshot);
    }
    drain(tracker.get(), true);
    if (sf_error(file.get())) { std::cerr << "Audio read failed: " << sf_strerror(file.get()) << '\n'; return 1; }
    std::cerr << "Processed " << total << " frames at " << info.samplerate << " Hz\n";
}
