#include "linux_runtime.h"
#include "performance_light_output.h"
#include <linux/input.h>
#include <sys/wait.h>
#include <poll.h>
#include <fcntl.h>
#include <unistd.h>
#include <array>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <sstream>
using namespace peripheral_host;
bool interrupt_next_poll = false;
extern "C" int __real_poll(pollfd*, nfds_t, int);
extern "C" int __wrap_poll(pollfd* fds, nfds_t count, int timeout) {
  if (interrupt_next_poll) { interrupt_next_poll = false; raise(SIGTERM); }
  return __real_poll(fds, count, timeout);
}
namespace {
void require(bool value, const char* message) { if (!value) { std::fprintf(stderr, "%s\n", message); std::abort(); } }
void send(int fd, const void* value, size_t bytes) { require(write(fd, value, bytes) == ssize_t(bytes), "write owned synthetic fixture pipe"); }
struct Child {
  int inputs[3][2], led[2], commands[2], output[2];
  pid_t pid = -1;
  bool lights;
  Child(InitialState blue = InitialState::Released, bool with_lights = true, bool queued = false, bool interrupt = false) : lights(with_lights) {
    for (auto& pair : inputs) require(pipe2(pair, O_NONBLOCK | O_CLOEXEC) == 0, "create input pipe");
    for (auto pair : {led, commands, output}) require(pipe2(pair, O_NONBLOCK | O_CLOEXEC) == 0, "create output pipe");
    if (queued) {
      event(0, EV_KEY, KEY_A, 1, 10); event(0, EV_KEY, KEY_A, 0, 20);
      event(2, EV_SYN, SYN_DROPPED, 0, 12); event(2, EV_REL, REL_X, 11, 15);
    }
    pid = fork(); require(pid >= 0, "fork owned runtime fixture");
    if (!pid) {
      LinuxHandles handles;
      for (auto& pair : inputs) { close(pair[1]); handles.inputs.push_back(pair[0]); }
      close(led[0]); close(commands[1]); close(output[0]);
      require(dup2(output[1], STDOUT_FILENO) >= 0, "redirect fixture stdout"); close(output[1]);
      HostConfig config; config.session = 7;
      config.map.sources = {{"a", LinuxSelector{0, {0, 1}, {KEY_A, KEY_B}, {}}},
        {"b", LinuxSelector{1, {0, 1}, {KEY_A, KEY_B}, {}}}, {"c", LinuxSelector{2, {0, 2}, {}, {REL_X}}}};
      config.map.switches = {{PhysicalControl::Blue, 0, EV_KEY, KEY_A}, {PhysicalControl::Yellow, 1, EV_KEY, KEY_A}};
      config.map.axis = AxisBinding{2, EV_REL, REL_X};
      if (lights) config.map.leds = {{PhysicalControl::Blue, 9}, {PhysicalControl::Yellow, 12}};
      handles.output = lights ? led[1] : -1; handles.commands = commands[0];
      InitialStates initial; initial.fill(InitialState::Unknown);
      initial[0] = blue; initial[1] = InitialState::Released;
      interrupt_next_poll = interrupt;
      int code = run_linux_host(handles, config, initial, queued ? 1000020000 : 0);
      std::cout.flush(); _exit(code);
    }
    for (auto& pair : inputs) close(pair[0]);
    close(led[1]); close(commands[0]); close(output[1]);
    if (lights) clear_reports();
    auto ready = line();
    require(ready.find("\"version\":2") != std::string::npos
      && ready.find("\"controlId\":\"blue\",\"state\":\"" + std::string(blue == InitialState::Held ? "held" : blue == InitialState::Released ? "released" : "unknown")) != std::string::npos
      && ready.find("\"controlId\":\"yellow\",\"state\":\"released\"") != std::string::npos, "ready reports independent physical identities and actual initial states");
  }
  ~Child() {
    if (pid > 0) { kill(pid, SIGKILL); waitpid(pid, nullptr, 0); }
    for (auto& pair : inputs) if (pair[1] >= 0) close(pair[1]);
    for (int fd : {led[0], commands[1], output[0]}) if (fd >= 0) close(fd);
  }
  bool available(int fd, int milliseconds = 1000) {
    pollfd ready{fd, POLLIN, 0}; return poll(&ready, 1, milliseconds) == 1 && (ready.revents & POLLIN);
  }
  std::array<unsigned char, 5> report() {
    require(available(led[0]), "LED report arrives"); std::array<unsigned char, 5> bytes{};
    require(read(led[0], bytes.data(), bytes.size()) == ssize_t(bytes.size()), "complete five-byte brightness report"); return bytes;
  }
  void level(unsigned channel, unsigned value) { require(report() == std::array<unsigned char, 5>{3, (unsigned char)channel, (unsigned char)value, 0, 0}, "brightness report addresses only explicitly mapped channel"); }
  void clear_reports() { level(9, 0); level(12, 0); }
  std::string line() {
    std::string value; char byte;
    do { require(available(output[0]), "runtime output arrives"); require(read(output[0], &byte, 1) == 1, "read runtime output"); value += byte; } while (byte != '\n');
    return value;
  }
  void edge(const char* id, bool down, unsigned sequence) {
    auto value = line();
    require(value.find("\"controlId\":\"" + std::string(id) + "\"") != std::string::npos
      && value.find(down ? "\"down\":true" : "\"down\":false") != std::string::npos
      && value.find("\"sequence\":" + std::to_string(sequence) + ",") != std::string::npos, "identified edge and monotonic observation sequence match");
  }
  void event(unsigned source, unsigned short type, unsigned short code, int value, int microseconds) {
    input_event event{}; event.time.tv_sec = 1; event.time.tv_usec = microseconds; event.type = type; event.code = code; event.value = value;
    send(inputs[source][1], &event, sizeof(event));
  }
  void command(const std::string& value) { send(commands[1], value.data(), value.size()); }
  void pause() { require(kill(pid, SIGSTOP) == 0, "pause only owned fixture"); int status; require(waitpid(pid, &status, WUNTRACED) == pid && WIFSTOPPED(status), "owned fixture paused"); }
  void resume() { require(kill(pid, SIGCONT) == 0, "resume only owned fixture"); }
  void finish(int expected, int signal = 0, bool keep_commands = false) {
    if (signal) kill(pid, signal); else if (!keep_commands) { close(commands[1]); commands[1] = -1; }
    int status = 0; bool done = false;
    for (int attempt = 0; attempt < 3000; ++attempt) { if (waitpid(pid, &status, WNOHANG) == pid) { done = true; break; } usleep(1000); }
    require(done && WIFEXITED(status) && WEXITSTATUS(status) == expected, "owned runtime exits with expected result"); pid = -1;
  }
};
void independent_inputs() {
  Child child(InitialState::Held);
  child.event(0, EV_KEY, KEY_A, 1, 10);
  child.event(1, EV_KEY, KEY_A, 1, 20); child.edge("yellow", true, 2);
  child.event(0, EV_KEY, KEY_A, 2, 30);
  child.event(0, EV_KEY, KEY_A, 0, 40);
  child.edge("blue", false, 4);
  child.event(1, EV_KEY, KEY_A, 2, 50);
  child.event(1, EV_KEY, KEY_A, 0, 60); child.edge("yellow", false, 6);
  child.event(0, EV_KEY, KEY_A, 1, 70); child.edge("blue", true, 7);
  child.event(0, EV_KEY, KEY_B, 1, 80);
  child.event(0, EV_KEY, KEY_A, 0, 90); child.edge("blue", false, 9);
  require(!child.available(child.led[0], 25), "raw keys and repeats never synthesize musical LED state");
  child.finish(0, SIGHUP); child.clear_reports();
  Child unknown(InitialState::Unknown);
  unknown.event(0, EV_KEY, KEY_A, 2, 10); unknown.event(0, EV_KEY, KEY_A, 1, 20);
  require(!unknown.available(unknown.output[0], 25), "unknown or repeat cannot bypass release barrier");
  unknown.event(0, EV_KEY, KEY_A, 0, 30); unknown.edge("blue", false, 3);
  unknown.event(0, EV_KEY, KEY_A, 1, 40); unknown.edge("blue", true, 4);
  unknown.finish(0, SIGTERM); unknown.clear_reports();
}
void ordering_and_loss() {
  Child ordered;
  ordered.pause(); ordered.event(0, EV_KEY, KEY_A, 1, 200); ordered.event(1, EV_KEY, KEY_A, 1, 300); ordered.event(2, EV_REL, REL_X, -9, 100); ordered.resume();
  require(ordered.line().find("\"deltaY\":-9") != std::string::npos, "configured signed relative axis precedes later switches across three sources");
  ordered.edge("blue", true, 2); ordered.edge("yellow", true, 3);
  ordered.finish(0); ordered.clear_reports();
  Child ambiguous;
  ambiguous.pause(); ambiguous.event(0, EV_KEY, KEY_A, 1, 100); ambiguous.event(1, EV_KEY, KEY_A, 1, 100); ambiguous.resume();
  require(ambiguous.line().find("\"detached\"") != std::string::npos, "ambiguous cross-interface timestamps revoke instead of inventing colour order");
  ambiguous.finish(1); ambiguous.clear_reports();
  Child gap; gap.event(2, EV_SYN, SYN_DROPPED, 0, 10);
  require(gap.line().find("\"detached\"") != std::string::npos, "explicit dropped input revokes producer"); gap.finish(1); gap.clear_reports();
  Child partial; char byte = 0; send(partial.inputs[0][1], &byte, 1);
  require(partial.line().find("\"detached\"") != std::string::npos, "partial kernel event revokes producer"); partial.finish(1); partial.clear_reports();
  Child disconnected; close(disconnected.inputs[1][1]); disconnected.inputs[1][1] = -1;
  require(disconnected.line().find("\"detached\"") != std::string::npos, "one removed input revokes entire mapped producer"); disconnected.finish(1); disconnected.clear_reports();
}
std::string light(unsigned sequence, bool both = true) {
  std::array<double, PF_LIGHT_FIELDS> image{};
  image[PF_LIGHT_FORMAT] = 1; image[PF_LIGHT_GENERATION] = 1; image[PF_LIGHT_EPOCH] = 1;
  image[PF_LIGHT_SEQUENCE] = sequence; image[PF_LIGHT_RATE] = 48000; image[PF_LIGHT_COUNT] = both ? 2 : 1;
  image[PF_LIGHT_SAMPLES] = 257; image[PF_LIGHT_SAMPLES + 1] = .7;
  if (both) { image[PF_LIGHT_SAMPLES + PF_LIGHT_SAMPLE_FIELDS] = 258; image[PF_LIGHT_SAMPLES + PF_LIGHT_SAMPLE_FIELDS + 1] = 1; }
  std::ostringstream command; command.precision(17); command << "light 100 7 1 1";
  for (double value : image) command << ' ' << value;
  return command.str() + '\n';
}
void complete_images() {
  Child child;
  child.command("bind 100 7 1 1\n"); child.clear_reports();
  child.command(light(1)); child.level(9, 179); child.level(12, 255);
  require(child.line().find("\"publication\":1") != std::string::npos, "full frame commits after both mapped brightness writes");
  child.command(light(2, false)); child.level(9, 179); child.level(12, 0);
  require(child.line().find("\"publication\":2") != std::string::npos, "absent logical output clears its independently mapped LED");
  child.command(light(1)); require(!child.available(child.led[0], 25), "stale publication produces no output writes");
  close(child.led[0]); child.led[0] = -1;
  child.command(light(3));
  require(child.line().find("\"detached\"") != std::string::npos, "failed report is never acknowledged as committed publication"); child.finish(1);
  Child input_only(InitialState::Released, false);
  input_only.command("bind 100 7 1 1\n" + light(1));
  require(input_only.line().find("\"publication\":1") != std::string::npos && !input_only.available(input_only.led[0], 25), "empty LED map binds and commits with no output FD or writes");
  input_only.event(1, EV_KEY, KEY_A, 1, 10); input_only.edge("yellow", true, 1); input_only.finish(0);
}
void startup_and_signal() {
  Child buffered(InitialState::Released, true, true);
  require(!buffered.available(buffered.output[0], 25), "pre-ready buffered input and pre-cutoff drop do not activate");
  buffered.event(0, EV_KEY, KEY_A, 1, 30); buffered.edge("blue", true, 1); buffered.finish(0, SIGINT); buffered.clear_reports();
  Child signaled(InitialState::Released, true, false, true);
  signaled.finish(0, 0, true); signaled.clear_reports();
  Child malformed; malformed.command("bad-command\n");
  require(malformed.line().find("\"detached\"") != std::string::npos, "malformed command revokes and clears mapped outputs"); malformed.finish(1); malformed.clear_reports();
}
}
int main() {
  independent_inputs(); ordering_and_loss(); complete_images(); startup_and_signal();
  std::puts("Linux v2 runtime pipe fixtures passed. No devices or audio opened.");
}
