#include "frame.h"

namespace native_host {
namespace {
uint16_t read16(const uint8_t* p) { return uint16_t(p[0]) | uint16_t(p[1]) << 8; }
uint32_t read32(const uint8_t* p) {
  return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24;
}
void write16(uint8_t* p, uint16_t x) { p[0] = uint8_t(x); p[1] = uint8_t(x >> 8); }
void write32(uint8_t* p, uint32_t x) {
  for (unsigned i = 0; i < 4; ++i) p[i] = uint8_t(x >> (i * 8));
}
}
bool decode_header(const uint8_t* bytes, FrameHeader& header) {
  if (read32(bytes) != frame_magic || read16(bytes + 4) != frame_version) return false;
  FrameHeader parsed{read16(bytes + 6), read32(bytes + 8), read32(bytes + 12)};
  if (!parsed.tag || parsed.length > max_frame_payload) return false;
  header = parsed;
  return true;
}
void encode_header(uint8_t* bytes, const FrameHeader& header) {
  write32(bytes, frame_magic); write16(bytes + 4, frame_version); write16(bytes + 6, header.tag);
  write32(bytes + 8, header.length); write32(bytes + 12, header.sequence);
}
}
