#include "audio_pump.h"
#include "instrument.h"
#include "alsa_run.h"
#include <cerrno>
#include <algorithm>
#include <array>
#include <cstdlib>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

using native_host::AudioPump;
namespace {
void require(bool condition) { if (!condition) std::abort(); }
struct Sink { std::vector<float> samples; uint32_t limit; };
int64_t write_short(void* context, const float* data, uint32_t frames) {
  auto& sink = *static_cast<Sink*>(context);
  frames = std::min(frames, sink.limit);
  sink.samples.insert(sink.samples.end(), data, data + 2 * frames);
  return frames;
}
std::vector<uint8_t> compiled_packet() {
  const std::vector<double> table{PF_COMPILED_MAGIC, PF_COMPILED_VERSION, 4, 4, 120, 4, 25, 25, 3, 7, 4, 0, 0, 1, 2, 3,
      0,1,0,2,0,1,2,0,0, 0,2,0,3,0,1,3,0,0, 1,3,0,4,0,1,4,0,2,
      0,0,0,-1,PF_ARM,1,0,0,-1,-1,0, 0,0,1,-1,PF_COMMIT_ARM,1,0,1,0,0,0,
      0,0,2,-1,PF_COMMIT,1,0,-1,1,1,0, 1,1,2,-1,PF_ARM,1,0,2,-1,-1,0,
      0,0,3,3,PF_STOP,2,3.25,-1,-1,-1,0, 1,1,3,-1,PF_COMMIT,1,0,-1,2,2,0,
      0,0,4,-1,PF_PLAY,0,0,-1,-1,0,0, 0,0,1,1,0,1,1,1,1,2,2,1};
  std::vector<uint8_t> bytes(table.size() * 8);
  for (size_t i = 0; i < table.size(); ++i) {
    uint64_t bits; std::memcpy(&bits, &table[i], sizeof(bits));
    for (unsigned j = 0; j < 8; ++j) bytes[i * 8 + j] = uint8_t(bits >> (j * 8));
  }
  return bytes;
}
struct StatefulDevice {
  enum class State { Setup, Prepared, Running };
  State capture = State::Setup, playback = State::Setup;
  int prepares = 0, drops = 0, drains = 0;
  bool draining = false, hold_drain = false;
  uint32_t written = 0;
  int prepare() {
    ++prepares;
    if (capture == State::Running || playback == State::Running) return -EBUSY;
    capture = playback = State::Prepared;
    return 0;
  }
  void read() { capture = State::Running; }
  static int64_t write(void* context, const float*, uint32_t frames) {
    auto& device = *static_cast<StatefulDevice*>(context);
    device.playback = State::Running;
    frames = std::min(frames, 17u);
    device.written += frames;
    return frames;
  }
  int finish() {
    if (!draining) {
      require(capture == State::Running && playback == State::Running);
      capture = State::Setup;
      draining = true;
      ++drains;
    }
    if (hold_drain) return 1;
    playback = State::Setup;
    draining = false;
    return 0;
  }
  int drop() { capture = playback = State::Setup; draining = false; ++drops; return 0; }
};
struct Engine {
  pf_engine* value = pf_create(8000, PF_PRACTICE, 32, 30, 4);
  Engine() {
    require(value);
    pf_effect_definition effect{PF_EFFECT_SLAPBACK, 1, {{100, 0, .25}}};
    require(pf_prepare_live_effects(value, &effect, 1, 1) == 0);
    auto bytes = compiled_packet();
    require(pf_load_compiled_bytes(value, bytes.data(), uint32_t(bytes.size())) == 0);
    require(pf_set_microphone(value, 1) == 0);
    require(pf_start(value, 120, 1, 1, 4, 0, 0) == 0);
  }
  ~Engine() { pf_destroy(value); }
  double frame() const { std::array<double, PF_FIELDS> state{}; pf_snapshot(value, state.data()); return state[PF_FRAME]; }
};
}
int main() {
  native_host::Instrument instrument({8000, 32, 30, 509, true});
  native_host::Profiles profiles{}; profiles.revisions.fill(1);
  auto packet = compiled_packet();
  require(instrument.lifecycle() == native_host::Lifecycle::Stopped);
  require(instrument.prepare(packet.data(), uint32_t(packet.size()), profiles));
  auto* original = instrument.engine();
  std::array<uint8_t, 8> invalid{};
  require(!instrument.prepare(invalid.data(), invalid.size(), profiles));
  require(instrument.engine() == original && instrument.lifecycle() == native_host::Lifecycle::Prepared);
  require(instrument.start({120, 1, 1, 4, 0, 0}));
  require(!instrument.prepare(packet.data(), uint32_t(packet.size()), profiles));
  std::array<float, 509> test_input{};
  require(instrument.render(test_input.data(), 127) == 0 && instrument.pending() == 127);
  instrument.stop();
  require(instrument.pending() == 0 && instrument.lifecycle() == native_host::Lifecycle::Prepared);
  require(instrument.start({120, 0, 1, 1, 0, 0}));
  Sink tail{{}, 17};
  while (instrument.lifecycle() == native_host::Lifecycle::Running) {
    require(instrument.render(test_input.data(), 509) == 0);
    if (instrument.lifecycle() == native_host::Lifecycle::Running)
      while (instrument.pending()) require(instrument.write(write_short, &tail) > 0);
  }
  require(instrument.lifecycle() == native_host::Lifecycle::Prepared && instrument.pending() == 509);
  require(!instrument.start({120, 0, 1, 1, 0, 0}));
  while (instrument.pending()) require(instrument.write(write_short, &tail) > 0);
  require(instrument.prepare_profiles(profiles));
  require(instrument.start({120, 0, 1, 1, 0, 0}));
  instrument.stop();
  native_host::AlsaRun run;
  StatefulDevice device;
  const native_host::Start start{120, 0, 1, 1, 0, 0};
  require(run.start(instrument, device, start) == 0);
  device.read();
  while (instrument.lifecycle() == native_host::Lifecycle::Running) {
    require(instrument.render(test_input.data(), 509) == 0);
    if (instrument.lifecycle() == native_host::Lifecycle::Running)
      while (instrument.pending()) require(instrument.write(StatefulDevice::write, &device) > 0);
  }
  auto before = device.written;
  require(run.start(instrument, device, start) == -1 && device.prepares == 1);
  require(run.complete(instrument, device) == 0 && device.drains == 0);
  while (instrument.pending()) {
    require(instrument.write(StatefulDevice::write, &device) > 0);
    if (instrument.pending()) require(run.complete(instrument, device) == 0 && device.drains == 0);
  }
  require(device.written - before == 509);
  device.hold_drain = true;
  require(run.complete(instrument, device) == 0 && device.drains == 1 && device.drops == 0);
  require(run.active() && run.start(instrument, device, start) == -1 && device.prepares == 1);
  device.hold_drain = false;
  require(run.complete(instrument, device) == 0 && !run.active() && device.drains == 1);
  require(run.start(instrument, device, start) == 0);
  device.read();
  require(instrument.render(test_input.data(), 509) == 0);
  require(instrument.write(StatefulDevice::write, &device) > 0);
  instrument.stop();
  require(run.drop(device) == 0 && instrument.pending() == 0 && device.drops == 1 && device.drains == 1);
  require(run.start(instrument, device, start) == 0);
  device.read();
  require(instrument.render(test_input.data(), 509) == 0);
  require(instrument.write(StatefulDevice::write, &device) > 0);
  require(instrument.control(4, 0) == 0);
  require(run.drop(device) == 0 && instrument.pending() == 0 && device.drops == 2 && device.drains == 1);
  Engine engine;
  AudioPump pump(engine.value, 509);
  std::array<float, 509> input{}; input.fill(.25f);
  Sink sink{{}, 17};
  for (uint32_t frames : {1u, 127u, 509u, 33u, 256u}) {
    double before = engine.frame();
    require(pump.render(input.data(), frames) == 0);
    require(engine.frame() == before + frames);
    require(pump.render(input.data(), frames) < 0);
    while (pump.pending()) {
      require(pump.write(write_short, &sink) > 0);
      require(engine.frame() == before + frames);
    }
  }
  require(sink.samples.size() == 2 * (1 + 127 + 509 + 33 + 256));
  require(std::any_of(sink.samples.begin(), sink.samples.end(), [](float sample) { return std::abs(sample) > .001; }));
  require(pump.render(input.data(), 510) < 0);
  require(pump.render(input.data(), 127) == 0);
  pf_stop(engine.value);
  pump.discard();
  require(pump.pending() == 0);
  Engine capture;
  require(pf_set_click_gain(capture.value, 0) == 0);
  AudioPump capture_pump(capture.value, 509);
  Sink captured{{}, 23};
  require(pf_control(capture.value, 0, 0, nullptr, 0) == 0);
  auto reach = [&](int bar) {
    for (;;) {
      std::array<double, PF_FIELDS> state{}; pf_snapshot(capture.value, state.data());
      if (state[PF_PHASE] == PF_PLAYING && state[PF_BAR_NUMBER] == bar) break;
      require(capture_pump.render(input.data(), 1) == 0);
      require(capture_pump.write(write_short, &captured) == 1);
    }
  };
  reach(1);
  require(pf_control(capture.value, 0, 0, nullptr, 0) == 0);
  reach(2);
  std::array<double, PF_TAKE_FIELDS> take{}; pf_compiled_take_info(capture.value, 0, take.data());
  require(take[PF_TAKE_READY] == 1 && take[PF_TAKE_LENGTH] == 16000);
  captured.samples.clear();
  require(capture_pump.render(input.data(), 127) == 0);
  while (capture_pump.pending()) require(capture_pump.write(write_short, &captured) > 0);
  require(std::all_of(captured.samples.begin(), captured.samples.end(), [](float sample) { return std::abs(sample - .5625f) < 1e-6f; }));
  std::puts("native PCM short writes, capture, playback and effects passed");
}
