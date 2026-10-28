#include "probe.h"
#include "led_output.h"
#include "peripheral_controls.h"
#include <linux/hidraw.h>
#include <linux/input.h>
#include <sys/ioctl.h>
#include <fcntl.h>
#include <poll.h>
#include <unistd.h>
#include <array>
#include <cerrno>
#include <csignal>
#include <cstring>
#include <filesystem>
#include <iostream>

namespace peripheral_probe {
namespace {
volatile std::sig_atomic_t running = 1;
void stop(int) { running = 0; }
struct File {
  int value;
  ~File() { if (value >= 0) close(value); }
};
bool input_info(int fd, input_id& info) { return ioctl(fd, EVIOCGID, &info) >= 0 && info.vendor == 0xd209; }
bool raw_info(int fd, hidraw_devinfo& info) { return ioctl(fd, HIDIOCGRAWINFO, &info) >= 0 && uint16_t(info.vendor) == 0xd209; }
bool descriptor(int fd, hidraw_report_descriptor& out) {
  int size = 0;
  if (ioctl(fd, HIDIOCGRDESCSIZE, &size) < 0 || size <= 0 || unsigned(size) > sizeof(out.value)) return false;
  out.size = unsigned(size);
  return ioctl(fd, HIDIOCGRDESC, &out) >= 0;
}
void key_snapshot(int fd) {
  std::array<uint8_t, (KEY_MAX + 8) / 8> keys{};
  if (ioctl(fd, EVIOCGKEY(keys.size()), keys.data()) < 0) { std::cerr << "Cannot read key-state snapshot.\n"; return; }
  std::cout << "{\"type\":\"key-snapshot\",\"allOtherCodesReleased\":true,\"held\":[";
  bool first = true;
  for (unsigned code = 0; code <= KEY_MAX; ++code) if (keys[code / 8] & (1 << (code % 8))) {
    std::cout << (first ? "" : ",") << code; first = false;
  }
  std::cout << "]}" << std::endl;
}
void describe(const std::filesystem::path& path, bool raw) {
  File file{open(path.c_str(), O_RDONLY | O_NONBLOCK)};
  if (file.value < 0) { if (errno == EACCES) std::cerr << "Cannot inspect " << path << ": permission denied.\n"; return; }
  char name[512]{};
  if (raw) {
    hidraw_devinfo info{};
    if (!raw_info(file.value, info)) return;
    ioctl(file.value, HIDIOCGRAWNAME(sizeof(name)), name);
    name[sizeof(name) - 1] = 0;
    hidraw_report_descriptor report{};
    bool available = descriptor(file.value, report);
    std::cout << "{\"type\":\"device\",\"platform\":\"linux-hidraw\",\"device\":" << quote(path.string())
      << ",\"name\":" << quote(name) << ",\"vendor\":" << uint16_t(info.vendor) << ",\"product\":" << uint16_t(info.product)
      << ",\"supportedLedReport\":" << (available && pp_ipac_led_descriptor(report.value, report.size) == 1 ? "true" : "false")
      << ",\"reportDescriptor\":\"";
    const char* hex = "0123456789abcdef";
    if (available) for (uint32_t i = 0; i < report.size; ++i) std::cout << hex[report.value[i] >> 4] << hex[report.value[i] & 15];
    std::cout << "\"}" << std::endl;
  } else {
    input_id info{};
    if (!input_info(file.value, info)) return;
    ioctl(file.value, EVIOCGNAME(sizeof(name)), name);
    name[sizeof(name) - 1] = 0;
    std::cout << "{\"type\":\"device\",\"platform\":\"linux-evdev\",\"device\":" << quote(path.string())
      << ",\"name\":" << quote(name) << ",\"vendor\":" << info.vendor << ",\"product\":" << info.product << "}" << std::endl;
  }
}
}

int run(const Request& request) {
  if (request.mode == Mode::list) {
    std::error_code error;
    for (const auto& entry : std::filesystem::directory_iterator("/dev/input", error))
      if (entry.path().filename().string().rfind("event", 0) == 0) describe(entry.path(), false);
    error.clear();
    for (const auto& entry : std::filesystem::directory_iterator("/dev", error))
      if (entry.path().filename().string().rfind("hidraw", 0) == 0) describe(entry.path(), true);
    return 0;
  }
  bool raw = led_mode(request.mode);
  if ((raw && request.device.rfind("/dev/hidraw", 0) != 0) || (!raw && request.device.rfind("/dev/input/event", 0) != 0)) {
    std::cerr << "Select an exact listed " << (raw ? "hidraw" : "event") << " path.\n"; return 2;
  }
  File file{open(request.device.c_str(), raw ? O_WRONLY : O_RDONLY | O_NONBLOCK)};
  if (file.value < 0) { std::cerr << "Cannot open selected device: " << std::strerror(errno) << ". Check device permissions.\n"; return 1; }
  if (raw) {
    hidraw_devinfo info{};
    hidraw_report_descriptor report{};
    if (!raw_info(file.value, info) || uint16_t(info.product) < 0x0410 || uint16_t(info.product) > 0x0413 ||
        !descriptor(file.value, report) || pp_ipac_led_descriptor(report.value, report.size) != 1) {
      std::cerr << "Selected device does not expose the supported I-PAC LED report. Nothing written.\n"; return 1;
    }
    return write_led_output(request, [&](const uint8_t* bytes, size_t size) {
      auto sent = write(file.value, bytes, size);
      if (sent != ssize_t(size)) std::cerr << "LED write failed or was short: " << std::strerror(errno) << '\n';
      return sent == ssize_t(size);
    });
  }
  input_id info{};
  if (!input_info(file.value, info)) { std::cerr << "Selected event device is not Ultimarc.\n"; return 1; }
  key_snapshot(file.value);
  std::signal(SIGINT, stop); std::signal(SIGTERM, stop);
  bool dropped = false, disconnected = false;
  uint64_t sequence = 0;
  std::cerr << "Listening without exclusive grab. Ctrl-C stops. No LED writes.\n";
  while (running) {
    pollfd ready{file.value, POLLIN, 0};
    int status = poll(&ready, 1, -1);
    if (status < 0 && errno == EINTR) continue;
    if (status < 0) { std::cout << "{\"type\":\"error\",\"reason\":\"poll\"}" << std::endl; std::cerr << "Input poll failed: " << std::strerror(errno) << '\n'; return 1; }
    if (ready.revents & (POLLHUP | POLLERR | POLLNVAL)) { disconnected = true; break; }
    input_event event{};
    auto size = read(file.value, &event, sizeof(event));
    if (size < 0 && (errno == EAGAIN || errno == EINTR)) continue;
    if (size == 0 || (size < 0 && errno == ENODEV)) { disconnected = true; break; }
    if (size != ssize_t(sizeof(event))) { std::cout << "{\"type\":\"error\",\"reason\":\"read\"}" << std::endl; std::cerr << "Input read failed or returned a partial event.\n"; return 1; }
    if (event.type == EV_SYN && event.code == SYN_DROPPED) {
      dropped = true;
      std::cout << "{\"type\":\"gap\",\"reason\":\"SYN_DROPPED\",\"lostRotationUnrecoverable\":true}" << std::endl;
      continue;
    }
    if (dropped) {
      if (event.type == EV_SYN && event.code == SYN_REPORT) { key_snapshot(file.value); dropped = false; }
      continue;
    }
    std::cout << "{\"type\":\"input\",\"platform\":\"linux-evdev\",\"device\":" << quote(request.device)
      << ",\"sequence\":" << sequence++ << ",\"hostTimeNs\":" << quote(std::to_string(host_time_ns()))
      << ",\"deviceSeconds\":" << event.time.tv_sec << ",\"deviceMicroseconds\":" << event.time.tv_usec
      << ",\"eventType\":" << event.type << ",\"code\":" << event.code << ",\"relative\":"
      << (event.type == EV_REL ? "true" : "false") << ",\"value\":" << event.value << "}" << std::endl;
  }
  std::cout << "{\"type\":" << quote(disconnected ? "disconnect" : "stopped") << ",\"device\":" << quote(request.device) << "}" << std::endl;
  return 0;
}
}
