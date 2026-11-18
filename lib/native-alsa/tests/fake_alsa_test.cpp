#include "alsa_pcm.h"
#include "usb_identity.h"
#include <alsa/asoundlib.h>
#include <cstdlib>
#include <cerrno>
#include <cmath>
#include <cstdint>
#include <string>

static void require(bool condition) { if (!condition) std::abort(); }

struct snd_pcm_t { int direction; int state; };
static snd_pcm_t* capture_pcm = nullptr;
static snd_pcm_t* playback_pcm = nullptr;
static int capture_drops = 0, playback_drops = 0, playback_drains = 0;
static bool async_drain = false;
struct snd_pcm_hw_params_t { int format; unsigned channels, rate; unsigned long period, buffer; };
static std::int32_t written[4];
static int capture_recoveries = 0, playback_recoveries = 0, recovery_error = 0;
static int close_count = 0;
static bool fail_playback = false;
static bool fail_capture = false;
static bool guarded = false;
static bool restore_failure = false;
static int pcm_reads = 0, pcm_writes = 0;
static bool mismatch_rate = false;
static int current_format = SND_PCM_FORMAT_S32_LE;
static int read_error = 0;
static int write_error = 0;
int snd_pcm_open(snd_pcm_t** pcm, const char* name, int direction, int mode) { require(mode == SND_PCM_NONBLOCK); if (guarded) require(std::string(name) == "hw:1,0"); if (direction == SND_PCM_STREAM_CAPTURE && fail_capture) return -EBUSY; if (direction == SND_PCM_STREAM_PLAYBACK && fail_playback) return -ENOENT; *pcm = new snd_pcm_t{direction, SND_PCM_STATE_SETUP}; if (direction == SND_PCM_STREAM_CAPTURE) capture_pcm = *pcm; else playback_pcm = *pcm; return 0; }
int snd_pcm_close(snd_pcm_t* pcm) { ++close_count; delete pcm; return 0; }
int snd_pcm_hw_params_malloc(snd_pcm_hw_params_t** p) { *p = new snd_pcm_hw_params_t; return 0; }
void snd_pcm_hw_params_free(snd_pcm_hw_params_t* p) { delete p; }
int snd_pcm_hw_params_any(snd_pcm_t*, snd_pcm_hw_params_t*) { return 0; }
int snd_pcm_hw_params_set_rate_resample(snd_pcm_t*, snd_pcm_hw_params_t*, unsigned enabled) { require(enabled == 0); return 0; }
int snd_pcm_hw_params_set_access(snd_pcm_t*, snd_pcm_hw_params_t*, int) { return 0; }
int snd_pcm_hw_params_set_format(snd_pcm_t*, snd_pcm_hw_params_t* p, int format) { p->format = current_format = format; return 0; }
int snd_pcm_hw_params_set_channels(snd_pcm_t*, snd_pcm_hw_params_t* p, unsigned n) { p->channels=n; return 0; }
int snd_pcm_hw_params_set_rate(snd_pcm_t*, snd_pcm_hw_params_t* p, unsigned n, int) { p->rate=n; return 0; }
int snd_pcm_hw_params_set_period_size(snd_pcm_t*, snd_pcm_hw_params_t* p, snd_pcm_uframes_t n, int) { p->period=n; return 0; }
int snd_pcm_hw_params_set_buffer_size(snd_pcm_t*, snd_pcm_hw_params_t* p, snd_pcm_uframes_t n) { p->buffer=n; return 0; }
int snd_pcm_hw_params(snd_pcm_t*, snd_pcm_hw_params_t*) { return 0; }
int snd_pcm_hw_params_current(snd_pcm_t*, snd_pcm_hw_params_t*) { return 0; }
int snd_pcm_hw_params_get_format(const snd_pcm_hw_params_t* p, snd_pcm_format_t* v) { *v=p->format; return 0; }
int snd_pcm_hw_params_get_channels(const snd_pcm_hw_params_t* p, unsigned* v) { *v=p->channels; return 0; }
int snd_pcm_hw_params_get_rate(const snd_pcm_hw_params_t* p, unsigned* v, int*) { *v=p->rate + (mismatch_rate ? 1 : 0); return 0; }
int snd_pcm_hw_params_get_period_size(const snd_pcm_hw_params_t* p, snd_pcm_uframes_t* v, int*) { *v=p->period; return 0; }
int snd_pcm_hw_params_get_buffer_size(const snd_pcm_hw_params_t* p, snd_pcm_uframes_t* v) { *v=p->buffer; return 0; }
snd_pcm_sframes_t snd_pcm_readi(snd_pcm_t*, void* data, snd_pcm_uframes_t) {
  ++pcm_reads;
  if (read_error) return read_error;
  if (current_format == SND_PCM_FORMAT_FLOAT_LE) { auto* v = static_cast<float*>(data); v[0] = 0; v[1] = 0.25f; }
  else { auto* v = static_cast<std::int32_t*>(data); v[0] = 0; v[1] = 1073741824; }
  return 1;
}
snd_pcm_sframes_t snd_pcm_writei(snd_pcm_t*, const void* data, snd_pcm_uframes_t) {
  ++pcm_writes;
  if (write_error) return write_error;
  if (current_format == SND_PCM_FORMAT_FLOAT_LE) require(static_cast<const float*>(data)[1] == 0.5f);
  else { auto* v = static_cast<const std::int32_t*>(data); for (int i = 0; i < 4; ++i) written[i] = v[i]; }
  return 1;
}
int snd_pcm_recover(snd_pcm_t* pcm, int error, int silent) {
  require(error == -EPIPE && silent == 1);
  if (pcm == capture_pcm) ++capture_recoveries;
  else if (pcm == playback_pcm) ++playback_recoveries;
  else std::abort();
  return recovery_error;
}
int snd_pcm_drop(snd_pcm_t* pcm) { pcm->state = SND_PCM_STATE_SETUP; if (pcm->direction == SND_PCM_STREAM_CAPTURE) ++capture_drops; else ++playback_drops; return 0; }
int snd_pcm_drain(snd_pcm_t* pcm) { require(pcm == playback_pcm && capture_pcm->state == SND_PCM_STATE_SETUP); ++playback_drains; pcm->state = async_drain ? SND_PCM_STATE_DRAINING : SND_PCM_STATE_SETUP; return async_drain ? -EAGAIN : 0; }
int snd_pcm_nonblock(snd_pcm_t*, int mode) { return restore_failure && mode == 0 ? -EIO : 0; }
snd_pcm_state_t snd_pcm_state(snd_pcm_t* pcm) { return pcm->state; }
int snd_pcm_prepare(snd_pcm_t* pcm) { if (pcm->state == SND_PCM_STATE_RUNNING || pcm->state == SND_PCM_STATE_DRAINING) return -EBUSY; pcm->state = SND_PCM_STATE_SETUP; return 0; }
const char* snd_strerror(int) { return "fake failure"; }

