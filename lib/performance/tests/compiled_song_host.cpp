#include "performance_engine.h"
#include <algorithm>
#include <array>
#include <charconv>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace {
constexpr uint32_t block_frames = 1024;
struct Press { uint64_t frame; int button; double value; };
struct Stem {
  double energy = 0, sum = 0, peak = 0;
  uint64_t nonzero = 0;
  bool append(float sample) {
    double value = sample;
    if (!std::isfinite(value)) return false;
    energy += value * value; sum += value;
    peak = std::max(peak, std::abs(value)); nonzero += value != 0;
    return true;
  }
};
int fail(const std::string& message) { std::cerr << message << '\n'; return 1; }
bool number(std::string_view text, uint64_t& value) {
  if (text.empty()) return false;
  const auto parsed = std::from_chars(text.data(), text.data() + text.size(), value);
  return parsed.ec == std::errc{} && parsed.ptr == text.data() + text.size();
}
double field(const std::vector<uint8_t>& bytes, size_t index) {
  uint64_t bits = 0;
  for (unsigned byte = 0; byte < 8; ++byte) bits |= uint64_t(bytes[index * 8 + byte]) << (byte * 8);
  double value; std::memcpy(&value, &bits, sizeof(value)); return value;
}
struct Events {
  uint64_t count = 0, tempo_hits = 0;
  std::array<double, 64 * PF_EVENT_FIELDS> buffer{};
  bool drain(pf_engine* engine) {
    uint32_t available;
    do {
      available = pf_drain_events(engine, buffer.data(), 64);
      for (uint32_t index = 0; index < available; ++index) {
        const double* row = buffer.data() + index * PF_EVENT_FIELDS; ++count;
        if (row[PF_EVENT_TYPE] == PF_TEMPO_HIT) ++tempo_hits;
        if (row[PF_EVENT_TYPE] == PF_FAULT || (row[PF_EVENT_TYPE] == PF_CONTROL && row[PF_EVENT_APPLIED] == 0)) {
          std::cerr << "native event failure at frame " << std::setprecision(17) << row[PF_EVENT_FRAME]
                    << ": " << pf_message(int(row[PF_EVENT_ERROR])) << '\n';
          return false;
        }
      }
    } while (available == 64);
    return true;
  }
};
}

