#pragma once

#include "instrument.h"

namespace native_host {
class AlsaRun {
 public:
  template<class Device>
  int start(Instrument& instrument, Device& device, const Start& start) {
    if (active_ || instrument.lifecycle() != Lifecycle::Prepared || instrument.pending()) return -1;
    if (device.prepare() < 0) return -2;
    if (!instrument.start(start)) return -1;
    active_ = true;
    return 0;
  }

  template<class Device>
  int complete(Instrument& instrument, Device& device) {
    if (!active_ || instrument.lifecycle() == Lifecycle::Running || instrument.pending()) return 0;
    if (instrument.lifecycle() == Lifecycle::Faulted) return -1;
    int result = device.finish();
    if (result < 0) return -1;
    if (result == 0) active_ = false;
    return 0;
  }

  template<class Device>
  int drop(Device& device) {
    active_ = false;
    return device.drop();
  }
  bool active() const { return active_; }
 private:
  bool active_ = false;
};
}