struct snd_pcm_info_t { int card; unsigned device; int stream; };
struct snd_ctl_t {};
struct snd_ctl_card_info_t {};
static bool wrong_pcm_type = false, wrong_control_card = false;
struct snd_ctl_elem_info_t { int iface; std::string name; unsigned index; };
struct snd_ctl_elem_value_t { int iface; std::string name; unsigned index; };
static native_alsa::detail::UsbDeviceFacts facts{1, "USB", "Y7PZ8TB58373E7", "1235", "8211", "usb1/1-10:1:3"};
static int inspect_calls = 0, info_calls = 0, disconnect_after = 0;
static bool inspect_failure = false, mapping_drift = false, playback_wrong_card = false, wrong_device = false;
static bool missing_monitor = false, monitor_enabled = false, monitor_wrong_type = false, monitor_wrong_count = false, monitor_read_error = false;
static int monitor_reads = 0, enable_monitor_after = 0, controls_open = 0;
namespace native_alsa::detail {
std::optional<UsbDeviceFacts> inspect_usb_device(const UsbIdentity&, std::string& error) {
  ++inspect_calls;
  if (inspect_failure) { error = "Missing USB identity metadata"; return std::nullopt; }
  auto result = facts;
  if (mapping_drift && inspect_calls > 1) result.instance += "replaced";
  return result;
}
}
int snd_pcm_type(snd_pcm_t*) { return wrong_pcm_type ? 1 : SND_PCM_TYPE_HW; }
int snd_ctl_type(snd_ctl_t*) { return SND_CTL_TYPE_HW; }
int snd_ctl_card_info_malloc(snd_ctl_card_info_t** info) { *info = new snd_ctl_card_info_t; return 0; }
void snd_ctl_card_info_free(snd_ctl_card_info_t* info) { delete info; }
int snd_ctl_card_info(snd_ctl_t*, snd_ctl_card_info_t*) { return 0; }
int snd_ctl_card_info_get_card(const snd_ctl_card_info_t*) { return wrong_control_card ? 2 : 1; }
const char* snd_ctl_card_info_get_id(const snd_ctl_card_info_t*) { return "USB"; }
int snd_pcm_info_malloc(snd_pcm_info_t** info) { *info = new snd_pcm_info_t; return 0; }
void snd_pcm_info_free(snd_pcm_info_t* info) { delete info; }
int snd_pcm_info(snd_pcm_t* pcm, snd_pcm_info_t* info) {
  ++info_calls;
  if (disconnect_after && info_calls >= disconnect_after) return -ENODEV;
  *info = {pcm->direction == SND_PCM_STREAM_PLAYBACK && playback_wrong_card ? 2 : 1, wrong_device ? 1u : 0u, pcm->direction};
  return 0;
}
int snd_pcm_info_get_card(const snd_pcm_info_t* info) { return info->card; }
unsigned snd_pcm_info_get_device(const snd_pcm_info_t* info) { return info->device; }
int snd_pcm_info_get_stream(const snd_pcm_info_t* info) { return info->stream; }
int snd_ctl_open(snd_ctl_t** ctl, const char* name, int mode) { require(std::string(name) == "hw:1" && mode == (SND_CTL_READONLY | SND_CTL_NONBLOCK)); *ctl = new snd_ctl_t; ++controls_open; return 0; }
int snd_ctl_close(snd_ctl_t* ctl) { --controls_open; delete ctl; return 0; }
int snd_ctl_elem_info_malloc(snd_ctl_elem_info_t** info) { *info = new snd_ctl_elem_info_t; return 0; }
void snd_ctl_elem_info_free(snd_ctl_elem_info_t* info) { delete info; }
void snd_ctl_elem_info_set_interface(snd_ctl_elem_info_t* info, int iface) { info->iface = iface; }
void snd_ctl_elem_info_set_name(snd_ctl_elem_info_t* info, const char* name) { info->name = name; }
void snd_ctl_elem_info_set_index(snd_ctl_elem_info_t* info, unsigned index) { info->index = index; }
int snd_ctl_elem_info(snd_ctl_t*, snd_ctl_elem_info_t* info) { require(info->iface == SND_CTL_ELEM_IFACE_MIXER && info->name == "Direct Monitor Playback Switch" && info->index == 0); return missing_monitor ? -ENOENT : 0; }
int snd_ctl_elem_info_get_type(const snd_ctl_elem_info_t*) { return monitor_wrong_type ? 2 : SND_CTL_ELEM_TYPE_BOOLEAN; }
unsigned snd_ctl_elem_info_get_count(const snd_ctl_elem_info_t*) { return monitor_wrong_count ? 2 : 1; }
int snd_ctl_elem_value_malloc(snd_ctl_elem_value_t** value) { *value = new snd_ctl_elem_value_t; return 0; }
void snd_ctl_elem_value_free(snd_ctl_elem_value_t* value) { delete value; }
void snd_ctl_elem_value_set_interface(snd_ctl_elem_value_t* value, int iface) { value->iface = iface; }
void snd_ctl_elem_value_set_name(snd_ctl_elem_value_t* value, const char* name) { value->name = name; }
void snd_ctl_elem_value_set_index(snd_ctl_elem_value_t* value, unsigned index) { value->index = index; }
int snd_ctl_elem_read(snd_ctl_t*, snd_ctl_elem_value_t* value) { require(value->iface == SND_CTL_ELEM_IFACE_MIXER && value->name == "Direct Monitor Playback Switch" && value->index == 0); ++monitor_reads; return monitor_read_error ? -EIO : 0; }
long snd_ctl_elem_value_get_boolean(const snd_ctl_elem_value_t*, unsigned index) { require(index == 0); return monitor_enabled || (enable_monitor_after && monitor_reads >= enable_monitor_after); }


