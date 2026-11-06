#include "usb_identity.h"

#include <filesystem>
#include <fstream>
#include <regex>
#include <stdexcept>
#if defined(__linux__)
#include <sys/stat.h>
#include <sys/sysmacros.h>
#endif

namespace native_alsa::detail {
#if defined(__linux__)
namespace {
std::string text(const std::filesystem::path& path) {
  std::ifstream source(path);
  std::string value;
  char character;
  while (source.get(character)) {
    if (value.size() >= 1024) throw std::runtime_error("Oversized USB identity metadata");
    value += character;
  }
  if (!source.eof() || value.empty()) throw std::runtime_error("Missing USB identity metadata");
  while (!value.empty() && (value.back() == '\n' || value.back() == '\r')) value.pop_back();
  if (value.empty() || value.find_first_of("\n\r\0", 0, 3) != std::string::npos) throw std::runtime_error("Invalid USB identity metadata");
  return value;
}
}
#endif

std::optional<UsbDeviceFacts> inspect_usb_device(const UsbIdentity& expected, std::string& error) {
#if defined(__linux__)
  try {
    namespace fs = std::filesystem;
    if (!fs::is_symlink(expected.by_id)) throw std::runtime_error("USB by-id must be a stable control symlink");
    const auto control = fs::canonical(expected.by_id);
    std::smatch match;
    const auto name = control.string();
    if (!std::regex_match(name, match, std::regex("/dev/snd/controlC([0-9]+)"))) throw std::runtime_error("USB by-id does not select an ALSA control device");
    const auto card_number = std::stoul(match[1].str());
    if (card_number > 255) throw std::runtime_error("Invalid ALSA card index");
    const auto card = std::to_string(card_number);
    struct stat node{};
    if (::stat(control.c_str(), &node) != 0 || !S_ISCHR(node.st_mode) || major(node.st_rdev) != 116) throw std::runtime_error("USB by-id is not an ALSA character device");
    const fs::path sound("/sys/class/sound");
    const auto control_class = sound / ("controlC" + card);
    const auto device_numbers = std::to_string(major(node.st_rdev)) + ":" + std::to_string(minor(node.st_rdev));
    if (text(control_class / "dev") != device_numbers || fs::canonical(fs::path("/sys/dev/char") / device_numbers) != fs::canonical(control_class)) throw std::runtime_error("ALSA control major/minor mapping changed");
    const auto card_path = fs::canonical(sound / ("card" + card));
    if (fs::canonical(control_class).parent_path() != card_path) throw std::runtime_error("ALSA control card mapping changed");
    for (const auto* direction : {"c", "p"}) {
      const auto pcm = sound / ("pcmC" + card + "D" + std::to_string(expected.pcm_device) + direction);
      if (fs::canonical(pcm).parent_path() != card_path) throw std::runtime_error("ALSA PCM ancestry does not match selected card");
    }
    auto usb = fs::canonical(sound / ("card" + card) / "device");
    for (unsigned depth = 0; depth < 32; ++depth) {
      if (fs::exists(usb / "idVendor") || fs::exists(usb / "idProduct")) {
        return UsbDeviceFacts{unsigned(card_number), text(fs::path("/proc/asound") / ("card" + card) / "id"),
          text(usb / "serial"), text(usb / "idVendor"), text(usb / "idProduct"),
          usb.string() + ":" + text(usb / "busnum") + ":" + text(usb / "devnum")};
      }
      const auto parent = usb.parent_path();
      if (parent == usb || parent == "/sys") break;
      usb = parent;
    }
    throw std::runtime_error("Selected ALSA card has no USB device ancestor");
  } catch (const std::exception& failure) { error = failure.what(); return std::nullopt; }
#else
  (void)expected;
  error = "USB audio identity is only available on Linux";
  return std::nullopt;
#endif
}
}
