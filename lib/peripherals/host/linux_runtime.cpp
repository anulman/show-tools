#include "linux_runtime.h"
#include "linux_order.h"
#include "linux_input_map.h"
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

namespace peripheral_host {
namespace {
volatile std::sig_atomic_t running = 1;
void stop(int) { running = 0; }
struct Host {
  const LinuxHandles& handles;
  const HostConfig& config;
  double sequence = 0;
  bool bound = false, owns_output = false;
  InitialStates states;
  PhysicalFeedback feedback;
  pp_light_connection connection{};
  std::vector<pp_light_binding> bindings;
  std::unique_ptr<pp_inputs, decltype(&pp_destroy)> inputs{pp_create(), pp_destroy};
  std::unique_ptr<pp_light_delivery, decltype(&pp_light_delivery_destroy)> delivery{pp_light_delivery_create(), pp_light_delivery_destroy};
  Host(const LinuxHandles& h, const HostConfig& c, const InitialStates& initial)
    : handles(h), config(c), states(initial), feedback(states), bindings(light_bindings(c.map)) {}
  ~Host() { if (owns_output) clear(); }
  bool report(const uint8_t* bytes) {
    ssize_t sent;
    do { sent = write(handles.output, bytes, PP_LED_REPORT_BYTES); } while (sent < 0 && errno == EINTR && running);
    if (sent == PP_LED_REPORT_BYTES) return true;
    std::cerr << "I-PAC brightness write failed or was short: " << std::strerror(errno) << '\n';
    return false;
  }
  bool clear() {
    bool ok = true;
    for (const auto& binding : bindings) {
      uint8_t bytes[PP_LED_REPORT_BYTES];
      if (pp_ipac_led_report(binding.sdk_channel, 0, bytes) != PP_LED_REPORT_BYTES || !report(bytes)) ok = false;
    }
    return ok;
  }
  bool render_feedback() {
    for (const auto& led : config.map.leds) {
      uint8_t bytes[PP_LED_REPORT_BYTES];
      if (pp_ipac_led_report(led.sdk_channel, feedback.level(led.control), bytes) != PP_LED_REPORT_BYTES || !report(bytes)) return false;
    }
    return true;
  }
  bool clear_baseline() { feedback.clear_baseline(); return render_feedback(); }
  bool command(const Command& value) {
    if (value.operation == Operation::Clear) {
      if (value.scoped && (!bound || !same_connection(value.connection, connection))) return true;
      bound = false; return clear_baseline();
    }
    if (value.operation == Operation::Quit) { running = 0; return true; }
    if (value.connection.device_session != config.session) return false;
    if (value.operation == Operation::Bind) {
      if (value.connection.request_fence <= connection.request_fence) return true;
      if (pp_light_delivery_bind(delivery.get(), &value.connection, bindings.data(), uint32_t(bindings.size())) != 0) return false;
      connection = value.connection; bound = true; return clear_baseline();
    }
    if (!bound) return true;
    pp_light_delivery_frame frame{};
    int result = pp_light_delivery_prepare(delivery.get(), &value.connection, value.image.data(), value.image.size(), &frame);
    if (result == PP_STALE) return true;
    if (result != 1) return false;
    for (uint32_t index = 0; index < frame.count; ++index) {
      const auto& led = config.map.leds[index];
      uint8_t bytes[PP_LED_REPORT_BYTES];
      if (pp_ipac_led_report(led.sdk_channel, feedback.level(led.control, frame.reports[index][2]), bytes) != PP_LED_REPORT_BYTES || !report(bytes)) return false;
    }
    if (pp_light_delivery_commit(delivery.get(), &frame) != 1) return false;
    feedback.commit_baseline(config.map.leds, frame);
    std::cout << "{\"type\":\"delivered\",\"publication\":" << frame.publication << "}" << std::endl;
    return std::cout.good();
  }
  bool input(const LinuxObservation& value) {
    if (sequence >= 9007199254740991.) return false;
    ++sequence;
    if (value.kind == LinuxInputKind::Button) {
      if (value.value == 2) return true;
      const auto prior = states[value.control];
      int edge = pp_key(inputs.get(), config.session, sequence, value.control, value.value);
      if (edge < 0) return false;
      states[value.control] = value.value ? InitialState::Held : InitialState::Released;
      if (states[value.control] != prior && !render_feedback()) return false;
      // The engine received Ready's held/unknown barrier too. Its first release
      // must reach that engine even when the local latch has no admitted press.
      if (!value.value && prior != InitialState::Released)
        return emit_button(std::cout, config.session, sequence, PhysicalControl(value.control), false);
      if (edge == PP_PRESS || edge == PP_RELEASE)
        return emit_button(std::cout, config.session, sequence, PhysicalControl(value.control), edge == PP_PRESS);
    } else if (value.kind == LinuxInputKind::Motion) {
      int result = pp_rotate(inputs.get(), config.session, sequence, value.value);
      if (result < 0) return false;
      if (result == PP_MOVEMENT) return emit_motion(std::cout, config.session, sequence, value.value);
    }
    return std::cout.good();
  }
};
bool drain(int fd, unsigned source, int64_t cutoff, const InputMap& map, std::vector<LinuxObservation>& batch) {
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
      if (event.type == EV_SYN && event.code == SYN_DROPPED) { std::cerr << "I-PAC SYN_DROPPED: input lost; revoke and reconnect.\n"; return false; }
      if (event.type != EV_KEY && event.type != EV_REL) continue;
      if ((event.type == EV_KEY && (event.value < 0 || event.value > 2))
        || (event.type == EV_REL && (event.value < -32768 || event.value > 32767))) return false;
      if (batch.size() == 256) { std::cerr << "I-PAC input backlog exceeded 256 observations.\n"; return false; }
      const auto* key = linux_switch(map, source, event.type, event.code);
      const bool motion = linux_axis(map, source, event.type, event.code);
      batch.push_back({source, time, key ? LinuxInputKind::Button : motion ? LinuxInputKind::Motion : LinuxInputKind::Ignored,
        event.value, key ? uint32_t(key->control) : 0});
    }
  }
}
}
int run_linux_host(const LinuxHandles& handles, const HostConfig& config, const InitialStates& initial, int64_t cutoff) {
  if (handles.inputs.empty() || handles.inputs.size() > 8 || handles.inputs.size() != config.map.sources.size()
    || handles.commands < 0 || (!config.map.leds.empty() && handles.output < 0)) return 1;
  Host host(handles, config, initial);
  uint32_t released = 0, held = 0;
  for (const auto& binding : config.map.switches) {
    auto id = size_t(binding.control);
    if (initial[id] == InitialState::Released) released |= 1u << id;
    if (initial[id] == InitialState::Held) held |= 1u << id;
  }
  if (!host.inputs || !host.delivery || pp_begin(host.inputs.get(), config.session, released, held) != 0) return 1;
  running = 1;
  std::signal(SIGINT, stop); std::signal(SIGTERM, stop); std::signal(SIGHUP, stop); std::signal(SIGPIPE, SIG_IGN);
  host.owns_output = true;
  if (!host.render_feedback()) return 1;
  bool failed = !emit_ready(std::cout, config.session, config.map, initial), disconnected = false;
  std::string pending;
  LinuxInputOrder last;
  while (running && !failed) {
    std::vector<pollfd> pollers;
    for (int fd : handles.inputs) pollers.push_back({fd, POLLIN, 0});
    pollers.push_back({handles.commands, POLLIN, 0});
    int result = poll(pollers.data(), pollers.size(), 250);
    if (!running) break;
    if (result < 0 && errno == EINTR) continue;
    if (result < 0) { failed = true; break; }
    for (size_t source = 0; source < handles.inputs.size(); ++source)
      if (pollers[source].revents & (POLLHUP | POLLERR | POLLNVAL)) disconnected = true;
    if (disconnected) break;
    std::vector<LinuxObservation> batch;
    for (unsigned source = 0; source < handles.inputs.size(); ++source)
      if (!drain(handles.inputs[source], source, cutoff, config.map, batch)) { failed = true; break; }
    if (failed || !order_linux_input(batch, last, handles.inputs.size())) {
      std::cerr << "I-PAC input loss, invalid record or ambiguous cross-interface order; revoke and reconnect.\n"; failed = true; break;
    }
    for (const auto& value : batch) {
      if (!running) break;
      if (!host.input(value)) { failed = true; break; }
      last = {value.nanoseconds, value.source};
    }
    if (failed || !running) continue;
    if (pollers.back().revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) {
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
  if (failed || disconnected) emit_detached(std::cout, config.session);
  if (!host.clear()) failed = true;
  host.owns_output = false;
  if (failed) std::cerr << "Peripheral host failed; mapped LED clear attempted.\n";
  return failed || disconnected ? 1 : 0;
}
}
