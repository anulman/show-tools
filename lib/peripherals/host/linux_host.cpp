#include "linux_runtime.h"
#include "linux_input_map.h"
#include "peripheral_controls.h"
#include <linux/hidraw.h>
#include <linux/input.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <sys/sysmacros.h>
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
#include <utility>

namespace {
namespace fs = std::filesystem;
using namespace peripheral_host;
struct File {
  int fd = -1;
  File() = default;
  explicit File(int value) : fd(value) {}
  File(File&& other) noexcept : fd(std::exchange(other.fd, -1)) {}
  File& operator=(File&& other) noexcept { if (fd >= 0) close(fd); fd = std::exchange(other.fd, -1); return *this; }
  ~File() { if (fd >= 0) close(fd); }
};
struct Nonblocking {
  int fd, original;
  explicit Nonblocking(int value) : fd(value), original(fcntl(value, F_GETFL)) {}
  bool enable() const { return original >= 0 && fcntl(fd, F_SETFL, original | O_NONBLOCK) >= 0; }
  ~Nonblocking() { if (original >= 0) fcntl(fd, F_SETFL, original); }
};
std::string text(const fs::path& path) { std::ifstream input(path); std::string value; input >> value; return value; }
bool board(const fs::path& path) { return text(path / "idVendor") == "d209" && text(path / "idProduct") == "0410"; }
fs::path usb_parent(const fs::path& path) {
  std::error_code error; auto current = fs::canonical(path, error);
  if (error) return {};
  for (; current != current.root_path(); current = current.parent_path()) if (board(current)) return current;
  return {};
}
std::string usb_instance(const fs::path& path) {
  struct stat metadata{};
  if (stat(path.c_str(), &metadata) < 0) return {};
  return std::to_string(metadata.st_dev) + ":" + std::to_string(metadata.st_ino) + ":" + text(path / "busnum") + ":" + text(path / "devnum");
}
fs::path fd_device(int fd) {
  struct stat metadata{};
  if (fstat(fd, &metadata) < 0 || !S_ISCHR(metadata.st_mode)) return {};
  return fs::path("/sys/dev/char") / (std::to_string(major(metadata.st_rdev)) + ":" + std::to_string(minor(metadata.st_rdev))) / "device";
}
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
template<size_t Maximum> struct Bits {
  static constexpr size_t width = sizeof(unsigned long) * 8;
  std::array<unsigned long, (Maximum + width) / width> data{};
  bool has(unsigned bit) const { return bit <= Maximum && (data[bit / width] & (1UL << (bit % width))); }
};
template<size_t Maximum> bool capabilities(int fd, unsigned type, std::vector<uint16_t>& out) {
  Bits<Maximum> bits;
  if (ioctl(fd, EVIOCGBIT(type, sizeof(bits.data)), bits.data.data()) < 0) return false;
  for (unsigned code = 0; code <= Maximum; ++code) if (bits.has(code)) out.push_back(uint16_t(code));
  return true;
}
bool input_selector(int fd, const fs::path& usb, LinuxSelector& out) {
  auto path = fd_device(fd);
  if (path.empty() || usb_parent(path) != usb) return false;
  std::error_code error; auto current = fs::canonical(path, error);
  if (error) return false;
  std::string interface;
  for (; current != usb && current != current.root_path(); current = current.parent_path()) {
    interface = text(current / "bInterfaceNumber");
    if (!interface.empty()) break;
  }
  unsigned number = 0;
  auto parsed = std::from_chars(interface.data(), interface.data() + interface.size(), number, 16);
  if (interface.empty() || parsed.ec != std::errc{} || parsed.ptr != interface.data() + interface.size() || number > 255) return false;
  out.interface_number = number;
  return capabilities<EV_MAX>(fd, 0, out.event_types) && capabilities<KEY_MAX>(fd, EV_KEY, out.key_codes)
    && capabilities<REL_MAX>(fd, EV_REL, out.relative_axes);
}
struct InputDevice { File file; fs::path path; LinuxSelector selector; };
struct Devices { std::vector<InputDevice> inputs; std::vector<size_t> selected; File output; fs::path usb; };
bool discover(Devices& out, const HostConfig& config) {
  std::set<fs::path> boards;
  std::error_code error;
  for (const auto& entry : fs::directory_iterator("/sys/bus/usb/devices", error)) if (board(entry.path())) boards.insert(fs::canonical(entry.path()));
  if (error || boards.size() != 1) { std::cerr << "Require exactly one connected d209:0410 USB device. Nothing written.\n"; return false; }
  out.usb = *boards.begin();
  const auto instance = usb_instance(out.usb);
  if (instance.empty()) return false;
  for (const auto& entry : fs::directory_iterator("/sys/class/input", error)) {
    std::string name = entry.path().filename();
    if (name.rfind("event", 0) != 0 || name.size() <= 5
      || name.find_first_not_of("0123456789", 5) != std::string::npos || usb_parent(entry.path() / "device") != out.usb) continue;
    if (out.inputs.size() >= 64) return false;
    InputDevice device; device.path = fs::path("/dev/input") / name; device.file = open_device(device.path, O_RDONLY);
    if (device.file.fd < 0 || !input_identity(device.file.fd) || !input_selector(device.file.fd, out.usb, device.selector)) return false;
    out.inputs.push_back(std::move(device));
  }
  if (error || out.inputs.empty()) return false;
  if (!config.inspect) {
    std::vector<LinuxSelector> observed;
    for (const auto& input : out.inputs) observed.push_back(input.selector);
    if (!qualify_linux_sources(config.map, observed, out.selected)) {
      std::cerr << "Configured input interfaces are absent or ambiguous; no fallback selected. Nothing written.\n"; return false;
    }
  }
  if (!config.map.leds.empty()) {
    unsigned outputs = 0;
    fs::path output_path;
    for (const auto& entry : fs::directory_iterator("/sys/class/hidraw", error)) {
      if (usb_parent(entry.path() / "device") != out.usb) continue;
      auto path = fs::path("/dev") / entry.path().filename(); auto file = open_device(path, O_RDONLY);
      if (file.fd < 0) return false;
      if (!led_identity(file.fd)) continue;
      if (usb_parent(fd_device(file.fd)) != out.usb) return false;
      ++outputs; output_path = path;
    }
    if (error || outputs != 1) { std::cerr << "Require one accessible validated LED interface. Nothing written.\n"; return false; }
    out.output = open_device(output_path, O_RDWR);
    if (out.output.fd < 0 || !led_identity(out.output.fd) || usb_parent(fd_device(out.output.fd)) != out.usb) return false;
  }
  if (usb_instance(out.usb) != instance) return false;
  for (const auto& input : out.inputs)
    if (!input_identity(input.file.fd) || usb_parent(fd_device(input.file.fd)) != out.usb) return false;
  return true;
}
void values(const std::vector<uint16_t>& items) {
  std::cout << '[';
  for (size_t index = 0; index < items.size(); ++index) { if (index) std::cout << ','; std::cout << items[index]; }
  std::cout << ']';
}
void inspect(const Devices& devices) {
  std::cout << "{\"type\":\"qualified\",\"vendor\":53769,\"product\":1040,\"openedReadOnly\":true,\"ledWrites\":false,\"sources\":[";
  for (size_t index = 0; index < devices.inputs.size(); ++index) {
    if (index) std::cout << ',';
    const auto& input = devices.inputs[index];
    std::cout << "{\"path\":\"" << input.path.string() << "\",\"interfaceNumber\":" << input.selector.interface_number << ",\"eventTypes\":";
    values(input.selector.event_types); std::cout << ",\"keyCodes\":"; values(input.selector.key_codes);
    std::cout << ",\"relativeAxes\":"; values(input.selector.relative_axes); std::cout << '}';
  }
  std::cout << "]}" << std::endl;
}
}
int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "--help") {
    std::cout << "peripheral-host SESSION --map-version 2 --linux-source ID INTERFACE EVENT_TYPES KEY_CODES REL_AXES\n"
      "  --switch CONTROL SOURCE EV_TYPE CODE [--axis knob SOURCE EV_TYPE CODE]\n"
      "  [--led CONTROL SDK_CHANNEL --confirm-wiring]\n"
      "peripheral-host --inspect (read-only actual interface/capability inventory)\n"
      "Capability lists are sorted decimal values separated by commas, or '-'.\n"
      "Explicit maps only; no key, axis, physical-control or LED defaults. No exclusive grab or permission changes.\n";
    return 0;
  }
  HostConfig config; std::string error;
  if (!parse_host_config(argc, argv, Platform::Linux, config, error)) { std::cerr << error << " Nothing opened.\n"; return 2; }
  try {
    Devices devices;
    if (!discover(devices, config)) return 1;
    if (config.inspect) { inspect(devices); return std::cout.good() ? 0 : 1; }
    LinuxHandles handles; handles.output = devices.output.fd; handles.commands = STDIN_FILENO;
    InitialStates initial; initial.fill(InitialState::Unknown);
    int clock = CLOCK_MONOTONIC;
    for (size_t source = 0; source < devices.selected.size(); ++source) {
      const int fd = devices.inputs[devices.selected[source]].file.fd;
      if (ioctl(fd, EVIOCSCLOCKID, &clock) < 0) { std::cerr << "Cannot select monotonic input clock. Nothing written.\n"; return 1; }
      handles.inputs.push_back(fd);
      Bits<KEY_MAX> held;
      bool has_switch = false;
      for (const auto& binding : config.map.switches) if (binding.source == source) has_switch = true;
      if (has_switch && ioctl(fd, EVIOCGKEY(sizeof(held.data)), held.data.data()) >= 0)
        for (const auto& binding : config.map.switches) if (binding.source == source)
          initial[size_t(binding.control)] = held.has(binding.code) ? InitialState::Held : InitialState::Released;
    }
    for (size_t index = 0; index < devices.inputs.size(); ++index)
      if (std::find(devices.selected.begin(), devices.selected.end(), index) == devices.selected.end()) devices.inputs[index].file = File{};
    timespec cutoff{};
    if (clock_gettime(CLOCK_MONOTONIC, &cutoff) < 0 || cutoff.tv_sec > (INT64_MAX - 999999999) / 1000000000) return 1;
    Nonblocking input_flags(STDIN_FILENO), output_flags(STDOUT_FILENO);
    if (!input_flags.enable() || !output_flags.enable()) return 1;
    int result = run_linux_host(handles, config, initial, int64_t(cutoff.tv_sec) * 1000000000 + cutoff.tv_nsec);
    return result;
  } catch (const std::exception& error) { std::cerr << "Peripheral host failed: " << error.what() << '\n'; return 1; }
}
