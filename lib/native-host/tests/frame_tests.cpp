#include "frame.h"
#include <array>
#include <cstdlib>

using namespace native_host;
void require(bool condition) { if (!condition) std::abort(); }
int main() {
  std::array<uint8_t, frame_header_size> bytes{};
  FrameHeader input{3, 0x123456, 0x12345678}, output{};
  encode_header(bytes.data(), input);
  constexpr std::array<uint8_t, frame_header_size> golden{0x53,0x48,0x54,0x31,1,0,3,0,0x56,0x34,0x12,0,0x78,0x56,0x34,0x12};
  require(bytes == golden && decode_header(bytes.data(), output));
  require(output.tag == input.tag && output.length == input.length && output.sequence == input.sequence);
  bytes[0] = 0; require(!decode_header(bytes.data(), output)); bytes = golden;
  bytes[4] = 2; require(!decode_header(bytes.data(), output)); bytes = golden;
  bytes[6] = 0; require(!decode_header(bytes.data(), output)); bytes = golden;
  bytes[11] = 1; require(!decode_header(bytes.data(), output));
}
