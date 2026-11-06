#include "alsa_pcm.h"
#include <alsa/asoundlib.h>
#include <cassert>
#include <cerrno>
#include <cmath>
#include <cstdint>
#include <string>

struct snd_pcm_t { int direction; };
struct snd_pcm_hw_params_t {};
static std::int32_t written[4];
static int recovery_calls = 0;
static int close_count = 0;
static bool fail_playback = false;
static int current_format = SND_PCM_FORMAT_S32_LE;
static int read_error = 0;
static int write_error = 0;
int snd_pcm_open(snd_pcm_t** pcm, const char*, int direction, int) { if (direction == SND_PCM_STREAM_PLAYBACK && fail_playback) return -ENOENT; *pcm = new snd_pcm_t{direction}; return 0; }
int snd_pcm_close(snd_pcm_t* pcm) { ++close_count; delete pcm; return 0; }
int snd_pcm_hw_params_malloc(snd_pcm_hw_params_t** p) { *p = new snd_pcm_hw_params_t; return 0; }
void snd_pcm_hw_params_free(snd_pcm_hw_params_t* p) { delete p; }
int snd_pcm_hw_params_any(snd_pcm_t*, snd_pcm_hw_params_t*) { return 0; }
int snd_pcm_hw_params_set_rate_resample(snd_pcm_t*, snd_pcm_hw_params_t*, unsigned enabled) { assert(enabled == 0); return 0; }
int snd_pcm_hw_params_set_access(snd_pcm_t*, snd_pcm_hw_params_t*, int) { return 0; }
int snd_pcm_hw_params_set_format(snd_pcm_t*, snd_pcm_hw_params_t*, int format) { current_format = format; return 0; }
int snd_pcm_hw_params_set_channels(snd_pcm_t*, snd_pcm_hw_params_t*, unsigned) { return 0; }
int snd_pcm_hw_params_set_rate(snd_pcm_t*, snd_pcm_hw_params_t*, unsigned, int) { return 0; }
int snd_pcm_hw_params_set_period_size(snd_pcm_t*, snd_pcm_hw_params_t*, snd_pcm_uframes_t, int) { return 0; }
int snd_pcm_hw_params_set_buffer_size(snd_pcm_t*, snd_pcm_hw_params_t*, snd_pcm_uframes_t) { return 0; }
int snd_pcm_hw_params(snd_pcm_t*, snd_pcm_hw_params_t*) { return 0; }
snd_pcm_sframes_t snd_pcm_readi(snd_pcm_t*, void* data, snd_pcm_uframes_t) {
  if (read_error) return read_error;
  if (current_format == SND_PCM_FORMAT_FLOAT_LE) { auto* v = static_cast<float*>(data); v[0] = 0; v[1] = 0.25f; }
  else { auto* v = static_cast<std::int32_t*>(data); v[0] = 0; v[1] = 1073741824; }
  return 1;
}
snd_pcm_sframes_t snd_pcm_writei(snd_pcm_t*, const void* data, snd_pcm_uframes_t) {
  if (write_error) return write_error;
  if (current_format == SND_PCM_FORMAT_FLOAT_LE) assert(static_cast<const float*>(data)[1] == 0.5f);
  else { auto* v = static_cast<const std::int32_t*>(data); for (int i = 0; i < 4; ++i) written[i] = v[i]; }
  return 1;
}
int snd_pcm_recover(snd_pcm_t*, int, int) { ++recovery_calls; return 0; }
int snd_pcm_drop(snd_pcm_t*) { return 0; }
int snd_pcm_prepare(snd_pcm_t*) { return 0; }
const char* snd_strerror(int) { return "fake failure"; }

int main() {
  native_alsa::Config config{"capture", "playback", 48000, 2, 1, 64, 256, 256, native_alsa::SampleFormat::S32LE};
  std::string error;
  fail_playback = true;
  assert(!native_alsa::AlsaPcm::open(config, error));
  assert(close_count == 1 && error == "fake failure");
  fail_playback = false;
  auto pcm = native_alsa::AlsaPcm::open(config, error);
  assert(pcm && error.empty());
  float input[2] = {};
  assert(pcm->read(input, 2) == 1 && input[0] == 0.5f);
  float output[] = {-1.0f, 0.5f, 1.0f, -0.5f};
  assert(pcm->write(output, 2) == 1);
  assert(written[0] == INT32_MIN && written[1] == 1073741824 && written[2] == INT32_MAX && written[3] == -1073741824);
  assert(pcm->read(input, 257) == -EINVAL);
  assert(pcm->write(output, 257) == -EINVAL);
  read_error = -EPIPE; write_error = -EPIPE;
  assert(pcm->read(input, 2) == -EPIPE && pcm->write(output, 2) == -EPIPE);
  assert(recovery_calls == 0);
  assert(pcm->recover(native_alsa::Direction::Capture, -EPIPE) == 0 && recovery_calls == 1);
  assert(pcm->drop() == 0 && pcm->prepare() == 0);
  pcm.reset();
  assert(close_count == 3);
  read_error = 0; write_error = 0;
  config.format = native_alsa::SampleFormat::FloatLE;
  pcm = native_alsa::AlsaPcm::open(config, error);
  assert(pcm && pcm->read(input, 2) == 1 && input[0] == 0.25f);
  assert(pcm->write(output, 2) == 1);
}
