#include "control_stream.h"
#include "peripheral_controls.h"
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/hid/IOHIDManager.h>
#include <IOKit/IOKitLib.h>
#include <IOKit/hidsystem/IOHIDLib.h>
#include <mach/mach_error.h>
#include <algorithm>
#include <cerrno>
#include <charconv>
#include <csignal>
#include <fcntl.h>
#include <iostream>
#include <memory>
#include <set>
#include <string>
#include <unistd.h>
#include <vector>

namespace {
volatile std::sig_atomic_t running = 1;
void stop(int) { running = 0; }
const char* input_access() {
  switch (IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)) {
    case kIOHIDAccessTypeGranted: return "granted";
    case kIOHIDAccessTypeDenied: return "denied";
    case kIOHIDAccessTypeUnknown: return "unknown";
  }
  return "unknown";
}
int property(IOHIDDeviceRef device, CFStringRef key) {
  auto value = IOHIDDeviceGetProperty(device, key);
  int out = 0;
  if (value && CFGetTypeID(value) == CFNumberGetTypeID())
    CFNumberGetValue(static_cast<CFNumberRef>(value), kCFNumberIntType, &out);
  return out;
}
bool output_supported(IOHIDDeviceRef device) {
  auto value = IOHIDDeviceGetProperty(device, CFSTR(kIOHIDReportDescriptorKey));
  if (!value || CFGetTypeID(value) != CFDataGetTypeID()) return false;
  auto data = static_cast<CFDataRef>(value);
  return pp_ipac_led_descriptor(CFDataGetBytePtr(data), uint32_t(CFDataGetLength(data))) == 1;
}
std::optional<uint32_t> interface_number(IOHIDDeviceRef device) {
  auto service = IOHIDDeviceGetService(device);
  if (!service) return std::nullopt;
  auto value = IORegistryEntrySearchCFProperty(service, kIOServicePlane, CFSTR("bInterfaceNumber"),
    kCFAllocatorDefault, kIORegistryIterateRecursively | kIORegistryIterateParents);
  int number = -1;
  if (value && CFGetTypeID(value) == CFNumberGetTypeID())
    CFNumberGetValue(static_cast<CFNumberRef>(value), kCFNumberIntType, &number);
  if (value) CFRelease(value);
  if (number < 0 || number > 255) return std::nullopt;
  return uint32_t(number);
}
IOHIDElementRef find_collection(IOHIDDeviceRef device, const peripheral_host::HidSelector& selector) {
  auto elements = IOHIDDeviceCopyMatchingElements(device, nullptr, kIOHIDOptionsTypeNone);
  IOHIDElementRef found = nullptr;
  for (CFIndex index = 0; elements && index < CFArrayGetCount(elements); ++index) {
    auto element = static_cast<IOHIDElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(elements, index)));
    if (IOHIDElementGetType(element) != kIOHIDElementTypeCollection || IOHIDElementGetParent(element)
      || IOHIDElementGetUsagePage(element) != selector.usage_page || IOHIDElementGetUsage(element) != selector.usage) continue;
    if (found) { CFRelease(found); found = nullptr; break; }
    found = element; CFRetain(found);
  }
  if (elements) CFRelease(elements);
  return found;
}
IOHIDElementRef find_element(IOHIDDeviceRef device, IOHIDElementRef collection, uint32_t page, uint32_t usage, bool relative) {
  auto elements = IOHIDDeviceCopyMatchingElements(device, nullptr, kIOHIDOptionsTypeNone);
  IOHIDElementRef found = nullptr;
  for (CFIndex index = 0; elements && index < CFArrayGetCount(elements); ++index) {
    auto element = static_cast<IOHIDElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(elements, index)));
    auto type = IOHIDElementGetType(element);
    if (type < kIOHIDElementTypeInput_Misc || type > kIOHIDElementTypeInput_ScanCodes
      || IOHIDElementGetUsagePage(element) != page || IOHIDElementGetUsage(element) != usage
      || bool(IOHIDElementIsRelative(element)) != relative) continue;
    auto parent = IOHIDElementGetParent(element);
    while (parent && parent != collection) parent = IOHIDElementGetParent(parent);
    if (parent != collection) continue;
    if (found) { CFRelease(found); found = nullptr; break; }
    found = element; CFRetain(found);
  }
  if (elements) CFRelease(elements);
  return found;
}
struct SelectedInput {
  IOHIDDeviceRef device;
  IOHIDElementRef element;
  std::optional<peripheral_host::PhysicalControl> control;
};
struct Host {
  IOHIDDeviceRef output = nullptr;
  std::vector<SelectedInput> selected;
  peripheral_host::InputMap map;
  std::unique_ptr<pp_inputs, decltype(&pp_destroy)> inputs{pp_create(), pp_destroy};
  std::unique_ptr<pp_light_delivery, decltype(&pp_light_delivery_destroy)> delivery{pp_light_delivery_create(), pp_light_delivery_destroy};
  double session = 0, sequence = 0;
  bool disconnected = false, failed = false, bound = false;

