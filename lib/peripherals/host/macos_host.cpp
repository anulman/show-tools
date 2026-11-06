#include "control_stream.h"
#include "peripheral_controls.h"
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/hid/IOHIDManager.h>
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
IOHIDElementRef find_element(IOHIDDeviceRef device, uint32_t page, uint32_t usage, bool relative) {
  auto elements = IOHIDDeviceCopyMatchingElements(device, nullptr, kIOHIDOptionsTypeNone);
  IOHIDElementRef found = nullptr;
  for (CFIndex index = 0; elements && index < CFArrayGetCount(elements); ++index) {
    auto element = static_cast<IOHIDElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(elements, index)));
    auto type = IOHIDElementGetType(element);
    if (type < kIOHIDElementTypeInput_Misc || type > kIOHIDElementTypeInput_ScanCodes
      || IOHIDElementGetUsagePage(element) != page || IOHIDElementGetUsage(element) != usage
      || bool(IOHIDElementIsRelative(element)) != relative) continue;
    if (found) { CFRelease(found); found = nullptr; break; }
    found = element; CFRetain(found);
  }
  if (elements) CFRelease(elements);
  return found;
}
bool number(const char* input, uint64_t maximum, uint64_t& out) {
  std::string text(input);
  auto parsed = std::from_chars(text.data(), text.data() + text.size(), out);
  return parsed.ec == std::errc{} && parsed.ptr == text.data() + text.size() && out <= maximum;
}
struct Host {
  IOHIDDeviceRef keyboard = nullptr, mouse = nullptr, output = nullptr;
  IOHIDElementRef button = nullptr, axis = nullptr;
  std::unique_ptr<pp_inputs, decltype(&pp_destroy)> inputs{pp_create(), pp_destroy};
  std::unique_ptr<pp_light_delivery, decltype(&pp_light_delivery_destroy)> delivery{pp_light_delivery_create(), pp_light_delivery_destroy};
  double session = 0, sequence = 0;
  uint32_t channel = 0;
  bool disconnected = false, failed = false;
  bool bound = false;

