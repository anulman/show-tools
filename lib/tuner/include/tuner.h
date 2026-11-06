#ifndef SHOW_TOOLS_TUNER_H
#define SHOW_TOOLS_TUNER_H
#include <array>
#include <cstdint>
namespace tuner {
enum class Scale : int { Major = 0, NaturalMinor = 1, Chromatic = 2 };
enum class PreviewKind : int { Silent = 0, Note = 1, Scale = 2 };
enum class PitchStatus : int { Off = 0, Microphone = 1, Warming = 2, Reference = 3, Unvoiced = 4, Pitched = 5 };
struct Target { int midi = 0; char letter = 'C'; int accidental = 0; int octave = -1; };
struct Detector {
  PitchStatus status = PitchStatus::Off;
  double frequency = 0, midi = 0, cents = 0, confidence = 0, rms = 0;
  int roundedMidi = 0;
  Target note{};
};
struct Snapshot {
  uint32_t commandRevision = 0;
  bool listening = false, complete = false;
  PreviewKind previewKind = PreviewKind::Silent;
  uint32_t previewStep = 0;
  int rootMidi = 48;
  Scale scale = Scale::Major;
  uint32_t step = 0, targetCount = 0;
  std::array<Target, 13> targets{};
  Detector detector{};
  uint64_t frameCount = 0;
};
class Engine {
 public:
  explicit Engine(double sampleRate);
  bool configure(int rootMidi, Scale scale);
  bool cue();
  bool playScale();
  bool confirm(uint32_t expectedRevision);
  bool setListening(bool listening);
  bool close();
  bool silence();
  bool microphoneLost();
  Snapshot snapshot() const;
  void process(const float* raw, float* left, float* right, uint32_t frames, bool microphoneReady);
 private:
  void plan();
  void beginPreview(PreviewKind kind, uint32_t step);
  void beginTone(uint32_t step);
  void stopPreview();
  void clearDetector(PitchStatus status);
  void analyze();
  PitchStatus idleStatus() const;
  double sampleRate_, detectorRate_;
  uint32_t downsample_, downsampleCount_ = 0;
  double downsampleSum_ = 0;
  Snapshot state_{};
  bool microphoneReady_ = false;
  std::array<double, 2048> ring_{};
  std::array<double, 256> difference_{};
  uint32_t ringWrite_ = 0, ringCount_ = 0, hop_ = 0;
  uint64_t cueFrame_ = 0, cueLength_, gapLength_, gateFrames_ = 0;
  double cuePhase_ = 0, cueIncrement_ = 0;
};
}
#endif