  bool write(const uint8_t* report) {
    auto status = IOHIDDeviceSetReport(output, kIOHIDReportTypeOutput, report[0], report, PP_LED_REPORT_BYTES);
    if (status != kIOReturnSuccess) {
      std::cerr << "I-PAC brightness write failed (" << status << ").\n";
      failed = true; running = 0; return false;
    }
    return true;
  }
  bool clear() {
    for (const auto& led : map.leds) {
      uint8_t report[PP_LED_REPORT_BYTES];
      if (pp_ipac_led_report(led.sdk_channel, 0, report) != PP_LED_REPORT_BYTES || !write(report)) return false;
    }
    return true;
  }
  bool command(const peripheral_host::Command& command) {
    using peripheral_host::Operation;
    if (command.operation == Operation::Clear) { bound = false; return clear(); }
    if (command.operation == Operation::Quit) { running = 0; return true; }
    if (command.connection.device_session != session) return false;
    if (command.operation == Operation::Bind) {
      const auto bindings = peripheral_host::light_bindings(map);
      bound = false;
      if (!clear() || pp_light_delivery_bind(delivery.get(), &command.connection, bindings.data(), uint32_t(bindings.size())) != 0) return false;
      bound = true; return true;
    }
    if (!bound) return false;
    pp_light_delivery_frame frame{};
    int prepared = pp_light_delivery_prepare(delivery.get(), &command.connection,
      command.image.data(), command.image.size(), &frame);
    if (prepared == PP_STALE) return true;
    if (prepared != 1) return false;
    for (uint32_t index = 0; index < frame.count; ++index) if (!write(frame.reports[index])) return false;
    if (pp_light_delivery_commit(delivery.get(), &frame) != 1) return false;
    std::cout << "{\"type\":\"delivered\",\"publication\":" << frame.publication << "}" << std::endl;
    return true;
  }
};
void input(void* context, IOReturn status, void*, IOHIDValueRef value) {
  auto& host = *static_cast<Host*>(context);
  if (status != kIOReturnSuccess || !value) { host.failed = true; running = 0; return; }
  auto element = IOHIDValueGetElement(value);
  auto selected = std::find_if(host.selected.begin(), host.selected.end(), [&](const SelectedInput& input) { return input.element == element; });
  if (selected == host.selected.end()) return;
  if (IOHIDValueGetLength(value) > CFIndex(sizeof(CFIndex)) || host.sequence >= 9007199254740991.) {
    host.failed = true; running = 0; return;
  }
  const double raw = double(IOHIDValueGetIntegerValue(value)), sequence = ++host.sequence;
  int result = PP_INVALID;
  bool emitted = true;
  if (selected->control) {
    if (raw == 2) result = pp_rotate(host.inputs.get(), host.session, sequence, 0);
    else if (raw == 0 || raw == 1) result = pp_key(host.inputs.get(), host.session, sequence, uint32_t(*selected->control), int(raw));
    if (result == PP_PRESS || result == PP_RELEASE)
      emitted = peripheral_host::emit_button(std::cout, host.session, sequence, *selected->control, result == PP_PRESS);
  } else {
    result = pp_rotate(host.inputs.get(), host.session, sequence, raw);
    if (result == PP_MOVEMENT) emitted = peripheral_host::emit_motion(std::cout, host.session, sequence, raw);
  }
  if (result < 0 || !emitted) { host.failed = true; running = 0; }
}
void removed(void* context, IOReturn, void*) {
  auto& host = *static_cast<Host*>(context);
  host.disconnected = true; running = 0;
  if (!peripheral_host::emit_detached(std::cout, host.session)) host.failed = true;
}
}