int main(int argc, char** argv) {
  if (argc != 4) return fail("Usage: compiled_song_host program.pfp presses.tsv sampleRate");
  uint64_t sample_rate = 0;
  if (!number(argv[3], sample_rate) || sample_rate < 8000 || sample_rate > 192000) return fail("sampleRate must be an integer from 8000 through 192000");
  const uint64_t max_frames = sample_rate * 500;
  std::ifstream artifact(argv[1], std::ios::binary | std::ios::ate);
  if (!artifact) return fail("Could not open portable program");
  const auto size = artifact.tellg();
  if (size < PF_COMPILED_HEADER_FIELDS * 8 || size > 200000 * 8 || size % 8) return fail("Invalid portable program byte length");
  std::vector<uint8_t> bytes(static_cast<size_t>(size)); artifact.seekg(0);
  if (!artifact.read(reinterpret_cast<char*>(bytes.data()), size)) return fail("Could not read portable program");
  double take_count = field(bytes, 8);
  if (!std::isfinite(take_count) || take_count < 0 || take_count > PF_COMPILED_MAX_TAKES || std::floor(take_count) != take_count) return fail("Invalid portable take count");
  std::ifstream script(argv[2]);
  if (!script) return fail("Could not open press script");
  std::vector<Press> presses;
  std::string line;
  uint64_t line_number = 0;
  while (std::getline(script, line)) {
    ++line_number;
    if (!line.empty() && line.back() == '\r') line.pop_back();
    const size_t tab = line.find('\t');
    const size_t value_tab = tab == std::string::npos ? std::string::npos : line.find('\t', tab + 1);
    uint64_t frame = 0, button = 0; double value = 0;
    bool valid_value = true;
    if (value_tab != std::string::npos) {
      const std::string_view text = std::string_view(line).substr(value_tab + 1);
      const auto parsed = std::from_chars(text.data(), text.data() + text.size(), value);
      valid_value = !text.empty() && parsed.ec == std::errc{} && parsed.ptr == text.data() + text.size() && std::isfinite(value);
    }
    if (tab == std::string::npos || !valid_value
      || !number(std::string_view(line).substr(0, tab), frame) || !number(std::string_view(line).substr(tab + 1, value_tab == std::string::npos ? value_tab : value_tab - tab - 1), button)
      || (button >= PF_CHANNELS && button != 5) || (button != 5 && value != 0) || frame >= max_frames || (!presses.empty() && frame < presses.back().frame)) {
      return fail("Invalid or unsorted press script at line " + std::to_string(line_number));
    }
    presses.push_back({frame, int(button), value});
  }
  if (!script.eof()) return fail("Could not read press script");
  std::unique_ptr<pf_engine, decltype(&pf_destroy)> engine(pf_create(double(sample_rate), PF_PRACTICE, 32, 30, 4), pf_destroy);
  if (!engine) return fail("Could not create performance engine");
  const pf_effect_definition slapback{PF_EFFECT_SLAPBACK, 1, {{100, 0, .25}}};
  pf_effect_definition chorus{}; chorus.type = PF_EFFECT_CHORUS; chorus.version = 1;
  chorus.parameters.chorus = {.8, 5, 20, .35};
  std::array<pf_effect_definition, PF_VOICE_PROFILES + 1> effects{}; effects.fill(slapback); effects.back() = chorus;
  std::array<uint32_t, PF_VOICE_PROFILES> counts{}, revisions{}; counts.fill(1); counts[PF_BACKUP_PROFILE] = 2; revisions.fill(1);
  if (pf_prepare_voice_effects(engine.get(), effects.data(), counts.data(), revisions.data()) < 0
    || pf_load_compiled_bytes(engine.get(), bytes.data(), uint32_t(bytes.size())) < 0) return fail(pf_error(engine.get()));
  std::array<double, PF_FIELDS> snapshot{}; pf_snapshot(engine.get(), snapshot.data());
  if (pf_set_microphone(engine.get(), 1) < 0 || pf_set_click(engine.get(), 0) < 0 || pf_set_click_gain(engine.get(), 0) < 0
    || pf_start(engine.get(), snapshot[PF_BPM], 1, 1, int(snapshot[PF_BAR_COUNT]), 0, 0) < 0) return fail(pf_error(engine.get()));
  Events events;
  if (!events.drain(engine.get())) return 1;
  std::array<float, block_frames> input{};
  std::array<std::array<float, block_frames>, 4> output{};
  std::array<Stem, 4> stems{};
  uint64_t frame = 0;
  uint64_t rotations = 0;
  size_t next_press = 0;
  auto process = [&](uint32_t frames, bool must_be_silent) {
    for (uint32_t offset = 0; offset < frames; ++offset) input[offset] = float((int((frame + offset) % 97) - 48) / 256.0);
    for (auto& channel : output) channel.fill(0);
    if (pf_process_stems(engine.get(), input.data(), output[0].data(), output[1].data(), output[2].data(), output[3].data(), frames) < 0) {
      std::cerr << "process rejected at frame " << frame << ": " << pf_error(engine.get()) << '\n'; return false;
    }
    for (size_t stem = 0; stem < stems.size(); ++stem) for (uint32_t offset = 0; offset < frames; ++offset) {
      if (!stems[stem].append(output[stem][offset])) { std::cerr << "Nonfinite output\n"; return false; }
      if (must_be_silent && output[stem][offset] != 0) { std::cerr << "Output remains audible after ENDED\n"; return false; }
    }
    frame += frames;
    return events.drain(engine.get());
  };
  for (;;) {
    pf_snapshot(engine.get(), snapshot.data());
    if (snapshot[PF_PHASE] == PF_ENDED) break;
    if (snapshot[PF_PHASE] != PF_COUNT_IN && snapshot[PF_PHASE] != PF_PLAYING) return fail("Transport stopped before ENDED");
    if (frame >= max_frames) return fail("Performance exceeded the 500 second fixture guard");
    while (next_press < presses.size() && presses[next_press].frame == frame) {
      if (pf_control(engine.get(), presses[next_press].button, presses[next_press].value, nullptr, 0) < 0) return fail("Press rejected at frame " + std::to_string(frame) + ": " + pf_error(engine.get()));
      if (presses[next_press].button == 5 && presses[next_press].value != 0) {
        std::array<double, PF_VOICE_FIELDS> backup{}; pf_voice_info(engine.get(), PF_BACKUP_PROFILE, backup.data());
        if (backup[PF_VOICE_ROTATION_ELIGIBLE] != 1 || backup[PF_VOICE_ROTATION_REMAINING] <= .49) return fail("Rotation did not activate at frame " + std::to_string(frame));
        ++rotations;
      }
      ++next_press;
      if (!events.drain(engine.get())) return 1;
    }
    uint64_t count = std::min<uint64_t>(block_frames, max_frames - frame);
    if (next_press < presses.size()) count = std::min(count, presses[next_press].frame - frame);
    if (!count || !process(uint32_t(count), false)) return fail("Could not advance fixture audio");
  }
  if (next_press != presses.size()) return fail("Press script extends beyond ENDED");
  if (!process(128, true)) return 1;
  pf_snapshot(engine.get(), snapshot.data());
  std::cout << std::setprecision(17) << "{\"frames\":" << frame << ",\"phase\":" << snapshot[PF_PHASE]
            << ",\"bpm\":" << snapshot[PF_BPM] << ",\"tempoHits\":" << events.tempo_hits << ",\"events\":" << events.count << ",\"rotations\":" << rotations << ",\"takes\":[";
  for (uint32_t id = 0; id < uint32_t(take_count); ++id) {
    std::array<double, PF_TAKE_FIELDS> take{}; pf_compiled_take_info(engine.get(), id, take.data());
    if (id) std::cout << ',';
    std::cout << "{\"voice\":" << take[PF_TAKE_VOICE] << ",\"ready\":" << take[PF_TAKE_READY]
              << ",\"frames\":" << take[PF_TAKE_LENGTH] << ",\"period\":" << take[PF_TAKE_PERIOD] << ",\"revision\":" << take[PF_TAKE_REVISION] << '}';
  }
  std::cout << "],\"stems\":[";
  for (size_t id = 0; id < stems.size(); ++id) {
    if (id) std::cout << ',';
    std::cout << "{\"energy\":" << stems[id].energy << ",\"sum\":" << stems[id].sum
              << ",\"peak\":" << stems[id].peak << ",\"nonzero\":" << stems[id].nonzero << '}';
  }
  std::cout << "]}\n";
}