  bool write(const uint8_t* report) {
    auto status = IOHIDDeviceSetReport(output, kIOHIDReportTypeOutput, report[0], report, PP_LED_REPORT_BYTES);
    if (status != kIOReturnSuccess) {
      std::cerr << "I-PAC brightness write failed (" << status << ").\n";
      failed = true; running = 0; return false;
    }
    return true;
  }
  bool clear() {
    uint8_t report[PP_LED_REPORT_BYTES];
    return pp_ipac_led_report(channel, 0, report) == PP_LED_REPORT_BYTES && write(report);
  }
  bool command(const peripheral_host::Command& command) {
    using peripheral_host::Operation;
    if (command.operation == Operation::Clear) { bound = false; return clear(); }
    if (command.operation == Operation::Quit) { running = 0; return true; }
    if (command.connection.device_session != session) return false;
    if (command.operation == Operation::Bind) {
      pp_light_binding binding{1, channel};
      bound = false;
      if (!clear() || pp_light_delivery_bind(delivery.get(), &command.connection, &binding, 1) != 0) return false;
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
  if (element != host.button && element != host.axis) return;
  if (IOHIDValueGetLength(value) > CFIndex(sizeof(CFIndex))) { host.failed = true; running = 0; return; }
  double raw = double(IOHIDValueGetIntegerValue(value));
  if (host.sequence >= 9007199254740991.) { host.failed = true; running = 0; return; }
  double sequence = ++host.sequence;
  if (element == host.button) {
    if (raw != 0 && raw != 1) { host.failed = true; running = 0; return; }
    int result = pp_key(host.inputs.get(), host.session, sequence, 0, int(raw));
    if (result == PP_PRESS || result == PP_RELEASE)
      std::cout << "{\"type\":\"button\",\"session\":" << host.session << ",\"sequence\":" << sequence
        << ",\"down\":" << (result == PP_PRESS ? "true" : "false") << "}" << std::endl;
  } else if (pp_rotate(host.inputs.get(), host.session, sequence, raw) == PP_MOVEMENT) {
    std::cout << "{\"type\":\"motion\",\"session\":" << host.session << ",\"sequence\":" << sequence
      << ",\"deltaY\":" << raw << "}" << std::endl;
  }
}
void removed(void* context, IOReturn, void*) {
  auto& host = *static_cast<Host*>(context);
  host.disconnected = true; running = 0;
  std::cout << "{\"type\":\"detached\",\"session\":" << host.session << "}" << std::endl;
}
}

int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "--help") {
    std::cout << "peripheral-host SESSION SDK_CHANNEL --confirm-wiring\n"
      "Owns the sole d209:0410 I-PAC Tab button and relative Y interfaces exclusively.\n"
      "Reads native light publications on stdin; brightness-only writes, no enable-mask changes.\n";
    return 0;
  }
  uint64_t session = 0, channel = 0;
  if (argc != 4 || !number(argv[1], 9007199254740991ULL, session) || !session
    || !number(argv[2], 95, channel) || std::string(argv[3]) != "--confirm-wiring") {
    std::cerr << "Use peripheral-host SESSION SDK_CHANNEL --confirm-wiring (or --help).\n"; return 2;
  }
  Host host; host.session = double(session); host.channel = uint32_t(channel);
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
  unsigned keyboards = 0, mice = 0, outputs = 0;
  for (auto entry : entries) {
    auto device = static_cast<IOHIDDeviceRef>(const_cast<void*>(entry));
    locations.insert(property(device, CFSTR(kIOHIDLocationIDKey)));
    if (auto element = find_element(device, 7, 43, false)) {
      ++keyboards;
      if (host.button) CFRelease(host.button);
      host.keyboard = device; host.button = element;
    }
    if (auto element = find_element(device, 1, 49, true)) {
      ++mice;
      if (host.axis) CFRelease(host.axis);
      host.mouse = device; host.axis = element;
    }
    if (output_supported(device)) { ++outputs; host.output = device; }
  }
  int result = 1;
  std::vector<IOHIDDeviceRef> opened;
  if (locations.size() != 1 || keyboards != 1 || mice != 1 || outputs != 1 || host.keyboard == host.mouse
    || host.output == host.keyboard || host.output == host.mouse) {
    std::cerr << "Require one I-PAC with unique Tab, relative-Y and validated LED interfaces. No interfaces opened.\n";
  } else {
    for (auto device : {host.keyboard, host.mouse, host.output}) {
      auto options = device == host.output ? kIOHIDOptionsTypeNone : kIOHIDOptionsTypeSeizeDevice;
      auto status = IOHIDDeviceOpen(device, options);
      if (status != kIOReturnSuccess) {
        std::cerr << "I-PAC open failed (" << status << "). Launch from the terminal granted Input Monitoring.\n";
        break;
      }
      opened.push_back(device);
    }
    if (opened.size() == 3) {
      IOHIDValueRef initial = nullptr;
      bool known = IOHIDDeviceGetValue(host.keyboard, host.button, &initial) == kIOReturnSuccess && initial;
      bool held = known && IOHIDValueGetIntegerValue(initial) != 0;
      pp_begin(host.inputs.get(), host.session, known && !held ? 1 : 0, held ? 1 : 0);
      for (auto device : opened) {
        IOHIDDeviceRegisterRemovalCallback(device, removed, &host);
        if (device != host.output) IOHIDDeviceRegisterInputValueCallback(device, input, &host);
        IOHIDDeviceScheduleWithRunLoop(device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
      }
      int flags = fcntl(STDIN_FILENO, F_GETFL);
      if (flags < 0 || fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK) < 0) host.failed = true;
      std::signal(SIGINT, stop); std::signal(SIGTERM, stop); std::signal(SIGPIPE, SIG_IGN);
      if (!host.failed && host.clear()) {
        std::cout << "{\"type\":\"ready\",\"version\":1,\"session\":" << host.session
          << ",\"released\":" << (known && !held ? "true" : "false") << "}" << std::endl;
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
              std::cerr << "Rejected peripheral command; clearing owned LED.\n";
              host.failed = true; break;
            }
            pending.erase(0, end + 1);
          }
          if (pending.size() > 16384) host.failed = true;
        }
        if (!host.disconnected) host.clear();
        result = host.failed ? 1 : 0;
      }
      if (flags >= 0) fcntl(STDIN_FILENO, F_SETFL, flags);
      for (auto device : opened) IOHIDDeviceUnscheduleFromRunLoop(device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
    }
  }
  for (auto device : opened) IOHIDDeviceClose(device, kIOHIDOptionsTypeNone);
  if (host.button) CFRelease(host.button);
  if (host.axis) CFRelease(host.axis);
  if (devices) CFRelease(devices);
  CFRelease(manager);
  return result;
}
