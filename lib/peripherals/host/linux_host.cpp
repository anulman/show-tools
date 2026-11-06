#include "linux_runtime.h"
#include "peripheral_controls.h"
#include <linux/hidraw.h>
#include <linux/input.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <array>
#include <cerrno>
#include <charconv>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace {
namespace fs = std::filesystem;
struct File {
  int fd = -1;
  File() = default;
  explicit File(int value) : fd(value) {}
  File(File&& other) noexcept : fd(std::exchange(other.fd, -1)) {}
  File& operator=(File&& other) noexcept { if (fd >= 0) close(fd); fd = std::exchange(other.fd, -1); return *this; }
  ~File() { if (fd >= 0) close(fd); }
};
bool number(const char* input, uint64_t maximum, uint64_t& out) {
  std::string value(input); auto parsed = std::from_chars(value.data(), value.data() + value.size(), out);
  return parsed.ec == std::errc{} && parsed.ptr == value.data() + value.size() && out <= maximum;
}
std::string text(const fs::path& path) { std::ifstream input(path); std::string value; input >> value; return value; }
bool board(const fs::path& path) { return text(path / "idVendor") == "d209" && text(path / "idProduct") == "0410"; }
fs::path usb_parent(const fs::path& path) {
  std::error_code error; auto current = fs::canonical(path, error);
  if (error) return {};
  for (; current != current.root_path(); current = current.parent_path()) if (board(current)) return current;
  return {};
}
template<size_t Maximum> struct Bits {
  static constexpr size_t width = sizeof(unsigned long) * 8;
  std::array<unsigned long, (Maximum + width) / width> data{};
  bool has(unsigned bit) const { return bit <= Maximum && (data[bit / width] & (1UL << (bit % width))); }
};
bool input_identity(int fd) {
  input_id id{};
  return ioctl(fd, EVIOCGID, &id) >= 0 && id.bustype == BUS_USB && id.vendor == 0xd209 && id.product == 0x0410;
}
bool led_identity(int fd) {
  hidraw_devinfo id{}; int size = 0; hidraw_report_descriptor descriptor{};
  if (ioctl(fd, HIDIOCGRAWINFO, &id) < 0 || id.bustype != BUS_USB || uint16_t(id.vendor) != 0xd209 || uint16_t(id.product) != 0x0410
    || ioctl(fd, HIDIOCGRDESCSIZE, &size) < 0 || size < 1 || size > HID_MAX_DESCRIPTOR_SIZE) return false;
  descriptor.size = unsigned(size);
  return ioctl(fd, HIDIOCGRDESC, &descriptor) >= 0 && pp_ipac_led_descriptor(descriptor.value, descriptor.size) == 1;
}
File open_device(const fs::path& path, int flags) {
  File file(open(path.c_str(), flags | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK));
  struct stat metadata{};
  if (file.fd >= 0 && (fstat(file.fd, &metadata) < 0 || !S_ISCHR(metadata.st_mode))) return {};
  if (file.fd < 0) std::cerr << "Cannot open " << path << ": " << std::strerror(errno) << ". Device access must be provisioned separately.\n";
  return file;
}
struct Devices { File keyboard, mouse, output; fs::path keyboard_path, mouse_path, output_path, usb; };
std::string usb_instance(const fs::path& path) {
  struct stat metadata{};
  if (stat(path.c_str(), &metadata) < 0) return {};
  return std::to_string(metadata.st_dev) + ":" + std::to_string(metadata.st_ino) + ":" + text(path / "busnum") + ":" + text(path / "devnum");
}
bool discover(Devices& out, bool inspect) {
  std::set<fs::path> boards;
  std::error_code error;
  for (const auto& entry : fs::directory_iterator("/sys/bus/usb/devices", error)) if (board(entry.path())) boards.insert(fs::canonical(entry.path()));
  if (error || boards.size() != 1) { std::cerr << "Require exactly one connected d209:0410 USB device; observed " << boards.size() << ". Nothing written.\n"; return false; }
  out.usb = *boards.begin();
  const auto instance = usb_instance(out.usb);
  if (instance.empty()) return false;
  unsigned keyboards = 0, mice = 0, outputs = 0;
  error.clear();
  for (const auto& entry : fs::directory_iterator("/sys/class/input", error)) {
    std::string name = entry.path().filename();
    if (name.rfind("event", 0) != 0 || usb_parent(entry.path() / "device") != out.usb) continue;
    auto path = fs::path("/dev/input") / name; auto file = open_device(path, O_RDONLY);
    if (file.fd < 0 || !input_identity(file.fd)) continue;
    Bits<KEY_MAX> keys; Bits<REL_MAX> relative;
    bool key = ioctl(file.fd, EVIOCGBIT(EV_KEY, sizeof(keys.data)), keys.data.data()) >= 0 && keys.has(KEY_TAB);
    bool axis = ioctl(file.fd, EVIOCGBIT(EV_REL, sizeof(relative.data)), relative.data.data()) >= 0 && relative.has(REL_Y);
    if (key && axis) { std::cerr << "Tab and relative Y must be distinct input interfaces.\n"; return false; }
    if (key) { ++keyboards; out.keyboard = std::move(file); out.keyboard_path = path; }
    if (axis) { ++mice; out.mouse = std::move(file); out.mouse_path = path; }
  }
  if (error) { std::cerr << "Cannot enumerate input interfaces: " << error.message() << '\n'; return false; }
  for (const auto& entry : fs::directory_iterator("/sys/class/hidraw", error)) {
    auto name = entry.path().filename();
    if (usb_parent(entry.path() / "device") != out.usb) continue;
    auto path = fs::path("/dev") / name; auto file = open_device(path, inspect ? O_RDONLY : O_RDWR);
    if (file.fd < 0 || !led_identity(file.fd)) continue;
    ++outputs; out.output = std::move(file); out.output_path = path;
  }
  if (error || keyboards != 1 || mice != 1 || outputs != 1) {
    std::cerr << "Require unique accessible Tab, relative-Y and validated LED interfaces on one USB parent. Observed "
      << keyboards << " Tab, " << mice << " relative-Y and " << outputs << " LED. Nothing written.\n";
    return false;
  }
  if (usb_instance(out.usb) != instance || !input_identity(out.keyboard.fd) || !input_identity(out.mouse.fd) || !led_identity(out.output.fd)) {
    std::cerr << "I-PAC USB instance changed during qualification. Nothing written.\n"; return false;
  }
  return true;
}
}
int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "--help") {
    std::cout << "peripheral-host SESSION SDK_CHANNEL --confirm-wiring\n"
      "peripheral-host --bench-held SDK_CHANNEL --confirm-wiring\n"
      "peripheral-host --inspect (read-only interface qualification, no LED writes)\n"
      "Discovers the sole d209:0410 USB device with unique Tab, relative-Y and supported LED interfaces.\n"
      "Uses evdev without an exclusive grab and brightness-only hidraw reports, preserving enable masks.\n"
      "Device permissions are required; this command never modifies them.\n";
    return 0;
  }
  bool inspect = argc == 2 && std::string(argv[1]) == "--inspect";
  bool bench = argc == 4 && std::string(argv[1]) == "--bench-held";
  uint64_t session = bench ? 1 : 0, channel = 0;
  if (!inspect && (argc != 4 || (!bench && !number(argv[1], 9007199254740991ULL, session)) || !session
    || !number(argv[2], 95, channel) || std::string(argv[3]) != "--confirm-wiring")) {
    std::cerr << "Use peripheral-host SESSION SDK_CHANNEL --confirm-wiring (or --help).\n"; return 2;
  }
  try {
    Devices devices;
    if (!discover(devices, inspect)) return 1;
    if (inspect) {
      std::cout << "{\"type\":\"qualified\",\"vendor\":53769,\"product\":1040,\"buttonUsage\":43,\"relativeYUsage\":49,\"openedReadOnly\":true,\"ledWrites\":false,\"keyboard\":"
        << devices.keyboard_path << ",\"mouse\":" << devices.mouse_path << ",\"output\":" << devices.output_path << ",\"usbParent\":" << devices.usb << "}\n";
      return 0;
    }
    int clock = CLOCK_MONOTONIC;
    if (ioctl(devices.keyboard.fd, EVIOCSCLOCKID, &clock) < 0 || ioctl(devices.mouse.fd, EVIOCSCLOCKID, &clock) < 0) {
      std::cerr << "Cannot select monotonic event clocks on both input interfaces. Nothing written.\n"; return 1;
    }
    Bits<KEY_MAX> held;
    if (ioctl(devices.keyboard.fd, EVIOCGKEY(sizeof(held.data)), held.data.data()) < 0) {
      std::cerr << "Cannot read initial held-button state. Nothing written.\n"; return 1;
    }
    int flags = fcntl(STDIN_FILENO, F_GETFL), output_flags = fcntl(STDOUT_FILENO, F_GETFL);
    if ((!bench && (flags < 0 || fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK) < 0))
      || output_flags < 0 || fcntl(STDOUT_FILENO, F_SETFL, output_flags | O_NONBLOCK) < 0) return 1;
    int result = peripheral_host::run_linux_host({devices.keyboard.fd, devices.mouse.fd, devices.output.fd, STDIN_FILENO},
      double(session), uint32_t(channel), held.has(KEY_TAB), bench);
    if (flags >= 0) fcntl(STDIN_FILENO, F_SETFL, flags);
    fcntl(STDOUT_FILENO, F_SETFL, output_flags);
    return result;
  } catch (const std::exception& error) { std::cerr << "Peripheral host failed: " << error.what() << '\n'; return 1; }
}
