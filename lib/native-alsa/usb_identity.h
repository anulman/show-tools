#pragma once

#include "alsa_pcm.h"
#include <optional>
#include <string>

namespace native_alsa::detail {
struct UsbDeviceFacts {
  unsigned card;
  std::string card_id;
  std::string serial;
  std::string vendor;
  std::string product;
  std::string instance;
  bool operator==(const UsbDeviceFacts& other) const {
    return card == other.card && card_id == other.card_id && serial == other.serial &&
      vendor == other.vendor && product == other.product && instance == other.instance;
  }
};
std::optional<UsbDeviceFacts> inspect_usb_device(const UsbIdentity& expected, std::string& error);
}
