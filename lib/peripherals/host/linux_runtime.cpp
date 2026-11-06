#include "linux_runtime.h"
#include "linux_order.h"
#include "control_stream.h"
#include "peripheral_controls.h"
#include <linux/input.h>
#include <poll.h>
#include <unistd.h>
#include <cerrno>
#include <csignal>
#include <cstring>
#include <iostream>
#include <limits>
#include <memory>
#include <string>

namespace peripheral_host {
namespace {
volatile std::sig_atomic_t running = 1;
void stop(int) { running = 0; }
struct Host {
  LinuxHandles handles;
  double session, sequence = 0;
  uint32_t channel;
  bool bench, bound = false, owns_output = false;
  std::unique_ptr<pp_inputs, decltype(&pp_destroy)> inputs{pp_create(), pp_destroy};
  std::unique_ptr<pp_light_delivery, decltype(&pp_light_delivery_destroy)> delivery{pp_light_delivery_create(), pp_light_delivery_destroy};
  ~Host() { if (owns_output) brightness(0); }
  bool report(const uint8_t* bytes) {
    ssize_t sent;
    do { sent = write(handles.output, bytes, PP_LED_REPORT_BYTES); } while (sent < 0 && errno == EINTR && running);
    if (sent == PP_LED_REPORT_BYTES) return true;
    std::cerr << "I-PAC brightness write failed or was short: " << std::strerror(errno) << '\n';
    return false;
  }
  bool brightness(uint32_t level) {
    uint8_t bytes[PP_LED_REPORT_BYTES];
    return pp_ipac_led_report(channel, level, bytes) == PP_LED_REPORT_BYTES && report(bytes);
  }
  bool command(const Command& value) {
    if (value.operation == Operation::Clear) { bound = false; return brightness(0); }
    if (value.operation == Operation::Quit) { running = 0; return true; }
    if (value.connection.device_session != session) return false;
    if (value.operation == Operation::Bind) {
      pp_light_binding binding{1, channel}; bound = false;
      if (!brightness(0) || pp_light_delivery_bind(delivery.get(), &value.connection, &binding, 1) != 0) return false;
      bound = true; return true;
    }
    if (!bound) return false;
    pp_light_delivery_frame frame{};
    int result = pp_light_delivery_prepare(delivery.get(), &value.connection, value.image.data(), value.image.size(), &frame);
    if (result == PP_STALE) return true;
    if (result != 1) return false;
    for (uint32_t index = 0; index < frame.count; ++index) if (!report(frame.reports[index])) return false;
    if (pp_light_delivery_commit(delivery.get(), &frame) != 1) return false;
    std::cout << "{\"type\":\"delivered\",\"publication\":" << frame.publication << "}" << std::endl;
    return std::cout.good();
  }
  bool input(const LinuxObservation& value) {
    if (sequence >= 9007199254740991.) return false;
    ++sequence;
    if (value.kind == LinuxInputKind::Button) {
      int edge = pp_key(inputs.get(), session, sequence, 0, value.value);
      if (edge < 0) return false;
      if (edge == PP_PRESS || edge == PP_RELEASE) {
        if (bench && !brightness(edge == PP_PRESS ? 255 : 0)) return false;
        std::cout << "{\"type\":\"button\",\"session\":" << session << ",\"sequence\":" << sequence
          << ",\"down\":" << (edge == PP_PRESS ? "true" : "false") << "}" << std::endl;
      }
    } else {
      int result = pp_rotate(inputs.get(), session, sequence, value.value);
      if (result < 0) return false;
      if (result == PP_MOVEMENT) std::cout << "{\"type\":\"motion\",\"session\":" << session
        << ",\"sequence\":" << sequence << ",\"deltaY\":" << value.value << "}" << std::endl;
    }
    return std::cout.good();
  }
};
bool drain(int fd, unsigned source, int64_t cutoff, std::vector<LinuxObservation>& batch) {
  size_t observed = 0;
  for (;;) {
    input_event events[32];
    ssize_t bytes = read(fd, events, sizeof(events));
    if (bytes < 0 && errno == EINTR) continue;
    if (bytes < 0 && errno == EAGAIN) return true;
    if (bytes <= 0 || bytes % sizeof(input_event)) { std::cerr << "I-PAC input ended or returned a partial event.\n"; return false; }
    observed += size_t(bytes) / sizeof(input_event);
    if (observed > 512) { std::cerr << "I-PAC raw input backlog exceeded 512 records.\n"; return false; }
    for (size_t index = 0; index < size_t(bytes) / sizeof(input_event); ++index) {
      const auto& event = events[index];
      if (event.time.tv_sec < 0 || event.time.tv_sec > (std::numeric_limits<int64_t>::max() - 999999999) / 1000000000
        || event.time.tv_usec < 0 || event.time.tv_usec > 999999) return false;
      int64_t time = int64_t(event.time.tv_sec) * 1000000000 + int64_t(event.time.tv_usec) * 1000;
      if (time <= cutoff) continue;
      if (event.type == EV_SYN && event.code == SYN_DROPPED) { std::cerr << "I-PAC SYN_DROPPED: lost rotation cannot be recovered. Reconnect after releasing the button.\n"; return false; }
      bool key = source == 0 && event.type == EV_KEY && event.code == KEY_TAB;
      bool motion = source == 1 && event.type == EV_REL && event.code == REL_Y;
      if (!key && !motion) continue;
      if (key && event.value == 2) continue;
      if ((key && event.value != 0 && event.value != 1) || (motion && (event.value < -32768 || event.value > 32767))) return false;
      if (batch.size() == 256) { std::cerr << "I-PAC input backlog exceeded 256 observations.\n"; return false; }
      batch.push_back({source, time,
        key ? LinuxInputKind::Button : LinuxInputKind::Motion, event.value});
    }
  }
}
}
int run_linux_host(LinuxHandles handles, double session, uint32_t channel, bool initially_held, bool bench, int64_t startup_cutoff_ns) {
  Host host{handles, session, 0, channel, bench};
  if (!host.inputs || !host.delivery || pp_begin(host.inputs.get(), session, initially_held ? 0 : 1, initially_held ? 1 : 0) != 0) return 1;
  running = 1;
  std::signal(SIGINT, stop); std::signal(SIGTERM, stop); std::signal(SIGPIPE, SIG_IGN);
  std::cout.precision(17);
  if (!host.brightness(0)) return 1;
  host.owns_output = true;
  std::cout << "{\"type\":\"ready\",\"version\":1,\"session\":" << session
    << ",\"released\":" << (initially_held ? "false" : "true") << "}" << std::endl;
  bool failed = !std::cout.good(), disconnected = false;
  std::string pending;
  LinuxInputOrder last;
  while (running && !failed) {
    pollfd pollers[]{{handles.keyboard, POLLIN, 0}, {handles.mouse, POLLIN, 0}, {handles.commands, short(bench ? 0 : POLLIN), 0}};
    int result = poll(pollers, bench ? 2 : 3, 250);
    if (result < 0 && errno == EINTR) continue;
    if (result < 0) { failed = true; break; }
    if ((pollers[0].revents | pollers[1].revents) & (POLLHUP | POLLERR | POLLNVAL)) { disconnected = true; break; }
    std::vector<LinuxObservation> batch;
    if (!drain(handles.keyboard, 0, startup_cutoff_ns, batch) || !drain(handles.mouse, 1, startup_cutoff_ns, batch) || !order_linux_input(batch, last)) {
      std::cerr << "I-PAC input gap, invalid record or ambiguous cross-interface event order. Reconnect.\n"; failed = true; break;
    }
    for (const auto& value : batch) {
      if (!host.input(value)) { failed = true; break; }
      last = {value.nanoseconds, value.source};
    }
    if (bench || failed) continue;
    if (pollers[2].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) {
      char bytes[4096]; ssize_t count = read(handles.commands, bytes, sizeof(bytes));
      if (count == 0) { if (!pending.empty()) failed = true; break; }
      if (count < 0) { if (errno == EAGAIN || errno == EINTR) continue; failed = true; break; }
      pending.append(bytes, size_t(count));
      size_t end;
      while ((end = pending.find('\n')) != std::string::npos) {
        Command command;
        if (!parse_command(pending.substr(0, end), command) || !host.command(command)) { failed = true; break; }
        pending.erase(0, end + 1);
        if (!running) break;
      }
      if (pending.size() > 16384) failed = true;
    }
  }
  if (disconnected) std::cout << "{\"type\":\"detached\",\"session\":" << session << "}" << std::endl;
  if (!host.brightness(0)) failed = true;
  host.owns_output = false;
  if (failed) std::cerr << "Peripheral host failed; owned LED clear attempted.\n";
  return failed || disconnected ? 1 : 0;
}
}
