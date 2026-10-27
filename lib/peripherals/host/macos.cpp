#include "probe.h"
#include "peripheral_controls.h"
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/hid/IOHIDManager.h>
#include <IOKit/IOKitLib.h>
#include <charconv>
#include <csignal>
#include <iostream>
#include <vector>

namespace peripheral_probe {
namespace {
volatile std::sig_atomic_t running = 1;
void stop(int) { running = 0; }
int property(IOHIDDeviceRef device, CFStringRef key) {
  auto value = IOHIDDeviceGetProperty(device, key);
  int out = 0;
  if (value && CFGetTypeID(value) == CFNumberGetTypeID()) CFNumberGetValue(static_cast<CFNumberRef>(value), kCFNumberIntType, &out);
  return out;
}
uint64_t identifier(IOHIDDeviceRef device) {
  uint64_t value = 0;
  IORegistryEntryGetRegistryEntryID(IOHIDDeviceGetService(device), &value);
  return value;
}
std::string name(IOHIDDeviceRef device) {
  auto value = IOHIDDeviceGetProperty(device, CFSTR(kIOHIDProductKey));
  char text[512]{};
  if (value && CFGetTypeID(value) == CFStringGetTypeID() &&
      CFStringGetCString(static_cast<CFStringRef>(value), text, sizeof(text), kCFStringEncodingUTF8)) return text;
  return "";
}
void describe(IOHIDDeviceRef device) {
  std::cout << "{\"type\":\"device\",\"platform\":\"macos\",\"device\":" << quote(std::to_string(identifier(device)))
    << ",\"name\":" << quote(name(device)) << ",\"vendor\":" << property(device, CFSTR(kIOHIDVendorIDKey))
    << ",\"product\":" << property(device, CFSTR(kIOHIDProductIDKey))
    << ",\"usagePage\":" << property(device, CFSTR(kIOHIDPrimaryUsagePageKey))
    << ",\"usage\":" << property(device, CFSTR(kIOHIDPrimaryUsageKey)) << ",\"outputBytes\":"
    << property(device, CFSTR(kIOHIDMaxOutputReportSizeKey)) << ",\"reportDescriptor\":\"";
  auto descriptor = IOHIDDeviceGetProperty(device, CFSTR(kIOHIDReportDescriptorKey));
  const char* hex = "0123456789abcdef";
  if (descriptor && CFGetTypeID(descriptor) == CFDataGetTypeID()) {
    auto data = static_cast<CFDataRef>(descriptor);
    for (CFIndex i = 0; i < CFDataGetLength(data); ++i) {
      auto byte = CFDataGetBytePtr(data)[i];
      std::cout << hex[byte >> 4] << hex[byte & 15];
    }
  }
  std::cout << "\"}" << std::endl;
}
struct Listener { uint64_t selected = 0, sequence = 0; bool disconnected = false; };
void input(void* context, IOReturn status, void*, IOHIDValueRef value) {
  if (status != kIOReturnSuccess || !value) { std::cout << "{\"type\":\"error\",\"reason\":\"input-callback\"}" << std::endl; std::cerr << "Invalid input callback (" << status << ").\n"; return; }
  if (IOHIDValueGetLength(value) > CFIndex(sizeof(CFIndex))) return;
  auto& listener = *static_cast<Listener*>(context);
  auto element = IOHIDValueGetElement(value);
  auto device = IOHIDElementGetDevice(element);
  auto id = identifier(device);
  if (listener.selected && listener.selected != id) return;
  auto page = IOHIDElementGetUsagePage(element), usage = IOHIDElementGetUsage(element);
  std::cout << "{\"type\":\"input\",\"platform\":\"macos\",\"device\":" << quote(std::to_string(id))
    << ",\"sequence\":" << listener.sequence++ << ",\"hostTimeNs\":" << quote(std::to_string(host_time_ns()))
    << ",\"deviceTicks\":" << quote(std::to_string(IOHIDValueGetTimeStamp(value)))
    << ",\"timestampDomain\":\"mach_absolute_time\",\"usagePage\":" << page << ",\"usage\":" << usage
    << ",\"relative\":" << (IOHIDElementIsRelative(element) ? "true" : "false")
    << ",\"value\":" << IOHIDValueGetIntegerValue(value) << "}" << std::endl;
}
void removed(void* context, IOReturn, void*, IOHIDDeviceRef device) {
  auto& listener = *static_cast<Listener*>(context);
  auto id = identifier(device);
  if (listener.selected && listener.selected != id) return;
  std::cout << "{\"type\":\"disconnect\",\"device\":" << quote(std::to_string(id)) << "}" << std::endl;
  if (listener.selected) { listener.disconnected = true; running = 0; }
}
bool report_supported(IOHIDDeviceRef device) {
  int product = property(device, CFSTR(kIOHIDProductIDKey));
  if (property(device, CFSTR(kIOHIDVendorIDKey)) != 0xd209 || product < 0x0410 || product > 0x0413) return false;
  auto value = IOHIDDeviceGetProperty(device, CFSTR(kIOHIDReportDescriptorKey));
  if (!value || CFGetTypeID(value) != CFDataGetTypeID()) return false;
  auto data = static_cast<CFDataRef>(value);
  return pp_ipac_led_descriptor(CFDataGetBytePtr(data), uint32_t(CFDataGetLength(data))) == 1;
}
}

int run(const Request& request) {
  uint64_t selected = 0;
  if (request.mode != Mode::list && request.device != "all") {
    auto parsed = std::from_chars(request.device.data(), request.device.data() + request.device.size(), selected);
    if (parsed.ec != std::errc{} || parsed.ptr != request.device.data() + request.device.size() || selected == 0) {
      std::cerr << "Select a registry device ID reported by list.\n"; return 2;
    }
  }
  if (request.mode == Mode::led && selected == 0) { std::cerr << "LED output requires one device ID.\n"; return 2; }
  auto manager = IOHIDManagerCreate(kCFAllocatorDefault, kIOHIDOptionsTypeNone);
  if (!manager) { std::cerr << "Cannot create IOKit manager.\n"; return 1; }
  auto matching = CFDictionaryCreateMutable(kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  int vendor = 0xd209;
  auto number = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &vendor);
  CFDictionarySetValue(matching, CFSTR(kIOHIDVendorIDKey), number);
  IOHIDManagerSetDeviceMatching(manager, matching);
  CFRelease(number); CFRelease(matching);
  IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
  auto devices = IOHIDManagerCopyDevices(manager);
  std::vector<const void*> found(devices ? CFSetGetCount(devices) : 0);
  if (devices) CFSetGetValues(devices, found.data());
  IOHIDDeviceRef target = nullptr;
  for (auto entry : found) {
    auto device = static_cast<IOHIDDeviceRef>(const_cast<void*>(entry));
    if (request.mode == Mode::list) describe(device);
    if (identifier(device) == selected) target = device;
  }
  int exit = 0;
  if (request.mode == Mode::list && found.empty()) { std::cerr << "No Ultimarc interfaces found. Check USB connection.\n"; exit = 1; }
  if (request.mode == Mode::led) {
    if (!target || !report_supported(target)) {
      std::cerr << "No supported I-PAC output descriptor selected. Nothing written. Save list output for inspection.\n"; exit = 1;
    } else if (IOHIDDeviceOpen(target, kIOHIDOptionsTypeNone) != kIOReturnSuccess) {
      std::cerr << "Cannot open selected output interface. Nothing written.\n"; exit = 1;
    } else {
      uint8_t bytes[PP_LED_REPORT_BYTES];
      pp_ipac_led_report(request.channel, request.level, bytes);
      auto status = IOHIDDeviceSetReport(target, kIOHIDReportTypeOutput, bytes[0], bytes, sizeof(bytes));
      IOHIDDeviceClose(target, kIOHIDOptionsTypeNone);
      std::cout << "{\"type\":\"led-write\",\"channel\":" << request.channel << ",\"level\":" << request.level << ",\"status\":" << status << "}\n";
      exit = status == kIOReturnSuccess ? 0 : 1;
    }
  }
  if (request.mode == Mode::listen) {
    if (found.empty() || (selected && !target)) { std::cerr << "Selected interface not found. Run list again.\n"; exit = 1; }
    else {
      Listener listener{selected};
      IOHIDManagerRegisterInputValueCallback(manager, input, &listener);
      IOHIDManagerRegisterDeviceRemovalCallback(manager, removed, &listener);
      auto status = IOHIDManagerOpen(manager, kIOHIDOptionsTypeNone);
      if (status != kIOReturnSuccess) { std::cerr << "Input open failed (" << status << "). Check macOS Privacy & Security > Input Monitoring for this terminal.\n"; exit = 1; }
      else {
        std::signal(SIGINT, stop); std::signal(SIGTERM, stop);
        std::cerr << "Listening without device seizure. Ctrl-C stops. No LED writes.\n";
        while (running) CFRunLoopRunInMode(kCFRunLoopDefaultMode, .25, false);
        if (!listener.disconnected) std::cout << "{\"type\":\"stopped\"}" << std::endl;
        IOHIDManagerClose(manager, kIOHIDOptionsTypeNone);
      }
    }
  }
  IOHIDManagerUnscheduleFromRunLoop(manager, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
  if (devices) CFRelease(devices);
  CFRelease(manager);
  return exit;
}
}
