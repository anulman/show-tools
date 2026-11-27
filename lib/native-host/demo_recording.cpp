#include "demo_recording.h"
#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <cstring>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <unistd.h>

namespace native_host {
namespace {
constexpr uint64_t max_pcm_bytes = 192u * 1024 * 1024;
constexpr uint64_t archive_metadata_headroom = 64u * 1024;
enum class Capacity { available, full, unknown };

Capacity archive_capacity(const char* path, int fd, uint64_t bytes) {
  struct statvfs info{};
  if ((fd < 0 ? statvfs(path, &info) : fstatvfs(fd, &info)) != 0 || !info.f_frsize)
    return Capacity::unknown;
  const uint64_t block_size = info.f_frsize;
  const uint64_t blocks_needed = bytes / block_size + (bytes % block_size != 0);
  return info.f_bavail < blocks_needed ? Capacity::full : Capacity::available;
}

bool capacity_error() { return errno == ENOSPC || errno == EDQUOT; }

bool sync_directory(const std::string& path) {
  const int fd = open(path.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) return false;
  const bool synced = fsync(fd) == 0;
  const int sync_error = errno;
  const int closed = close(fd);
  if (!synced) errno = sync_error;
  return synced && closed == 0;
}

bool write_all(int fd, const uint8_t* data, size_t bytes) {
  while (bytes) {
    const auto written = ::write(fd, data, bytes);
    if (written < 0 && errno == EINTR) continue;
    if (written <= 0) return false;
    data += written;
    bytes -= size_t(written);
  }
  return true;
}

std::array<uint8_t, 44> wave_header(uint32_t rate, uint32_t bytes) {
  std::array<uint8_t, 44> header{};
  auto put = [&](size_t offset, uint32_t value) {
    for (unsigned index = 0; index < 4; ++index) header[offset + index] = uint8_t(value >> (8 * index));
  };
  std::memcpy(header.data(), "RIFF", 4);
  std::memcpy(header.data() + 8, "WAVEfmt ", 8);
  std::memcpy(header.data() + 36, "data", 4);
  put(4, 36 + bytes); put(16, 16); put(20, 0x00020001); put(24, rate);
  put(28, rate * 4); put(32, 0x00100004); put(40, bytes);
  return header;
}
}

DemoRecording::DemoRecording(std::string draft, std::string output, uint32_t sample_rate, std::string archive_root,
                             uint64_t archive_reserve)
  : draft_(std::move(draft)), output_(std::move(output)), archive_root_(std::move(archive_root)), sample_rate_(sample_rate),
    archive_reserve_(archive_reserve) {
  if (!output_.empty() || !archive_root_.empty()) writer_ = std::thread(&DemoRecording::write, this);
}

DemoRecording::~DemoRecording() {
  finish();
  closing_.store(true, std::memory_order_release);
  if (writer_.joinable()) writer_.join();
}

bool DemoRecording::arm() {
  const auto phase = state();
  if (!available() || phase == State::Armed || phase == State::Recording || phase == State::Finishing) return false;
  submitted_ = 0;
  io_failed_.store(false, std::memory_order_relaxed);
  failed_ = false;
  state_.store(State::Armed, std::memory_order_release);
  return true;
}

void DemoRecording::submit(const float* stereo, uint32_t frames) {
  const auto phase = state();
  if (!frames || (phase != State::Armed && phase != State::Recording)) return;
  if (io_failed_.load(std::memory_order_acquire) || frames > (max_pcm_bytes / 4) - submitted_) {
    failed_ = true;
    finish();
    return;
  }
  state_.store(State::Recording, std::memory_order_release);
  Block block;
  while (frames) {
    block.frames = std::min(frames, block_frames);
    std::copy_n(stereo, block.frames * 2, block.stereo.data());
    if (!queue_.push(block)) {
      failed_ = true;
      finish();
      return;
    }
    stereo += block.frames * 2;
    frames -= block.frames;
    submitted_ += block.frames;
  }
}

void DemoRecording::finish() {
  const auto phase = state();
  if (phase == State::Armed || phase == State::Recording)
    state_.store(State::Finishing, std::memory_order_release);
}

void DemoRecording::write() {
  int file = -1;
  uint32_t bytes = 0;
  bool error = false, created = false, full = false;
  const auto note_io_error = [&] {
    error = true;
    full = archive_reserve_ && capacity_error();
  };
  const auto check_capacity = [&](uint64_t bytes_needed) {
    if (!archive_reserve_) return true;
    const auto capacity = archive_capacity(archive_root_.c_str(), file, archive_reserve_ + bytes_needed);
    if (capacity == Capacity::available) return true;
    error = true;
    full = capacity == Capacity::full;
    return false;
  };
  std::string directory, draft = draft_, output = output_;
  Block block;
  std::array<uint8_t, block_frames * 4> pcm{};
  for (;;) {
    const auto phase = state();
    while (queue_.pop(block)) {
      if (error) continue;
      if (file < 0) {
        if (!check_capacity(max_pcm_bytes + 44 + archive_metadata_headroom)) continue;
        if (!archive_root_.empty()) {
          directory = archive_root_ + "/take-XXXXXX";
          if (!mkdtemp(directory.data())) { directory.clear(); note_io_error(); continue; }
          draft = directory + "/recording.part";
          output = directory + "/recording.wav";
        }
        file = open(draft.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
        created = file >= 0;
        const auto header = wave_header(sample_rate_, 0);
        if (!created || !write_all(file, header.data(), header.size())) { note_io_error(); continue; }
      }
      if (!check_capacity(block.frames * 4 + archive_metadata_headroom)) continue;
      for (uint32_t i = 0; i < block.frames * 2; ++i) {
        const float value = std::isfinite(block.stereo[i]) ? block.stereo[i] : 0;
        const auto sample = uint16_t(int16_t(std::lround(std::clamp(value, -1.f, 1.f) * 32767.f)));
        pcm[i * 2] = uint8_t(sample);
        pcm[i * 2 + 1] = uint8_t(sample >> 8);
      }
      if (!write_all(file, pcm.data(), block.frames * 4)) note_io_error();
      bytes += block.frames * 4;
    }
    if (error) io_failed_.store(true, std::memory_order_release);
    if (phase == State::Finishing) {
      error = error || failed_;
      if (file >= 0) {
        const auto header = wave_header(sample_rate_, bytes);
        if (!error && (lseek(file, 0, SEEK_SET) != 0 || !write_all(file, header.data(), header.size()))) note_io_error();
        if (!error && !directory.empty() && fsync(file) != 0) note_io_error();
        if (close(file) != 0 && !error) note_io_error();
        if (!error && rename(draft.c_str(), output.c_str()) != 0) note_io_error();
        if (!error && !directory.empty() && (!sync_directory(directory) || !sync_directory(archive_root_))) note_io_error();
        file = -1;
      }
      if (error && created) unlink(draft.c_str());
      if (error && !directory.empty()) rmdir(directory.c_str());
      directory.clear();
      state_.store(full ? State::ArchiveFull : error ? State::Failed : bytes ? State::Saved : State::Idle, std::memory_order_release);
      bytes = 0;
      error = created = full = false;
    }
    if (closing_.load(std::memory_order_acquire) && state() != State::Finishing) return;
    std::this_thread::sleep_for(std::chrono::milliseconds(2));
  }
}
}
