#include "alsa_pcm.h"
#include <cassert>
#include <string>

int main() {
  native_alsa::Config config{"", "", 0, 0, 0, 0, 0, 0, native_alsa::SampleFormat::S32LE};
  std::string error;
  assert(!native_alsa::AlsaPcm::open(config, error));
  assert(!error.empty());
  config = {"capture", "playback", 48000, 2, 2, 64, 256, 256, native_alsa::SampleFormat::S32LE};
  assert(!native_alsa::AlsaPcm::open(config, error));
  assert(error == "Invalid explicit ALSA configuration");
}
