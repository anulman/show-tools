#include "alsa_pcm.h"
#include <cstdlib>
#include <string>

static void require(bool condition) { if (!condition) std::abort(); }

int main() {
  native_alsa::Config config{"", "", 0, 0, 0, 0, 0, 0, native_alsa::SampleFormat::S32LE};
  std::string error;
  require(!native_alsa::AlsaPcm::open(config, error));
  require(!error.empty());
  config = {"capture", "playback", 48000, 2, 2, 64, 256, 256, native_alsa::SampleFormat::S32LE};
  require(!native_alsa::AlsaPcm::open(config, error));
  require(error == "Invalid explicit ALSA configuration");
}
