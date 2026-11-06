#ifndef SHOW_TOOLS_NATIVE_FRAME_H
#define SHOW_TOOLS_NATIVE_FRAME_H

#include <cstdint>

namespace native_host {
constexpr uint32_t frame_magic = 0x31544853;
constexpr uint16_t frame_version = 1;
constexpr uint32_t max_frame_payload = 8 * 1024 * 1024;
constexpr uint32_t frame_header_size = 16;
struct FrameHeader { uint16_t tag; uint32_t length, sequence; };
// Returns false on malformed, unsupported or oversized headers.
bool decode_header(const uint8_t* bytes, FrameHeader& header);
void encode_header(uint8_t* bytes, const FrameHeader& header);
}
#endif
