#pragma once

#include "instrument.h"

namespace native_host {
class AlsaRun {
 public:
  template<class Device>
  int start(Instrument& instrument, Device& device, const Start& start) {
    if ((finishing_ && !instrument.has_idle_utility_output()) || !instrument.can_start()) return -1;
    const bool reset = active_ && !instrument.idle_monitor_only();
    if (!instrument.start(start)) return -1;
    if (reset && drop(device) < 0) return -2;
    if (!active_ && device.prepare() < 0) return -2;
    active_ = true;
    return 0;
  }

  template<class Device>
  int utility(Instrument& instrument, Device& device) {
    if (!instrument.audio_needed()) return 0;
    if (finishing_) return -1;
    if (active_) return 0;
    if (instrument.pending()) return -1;
    const int prepared = device.prepare();
    if (prepared < 0) return prepared;
    active_ = true;
    return 0;
  }

  template<class Device>
  int complete(Instrument& instrument, Device& device) {
    if (!active_ || instrument.pending() || (!finishing_ && instrument.audio_needed())) return 0;
    if (instrument.lifecycle() == Lifecycle::Faulted) return -1;
    finishing_ = true;
    int result = device.finish();
    if (result < 0) return -1;
    if (result == 0) {
      active_ = false; finishing_ = false;
      return utility(instrument, device);
    }
    return 0;
  }

  template<class Device>
  int drop(Device& device) {
    active_ = false; finishing_ = false;
    return device.drop();
  }
  bool can_activate() const { return !finishing_; }
  bool active() const { return active_; }
 private:
  bool active_ = false, finishing_ = false;
};
}
