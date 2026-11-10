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
#include <string>

bool interrupt_next_poll = false;
extern "C" int __real_poll(pollfd*, nfds_t, int);
extern "C" int __wrap_poll(pollfd* fds, nfds_t count, int timeout) {
  if (interrupt_next_poll) { interrupt_next_poll = false; raise(SIGTERM); }
  return __real_poll(fds, count, timeout);
}
namespace {
void require(bool value, const char* message) { if (!value) { std::fprintf(stderr, "%s\n", message); std::abort(); } }
void send(int fd, const void* value, size_t bytes) { require(write(fd, value, bytes) == ssize_t(bytes), "write synthetic runtime input"); }
struct Child {
  int key[2], mouse[2], led[2], commands[2], output[2];
  pid_t pid;
  Child(bool held = false, bool bench = false, bool queued = false, bool interrupt_poll = false, bool fresh_on_stop = false, peripheral_host::ButtonKey button_key = peripheral_host::ButtonKey::Tab) {
    for (auto pair : {key, mouse, led, commands, output}) require(pipe2(pair, O_NONBLOCK | O_CLOEXEC) == 0, "create owned fixture pipe");
    const auto selected_code = peripheral_host::linux_button_code(button_key);
    if (queued) {
      event(key[1], EV_KEY, selected_code, 1, 10); event(key[1], EV_KEY, selected_code, 0, 20);
      event(mouse[1], EV_SYN, SYN_DROPPED, 0, 12); event(mouse[1], EV_REL, REL_Y, 11, 15);
    }
    if (fresh_on_stop) event(key[1], EV_KEY, selected_code, 1, 100);
    pid = fork(); require(pid >= 0, "fork owned runtime fixture");
    if (!pid) {
      close(key[1]); close(mouse[1]); close(led[0]); close(commands[1]); close(output[0]);
      require(dup2(output[1], STDOUT_FILENO) >= 0, "redirect fixture stdout"); close(output[1]);
      interrupt_next_poll = interrupt_poll;
      int code = peripheral_host::run_linux_host({key[0], mouse[0], led[1], commands[0]}, 7, 0, held, bench, queued ? 1000020000 : 0, button_key);
      std::cout.flush(); _exit(code);
    }
    close(key[0]); close(mouse[0]); close(led[1]); close(commands[0]); close(output[1]);
    require(report() == std::array<unsigned char, 5>{3, 0, 0, 0, 0}, "startup clears only the selected brightness channel");
    require(line().find(held ? "\"released\":false" : "\"released\":true") != std::string::npos, "ready reports actual initial held state");
  }
  ~Child() {
    if (pid > 0) { kill(pid, SIGKILL); waitpid(pid, nullptr, 0); }
    for (int fd : {key[1], mouse[1], led[0], commands[1], output[0]}) if (fd >= 0) close(fd);
  }
  bool available(int fd, int milliseconds = 1000) {
    pollfd ready{fd, POLLIN, 0}; return poll(&ready, 1, milliseconds) == 1 && (ready.revents & POLLIN);
  }
  std::array<unsigned char, 5> report() {
    require(available(led[0]), "LED report arrives"); std::array<unsigned char, 5> bytes{};
    require(read(led[0], bytes.data(), bytes.size()) == ssize_t(bytes.size()), "complete five-byte brightness report"); return bytes;
  }
  std::string line() {
    std::string value; char byte;
    do { require(available(output[0]), "runtime output arrives"); require(read(output[0], &byte, 1) == 1, "read runtime output"); value += byte; } while (byte != '\n');
    return value;
  }
  void event(int fd, unsigned short type, unsigned short code, int value, int microseconds) {
    input_event event{}; event.time.tv_sec = 1; event.time.tv_usec = microseconds; event.type = type; event.code = code; event.value = value;
    send(fd, &event, sizeof(event));
  }
  void command(const std::string& value) { send(commands[1], value.data(), value.size()); }
  void finish(int expected, bool signal = false, bool leave_idle = false) {
    if (signal) kill(pid, SIGTERM); else if (!leave_idle) { close(commands[1]); commands[1] = -1; }
    int status = 0; bool done = false;
    for (int attempt = 0; attempt < 3000; ++attempt) { if (waitpid(pid, &status, WNOHANG) == pid) { done = true; break; } usleep(1000); }
    require(done && WIFEXITED(status) && WEXITSTATUS(status) == expected, "owned runtime exits with expected result"); pid = -1;
  }
};
void held_and_order() {
  Child child(true, true);
  child.event(child.key[1], EV_KEY, KEY_TAB, 1, 10);
  child.event(child.key[1], EV_KEY, KEY_TAB, 0, 20);
  require(!child.available(child.led[0], 30), "initially held button requires a fresh release and press");
  child.event(child.key[1], EV_KEY, KEY_TAB, 1, 30);
  require(child.report() == std::array<unsigned char, 5>{3, 0, 255, 0, 0}, "fresh press lights only selected channel");
  require(child.line().find("\"down\":true") != std::string::npos, "fresh press emitted once");
  child.event(child.key[1], EV_KEY, KEY_TAB, 2, 40);
  require(!child.available(child.led[0], 30), "kernel auto-repeat adds no LED write");
  child.event(child.key[1], EV_KEY, KEY_TAB, 0, 50);
  require(child.report()[2] == 0 && child.line().find("\"down\":false") != std::string::npos, "release clears brightness and emits its edge");
  child.finish(0, true); require(child.report()[2] == 0, "shutdown clears owned output");
  Child ordered;
  require(kill(ordered.pid, SIGSTOP) == 0, "pause only owned fixture");
  int status; require(waitpid(ordered.pid, &status, WUNTRACED) == ordered.pid && WIFSTOPPED(status), "owned fixture paused");
  ordered.event(ordered.key[1], EV_KEY, KEY_TAB, 1, 200);
  ordered.event(ordered.mouse[1], EV_REL, REL_Y, -9, 100);
  kill(ordered.pid, SIGCONT);
  require(ordered.line().find("\"deltaY\":-9") != std::string::npos, "earlier signed mouse observation emits before later key");
  require(ordered.line().find("\"down\":true") != std::string::npos, "button follows its actual later timestamp");
  ordered.finish(0); require(ordered.report()[2] == 0, "EOF clears owned output");
}
void escape_selection() {
  using peripheral_host::ButtonKey;
  Child held(true, true, false, false, false, ButtonKey::Escape);
  held.event(held.key[1], EV_KEY, KEY_TAB, 1, 10);
  held.event(held.key[1], EV_KEY, KEY_TAB, 0, 20);
  held.event(held.key[1], EV_KEY, KEY_ESC, 1, 30);
  held.event(held.key[1], EV_KEY, KEY_ESC, 0, 40);
  require(!held.available(held.led[0], 30) && !held.available(held.output[0], 30), "Escape selection ignores Tab and retains initially-held release barrier");
  held.event(held.key[1], EV_KEY, KEY_ESC, 1, 50);
  require(held.report()[2] == 255 && held.line().find("\"down\":true") != std::string::npos, "selected Escape fresh press lights and emits");
  held.event(held.key[1], EV_KEY, KEY_ESC, 2, 60);
  held.event(held.key[1], EV_KEY, KEY_TAB, 1, 70);
  require(!held.available(held.led[0], 30) && !held.available(held.output[0], 30), "Escape repeat and unselected Tab add no edge or LED write");
  held.event(held.key[1], EV_KEY, KEY_ESC, 0, 80);
  require(held.report()[2] == 0 && held.line().find("\"down\":false") != std::string::npos, "selected Escape release clears and emits");
  require(kill(held.pid, SIGHUP) == 0, "signal only owned Escape fixture");
  held.finish(0, false, true);
  require(held.report()[2] == 0, "SIGHUP exits and clears owned Escape LED");
  Child stale(false, true, true, false, false, ButtonKey::Escape);
  require(!stale.available(stale.led[0], 30) && !stale.available(stale.output[0], 30), "selected Escape pre-ready observations stay discarded");
  stale.event(stale.key[1], EV_KEY, KEY_ESC, 1, 30);
  require(stale.report()[2] == 255 && stale.line().find("\"down\":true") != std::string::npos, "post-cutoff Escape press admits normally");
  stale.finish(0, true); require(stale.report()[2] == 0, "Escape fixture finishes dark");
}
void protocol_and_failures() {
  Child protocol;
  protocol.command("bind 100 7 1 1\n"); require(protocol.report()[2] == 0, "binding clears before publication");
  std::array<double, PF_LIGHT_FIELDS> image{};
  image[PF_LIGHT_FORMAT] = 1; image[PF_LIGHT_GENERATION] = 1; image[PF_LIGHT_EPOCH] = 1;
  image[PF_LIGHT_SEQUENCE] = 1; image[PF_LIGHT_RATE] = 48000; image[PF_LIGHT_COUNT] = 1;
  image[PF_LIGHT_SAMPLES] = 1; image[PF_LIGHT_SAMPLES + 1] = .7;
  std::ostringstream command; command.precision(17); command << "light 100 7 1 1";
  for (double value : image) command << ' ' << value;
  command << '\n'; protocol.command(command.str());
  require(protocol.report()[2] == 179, "native seventy-percent image reaches real runtime write path");
  require(protocol.line().find("\"publication\":1") != std::string::npos, "delivery acknowledged after successful write");
  protocol.command("bad-command\n"); protocol.finish(1); require(protocol.report()[2] == 0, "malformed command fails and clears");
  Child gap;
  gap.event(gap.mouse[1], EV_SYN, SYN_DROPPED, 0, 10);
  gap.finish(1); require(gap.report()[2] == 0, "SYN_DROPPED fails closed and attempts dark");
  Child partial;
  char byte = 0; send(partial.key[1], &byte, 1);
  partial.finish(1); require(partial.report()[2] == 0, "partial event fails closed");
}
void startup_and_signal_barriers() {
  Child buffered(false, true, true);
  require(!buffered.available(buffered.output[0], 30) && !buffered.available(buffered.led[0], 30), "buffered pre-ready press/release and rotation do not activate");
  buffered.event(buffered.key[1], EV_KEY, KEY_TAB, 1, 30);
  require(buffered.report()[2] == 255 && buffered.line().find("\"down\":true") != std::string::npos, "fresh post-cutoff press activates normally");
  buffered.finish(0, true); require(buffered.report()[2] == 0, "buffered fixture shuts down dark");
  Child signaled(false, false, false, true);
  signaled.finish(0, false, true);
  require(signaled.report()[2] == 0, "SIGTERM immediately before idle poll still exits and clears");
  Child signaled_ready(false, false, false, true, true);
  signaled_ready.finish(0, false, true);
  require(signaled_ready.report()[2] == 0 && !signaled_ready.available(signaled_ready.output[0], 30),
    "SIGTERM before a ready poll does not admit queued button input");
}
}
int main() {
  held_and_order(); escape_selection(); protocol_and_failures(); startup_and_signal_barriers();
  std::puts("Linux runtime pipe fixtures passed. No hardware or audio opened.");
}