int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "--help") {
    std::cout << "peripheral-host SESSION --map-version 2 --hid-source ID INTERFACE USAGE_PAGE USAGE\n"
      "  --switch blue|yellow|red|green|pedal|mushroom SOURCE USAGE_PAGE USAGE\n"
      "  [--axis knob SOURCE USAGE_PAGE USAGE] [--led CONTROL SDK_CHANNEL --confirm-wiring]\n"
      "peripheral-host --inspect (read-only interface and element inventory)\n"
      "peripheral-host --access-status (checks Input Monitoring without prompting)\n"
      "Sources and controls are explicit installation data. No default key or musical assignment.\n";
    return 0;
  }
  if (argc == 2 && std::string(argv[1]) == "--access-status") {
    std::cout << "{\"type\":\"input-access\",\"state\":\"" << input_access() << "\",\"pid\":" << getpid() << "}\n";
    return 0;
  }
  peripheral_host::HostConfig config;
  std::string error;
  if (!peripheral_host::parse_host_config(argc, argv, peripheral_host::Platform::MacOS, config, error)) {
    std::cerr << error << " Nothing opened.\n"; return 2;
  }
  Host host; host.session = config.session; host.map = config.map;
  if (!host.inputs || !host.delivery) return 1;
  std::cout.precision(17);
  auto manager = IOHIDManagerCreate(kCFAllocatorDefault, kIOHIDOptionsTypeNone);
  auto matching = CFDictionaryCreateMutable(kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  int vendor = 0xd209, product = 0x0410;
  auto vid = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &vendor);
  auto pid = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &product);
  CFDictionarySetValue(matching, CFSTR(kIOHIDVendorIDKey), vid);
  CFDictionarySetValue(matching, CFSTR(kIOHIDProductIDKey), pid);
  IOHIDManagerSetDeviceMatching(manager, matching);
  CFRelease(vid); CFRelease(pid); CFRelease(matching);
  auto devices = IOHIDManagerCopyDevices(manager);
  std::vector<const void*> entries(devices ? CFSetGetCount(devices) : 0);
  if (devices) CFSetGetValues(devices, entries.data());
  std::set<int> locations;
  for (auto entry : entries) {
    auto device = static_cast<IOHIDDeviceRef>(const_cast<void*>(entry));
    locations.insert(property(device, CFSTR(kIOHIDLocationIDKey)));
  }
  int result = 1;
  std::vector<IOHIDDeviceRef> sources;
  std::vector<IOHIDElementRef> collections;
  std::set<IOHIDDeviceRef> required;
  std::vector<IOHIDDeviceRef> opened;
  bool qualified = locations.size() == 1 && *locations.begin() != 0;
  if (config.inspect) {
    for (auto entry : entries) {
      auto device = static_cast<IOHIDDeviceRef>(const_cast<void*>(entry));
      const auto interface = interface_number(device);
      auto elements = IOHIDDeviceCopyMatchingElements(device, nullptr, kIOHIDOptionsTypeNone);
      std::cout << "{\"type\":\"interface\",\"platform\":\"macos\",\"interface\":";
      if (interface) std::cout << *interface; else std::cout << "null";
      std::cout << ",\"usagePage\":" << property(device, CFSTR(kIOHIDPrimaryUsagePageKey))
        << ",\"usage\":" << property(device, CFSTR(kIOHIDPrimaryUsageKey))
        << ",\"ledDescriptorSupported\":" << (output_supported(device) ? "true" : "false") << ",\"opened\":false,\"elements\":[";
      for (CFIndex index = 0; elements && index < CFArrayGetCount(elements); ++index) {
        if (index) std::cout << ',';
        auto element = static_cast<IOHIDElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(elements, index)));
        std::cout << "{\"type\":" << IOHIDElementGetType(element)
          << ",\"usagePage\":" << IOHIDElementGetUsagePage(element) << ",\"usage\":" << IOHIDElementGetUsage(element)
          << ",\"relative\":" << (IOHIDElementIsRelative(element) ? "true" : "false")
          << ",\"topLevel\":" << (IOHIDElementGetParent(element) ? "false" : "true") << '}';
      }
      std::cout << "]}" << std::endl;
      if (elements) CFRelease(elements);
    }
    result = !entries.empty() && std::cout.good() ? 0 : 1;
  } else {
    for (const auto& source : config.map.sources) {
      const auto& selector = std::get<peripheral_host::HidSelector>(source.selector);
      IOHIDDeviceRef selected = nullptr;
      IOHIDElementRef collection = nullptr;
      unsigned matches = 0;
      for (auto entry : entries) {
        auto device = static_cast<IOHIDDeviceRef>(const_cast<void*>(entry));
        if (interface_number(device) != std::optional<uint32_t>(selector.interface_number)) continue;
        if (auto found = find_collection(device, selector)) {
          ++matches; selected = device;
          if (collection) CFRelease(collection);
          collection = found;
        }
      }
      if (matches != 1) qualified = false;
      sources.push_back(selected); collections.push_back(collection);
      if (selected) required.insert(selected);
    }
    for (const auto& binding : config.map.switches) {
      auto device = sources[binding.source];
      auto element = device ? find_element(device, collections[binding.source], binding.type, binding.code, false) : nullptr;
      if (!element) qualified = false;
      else host.selected.push_back({device, element, binding.control});
    }
    if (config.map.axis) {
      const auto& binding = *config.map.axis;
      auto device = sources[binding.source];
      auto element = device ? find_element(device, collections[binding.source], binding.type, binding.code, true) : nullptr;
      if (!element) qualified = false;
      else host.selected.push_back({device, element, std::nullopt});
    }
    if (!config.map.leds.empty()) {
      unsigned outputs = 0;
      for (auto entry : entries) {
        auto device = static_cast<IOHIDDeviceRef>(const_cast<void*>(entry));
        if (output_supported(device)) { ++outputs; host.output = device; }
      }
      if (outputs != 1) qualified = false;
      if (host.output) required.insert(host.output);
    }
    if (!qualified) std::cerr << "Require one I-PAC with unique configured collections, elements and accepted LED descriptor when mapped. Nothing opened.\n";
    else {
      for (auto device : required) {
        auto status = IOHIDDeviceOpen(device, kIOHIDOptionsTypeNone);
        if (status != kIOReturnSuccess) {
          std::cerr << "I-PAC open failed (" << status << ": " << mach_error_string(status)
            << "). Input Monitoring is " << input_access() << ".\n";
          break;
        }
        opened.push_back(device);
      }
      if (opened.size() == required.size()) {
        peripheral_host::InitialStates states{};
        uint32_t released = 0, held = 0;
        for (const auto& input : host.selected) {
          if (!input.control) continue;
          IOHIDValueRef initial = nullptr;
          if (IOHIDDeviceGetValue(input.device, input.element, &initial) != kIOReturnSuccess || !initial) continue;
          const auto raw = IOHIDValueGetIntegerValue(initial);
          const auto id = uint32_t(*input.control);
          if (raw == 0) { states[id] = peripheral_host::InitialState::Released; released |= 1u << id; }
          else if (raw == 1) { states[id] = peripheral_host::InitialState::Held; held |= 1u << id; }
        }
        if (pp_begin(host.inputs.get(), host.session, released, held) != 0) host.failed = true;
        for (auto device : opened) {
          IOHIDDeviceRegisterRemovalCallback(device, removed, &host);
          if (sources.end() != std::find(sources.begin(), sources.end(), device))
            IOHIDDeviceRegisterInputValueCallback(device, input, &host);
          IOHIDDeviceScheduleWithRunLoop(device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
        }
        int flags = fcntl(STDIN_FILENO, F_GETFL), output_flags = fcntl(STDOUT_FILENO, F_GETFL);
        if (flags < 0 || fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK) < 0) host.failed = true;
        if (output_flags < 0 || fcntl(STDOUT_FILENO, F_SETFL, output_flags | O_NONBLOCK) < 0) host.failed = true;
        std::signal(SIGINT, stop); std::signal(SIGTERM, stop); std::signal(SIGHUP, stop); std::signal(SIGPIPE, SIG_IGN);
        if (!host.failed && host.clear() && peripheral_host::emit_ready(std::cout, host.session, host.map, states)) {
          std::string pending;
          while (running && !host.failed && std::cout.good()) {
            CFRunLoopRunInMode(kCFRunLoopDefaultMode, .005, false);
            char bytes[4096];
            ssize_t count = read(STDIN_FILENO, bytes, sizeof(bytes));
            if (count == 0) break;
            if (count < 0) { if (errno == EAGAIN || errno == EINTR) continue; host.failed = true; break; }
            pending.append(bytes, size_t(count));
            size_t end = 0;
            while ((end = pending.find('\n')) != std::string::npos) {
              peripheral_host::Command command;
              if (!peripheral_host::parse_command(pending.substr(0, end), command) || !host.command(command)) {
                std::cerr << "Rejected peripheral command; clearing owned LEDs.\n";
                host.failed = true; break;
              }
              pending.erase(0, end + 1);
            }
            if (pending.size() > 16384) host.failed = true;
          }
          if (!host.disconnected && !host.clear()) host.failed = true;
          result = host.failed || !std::cout.good() ? 1 : 0;
        }
        if (flags >= 0) fcntl(STDIN_FILENO, F_SETFL, flags);
        if (output_flags >= 0) fcntl(STDOUT_FILENO, F_SETFL, output_flags);
        for (auto device : opened) IOHIDDeviceUnscheduleFromRunLoop(device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
      }
    }
  }
  for (auto device : opened) IOHIDDeviceClose(device, kIOHIDOptionsTypeNone);
  for (const auto& input : host.selected) CFRelease(input.element);
  for (auto collection : collections) if (collection) CFRelease(collection);
  if (devices) CFRelease(devices);
  CFRelease(manager);
  return result;
}