int main() {
  native_alsa::Config config{"capture", "playback", 48000, 2, 1, 64, 256, 256, native_alsa::SampleFormat::S32LE};
  std::string error;
  fail_playback = true;
  require(!native_alsa::AlsaPcm::open(config, error));
  require(close_count == 1 && error == "fake failure");
  fail_playback = false;
  mismatch_rate = true;
  require(!native_alsa::AlsaPcm::open(config, error));
  mismatch_rate = false;
  auto pcm = native_alsa::AlsaPcm::open(config, error);
  require(pcm && error.empty());
  require(pcm->capture_parameters().sample_rate == 48000 && pcm->playback_parameters().channels == 2);
  float input[2] = {};
  require(pcm->read(input, 2) == 1 && input[0] == 0.5f);
  float output[] = {-1.0f, 0.5f, 1.0f, -0.5f};
  require(pcm->write(output, 2) == 1);
  require(written[0] == INT32_MIN && written[1] == 1073741824 && written[2] == INT32_MAX && written[3] == -1073741824);
  require(pcm->read(input, 257) == -EINVAL);
  require(pcm->write(output, 257) == -EINVAL);
  read_error = -EPIPE; write_error = -EPIPE;
  require(pcm->read(input, 2) == 0 && input[0] == 0.5f);
  require(pcm->write(output, 2) == 0);
  require(capture_recoveries == 1 && playback_recoveries == 1);
  require(pcm->read(input, 2) == -EPIPE && pcm->write(output, 2) == -EPIPE);
  require(capture_recoveries == 1 && playback_recoveries == 1);
  read_error = 0; write_error = 0;
  require(pcm->read(input, 2) == 1 && pcm->write(output, 2) == 1);
  read_error = -ENODEV; write_error = -EPIPE; recovery_error = -ENODEV;
  require(pcm->read(input, 2) == -ENODEV && pcm->write(output, 2) == -ENODEV);
  require(capture_recoveries == 1 && playback_recoveries == 2);
  recovery_error = 0;
  require(pcm->drop() == 0 && pcm->prepare() == 0);
  read_error = -EPIPE;
  require(pcm->read(input, 2) == 0 && pcm->write(output, 2) == 0);
  require(capture_recoveries == 2 && playback_recoveries == 3);
  capture_pcm->state = playback_pcm->state = SND_PCM_STATE_RUNNING;
  require(pcm->prepare() == -EBUSY);
  async_drain = true;
  const int capture_before = capture_drops, playback_before = playback_drops;
  require(pcm->finish() == 1 && capture_drops == capture_before + 1 && playback_drops == playback_before && playback_drains == 1);
  require(pcm->finish() == 1 && playback_drains == 1);
  playback_pcm->state = SND_PCM_STATE_SETUP;
  require(pcm->finish() == 0 && playback_drains == 1);
  require(pcm->prepare() == 0);
  capture_pcm->state = playback_pcm->state = SND_PCM_STATE_RUNNING;
  require(pcm->finish() == 1);
  require(pcm->drop() == 0 && playback_drops == playback_before + 1);
  require(pcm->prepare() == 0);
  pcm.reset();
  require(close_count == 5);
  read_error = 0; write_error = 0;
  config.format = native_alsa::SampleFormat::FloatLE;
  pcm = native_alsa::AlsaPcm::open(config, error);
  require(pcm && pcm->read(input, 2) == 1 && input[0] == 0.25f);
  require(pcm->write(output, 2) == 1);
  pcm.reset();
  guarded = true;
  config.capture_device = config.playback_device = "hw:CARD=USB,DEV=0";
  config.identity = native_alsa::UsbIdentity{"/dev/snd/by-id/usb-Focusrite_Scarlett_Solo_USB_Y7PZ8TB58373E7-00", "Y7PZ8TB58373E7", "1235", "8211", "USB", 0, "Direct Monitor Playback Switch"};
  const int reads_before_identity_checks = pcm_reads, writes_before_identity_checks = pcm_writes;
  const auto no_io = [&] {
    require(pcm_reads == reads_before_identity_checks && pcm_writes == writes_before_identity_checks && controls_open == 0);
  };
  const auto rejected = [&](int closed) {
    inspect_calls = info_calls = monitor_reads = 0;
    const int before = close_count;
    error.clear();
    require(!native_alsa::AlsaPcm::open(config, error) && !error.empty());
    require(close_count == before + closed);
    no_io();
  };
  const auto original = facts;
  for (auto* field : {&facts.serial, &facts.vendor, &facts.product, &facts.card_id}) {
    const auto before = *field; *field = "wrong"; rejected(0); *field = before;
  }
  inspect_failure = true; rejected(0); inspect_failure = false;
  missing_monitor = true; rejected(0); missing_monitor = false;
  monitor_enabled = true; rejected(0); monitor_enabled = false;
  monitor_wrong_type = true; rejected(0); monitor_wrong_type = false;
  monitor_wrong_count = true; rejected(0); monitor_wrong_count = false;
  monitor_read_error = true; rejected(0); monitor_read_error = false;
  wrong_control_card = true; rejected(0); wrong_control_card = false;
  wrong_pcm_type = true; rejected(2); wrong_pcm_type = false;
  fail_capture = true; rejected(0); fail_capture = false;
  fail_playback = true; rejected(1); fail_playback = false;
  playback_wrong_card = true; rejected(2); playback_wrong_card = false;
  wrong_device = true; rejected(2); wrong_device = false;
  mapping_drift = true; rejected(2); mapping_drift = false;
  enable_monitor_after = 2; rejected(2); enable_monitor_after = 0;
  disconnect_after = 3; rejected(2); disconnect_after = 0;
  restore_failure = true; rejected(2); restore_failure = false;
  inspect_calls = info_calls = monitor_reads = 0;
  pcm = native_alsa::AlsaPcm::open(config, error);
  require(pcm && inspect_calls == 2 && info_calls == 6 && monitor_reads == 2);
  no_io();
  pcm.reset();
  facts.serial = "replacement";
  rejected(0);
  facts = original;
  pcm = native_alsa::AlsaPcm::open(config, error);
  require(bool(pcm));
  no_io();
}
