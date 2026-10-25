#include "sample_engine.h"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <new>

namespace {
constexpr int kMaxVoices = 128;
constexpr double kMaxFrame = 9007199254740991.0;
struct Slice { bool present = false; double start = 0, end = 0, target = 0; };
struct Window {
  double begin = 0, end = 0, score = 0, start = -1, stop = -1;
  double quiet = 0, level = 0, noise = 0;
};
struct Sample {
  Sample* next = nullptr;
  unsigned refs = 0;
  int channel = 0, channels = 1, variant = -1, hits = 0;
  uint32_t capacity = 0, length = 0;
  double rate = 0, ratio = 1, onset = 0;
  float* pcm = nullptr;
  Slice slices[ST_HITS];
  Window windows[ST_HITS];
};
struct Slot {
  Sample* sample = nullptr;
  bool prepared = false, recording = false, onset_found = false;
  uint32_t frames = 0;
  double start = 0, seconds = 0, peak = 0, envelope = 0;
  int reason = ST_PREPARED;
};
struct Channel {
  Sample* sample = nullptr;
  Sample* variants[ST_VARIANTS]{};
  bool reserved[ST_VARIANTS]{};
  bool configured = false, muted = false;
  double gain = 1;
  Slot current, next;
};
struct Voice {
  Sample* sample = nullptr;
  double frame = 0, gain = 1, serial = 0, source_offset = 0, source_end = 0;
  bool loop = false;
  int slice = -1;
};
void release(Sample* sample) { if (sample) --sample->refs; }
void replace(Sample*& destination, Sample* sample) {
  if (sample) ++sample->refs;
  release(destination);
  destination = sample;
}
bool valid_channel(int channel) { return channel >= 0 && channel < ST_CHANNELS; }
bool valid_variant(int variant) { return variant >= -1 && variant < ST_VARIANTS; }
bool valid_rate(double rate) {
  return std::isfinite(rate) && rate >= ST_MIN_SAMPLE_RATE && rate <= ST_MAX_SAMPLE_RATE;
}
bool valid_frame(double frame) { return std::isfinite(frame) && std::abs(frame) <= kMaxFrame; }
bool valid_block(double frame, uint32_t frames) {
  return valid_frame(frame) && double(frames) <= kMaxFrame - std::abs(frame);
}
}

struct st_engine {
  double rate = 0, max_seconds = 30, volume = 1;
  int max_voices = 32, max_slots = 8;
  double render_frame = 0, capture_frame = 0, triggered = 0, stolen = 0, late = 0, max_late = 0;
  double quiet_frames = 1, decay = 0;
  const char* error = "";
  Sample* samples = nullptr;
  Channel channels[ST_CHANNELS];
  Voice voices[kMaxVoices];
};

namespace {
int fail(st_engine* engine, const char* error) { if (engine) engine->error = error; return -1; }
bool valid_engine_channel(st_engine* engine, int channel) {
  if (!engine || !valid_channel(channel)) { fail(engine, "Invalid channel ID"); return false; }
  return true;
}
const Sample* sample_for(const st_engine* engine, int channel, int variant) {
  if (!engine || !valid_channel(channel) || !valid_variant(variant)) return nullptr;
  return variant < 0 ? engine->channels[channel].sample : engine->channels[channel].variants[variant];
}
void collect(st_engine* engine) {
  Sample** link = &engine->samples;
  while (*link) {
    Sample* sample = *link;
    if (sample->refs) { link = &sample->next; continue; }
    *link = sample->next;
    std::free(sample->pcm);
    delete sample;
  }
}
Sample* allocate_sample(st_engine* engine, int channel, uint32_t frames, int channels, double rate) {
  collect(engine);
  if (frames > std::numeric_limits<size_t>::max() / sizeof(float) / channels) {
    fail(engine, "Sample is too large"); return nullptr;
  }
  Sample* sample = new (std::nothrow) Sample;
  if (!sample) { fail(engine, "Could not allocate sample metadata"); return nullptr; }
  sample->pcm = static_cast<float*>(std::calloc(size_t(frames) * channels, sizeof(float)));
  if (!sample->pcm) { delete sample; fail(engine, "Could not allocate sample PCM"); return nullptr; }
  sample->channel = channel;
  sample->capacity = frames;
  sample->channels = channels;
  sample->rate = rate;
  sample->ratio = rate / engine->rate;
  sample->next = engine->samples;
  engine->samples = sample;
  return sample;
}
void commit_slot(st_engine* engine, int channel, Slot& slot, int reason) {
  Sample* sample = slot.sample;
  slot.recording = false;
  slot.reason = reason;
  if (!sample) return;
  if (sample->onset >= slot.frames) sample->onset = 0;
  for (int hit = 0; hit < sample->hits; ++hit) {
    const Window& detected = sample->windows[hit];
    if (detected.start < 0 || detected.start >= slot.frames) continue;
    double end = detected.stop >= 0 ? std::min(detected.stop, double(slot.frames)) : slot.frames;
    for (int next = hit + 1; next < sample->hits; ++next) {
      const Window& following = sample->windows[next];
      if (following.start >= 0 && following.start < slot.frames) { end = std::min(end, following.start); break; }
      end = std::min(end, following.begin);
    }
    if (hit + 1 < sample->hits) end = std::min(end, detected.start + sample->slices[hit + 1].target - sample->slices[hit].target);
    sample->slices[hit].present = true;
    sample->slices[hit].start = detected.start;
    sample->slices[hit].end = end;
  }
  if (slot.frames) {
    sample->length = slot.frames;
    replace(engine->channels[channel].sample, sample);
    if (sample->variant >= 0) replace(engine->channels[channel].variants[sample->variant], sample);
  }
}
void clear_slot(Slot& slot) { release(slot.sample); slot = Slot{}; }
void activate(st_engine* engine, Slot& slot, double frame) {
  slot.recording = true;
  slot.prepared = false;
  slot.start = std::max(std::ceil(frame), engine->capture_frame);
  slot.reason = ST_ACTIVE;
}
}

extern "C" {
st_engine* st_create(double rate, int voices, int slots, double seconds) {
  if (!valid_rate(rate) || voices < 1 || voices > kMaxVoices || slots < 1 || slots > ST_CHANNELS || !std::isfinite(seconds) || seconds <= 0 || seconds > 30) return nullptr;
  st_engine* engine = new (std::nothrow) st_engine;
  if (!engine) return nullptr;
  engine->rate = rate; engine->max_voices = voices; engine->max_slots = slots; engine->max_seconds = seconds;
  engine->quiet_frames = std::max(1.0, std::ceil(rate * 0.015));
  engine->decay = std::exp(-1 / (rate * 0.003));
  return engine;
}
void st_destroy(st_engine* engine) {
  if (!engine) return;
  Sample* sample = engine->samples;
  while (sample) { Sample* next = sample->next; std::free(sample->pcm); delete sample; sample = next; }
  delete engine;
}
const char* st_error(const st_engine* engine) { return engine ? engine->error : "Could not allocate sampler"; }
int st_load(st_engine* engine, int channel, const float* left, const float* right, uint32_t frames, double rate) {
  if (!valid_engine_channel(engine, channel)) return -1;
  if (!frames || !left) return fail(engine, "PCM channels must not be empty");
  if (!valid_rate(rate)) return fail(engine, "Invalid source sample rate");
  double onset = frames;
  for (uint32_t index = 0; index < frames; ++index) {
    if (!std::isfinite(left[index]) || (right && !std::isfinite(right[index]))) return fail(engine, "PCM must contain finite values");
    if (index < onset && (std::abs(left[index]) > 0.005 || (right && std::abs(right[index]) > 0.005))) onset = index;
  }
  Sample* sample = allocate_sample(engine, channel, frames, right ? 2 : 1, rate);
  if (!sample) return -1;
  std::memcpy(sample->pcm, left, size_t(frames) * sizeof(float));
  if (right) std::memcpy(sample->pcm + frames, right, size_t(frames) * sizeof(float));
  sample->length = frames; sample->onset = onset == frames ? 0 : onset;
  Channel& target = engine->channels[channel];
  replace(target.sample, sample);
  for (auto& variant : target.variants) replace(variant, nullptr);
  return 0;
}
int st_reserve_variant(st_engine* engine, int channel, int variant) {
  if (!valid_engine_channel(engine, channel)) return -1;
  if (!valid_variant(variant)) return fail(engine, "Invalid capture variant");
  if (variant >= 0) engine->channels[channel].reserved[variant] = true;
  return 0;
}
int st_prepare(st_engine* engine, int channel, int next, double seconds, int variant, const double* expected, int hits, double radius) {
  if (!valid_engine_channel(engine, channel)) return -1;
  if (next != 0 && next != 1) return fail(engine, "Invalid next slot option");
  Channel& target = engine->channels[channel];
  if (next && !target.current.sample) return fail(engine, "Recording slot is not prepared");
  if (!next && target.current.recording) return fail(engine, "Sample is already recording");
  if (!std::isfinite(seconds) || seconds <= 0 || seconds > engine->max_seconds) return fail(engine, "Invalid recording limit");
  double capacity = std::floor(seconds * engine->rate);
  if (capacity < 1 || capacity > std::numeric_limits<uint32_t>::max()) return fail(engine, "Recording limit must allow at least one frame");
  if (!valid_variant(variant)) return fail(engine, "Invalid capture variant");
  if (hits < 0 || hits > ST_HITS || (hits && (!expected || !std::isfinite(radius) || radius <= 0))) return fail(engine, "Invalid transient hints");
  for (int hit = 0; hit < hits; ++hit) if (!std::isfinite(expected[hit]) || expected[hit] < 0 || expected[hit] >= capacity || (hit && expected[hit] <= expected[hit - 1])) return fail(engine, "Transient hints must be ordered recording frames");
  if (!next && !target.current.sample) {
    int occupied = 0;
    for (const auto& candidate : engine->channels) if (candidate.current.sample) ++occupied;
    if (occupied >= engine->max_slots) return fail(engine, "Recording slot limit reached");
  }
  Sample* sample = allocate_sample(engine, channel, uint32_t(capacity), 1, engine->rate);
  if (!sample) return -1;
  sample->variant = variant; sample->hits = hits;
  for (int hit = 0; hit < hits; ++hit) {
    Window& window = sample->windows[hit];
    window.begin = std::max(0.0, std::ceil(expected[hit] - radius));
    if (hit) window.begin = std::max(window.begin, std::ceil((expected[hit - 1] + expected[hit]) / 2));
    window.end = std::min(capacity, std::ceil(expected[hit] + radius));
    if (hit + 1 < hits) window.end = std::min(window.end, std::ceil((expected[hit] + expected[hit + 1]) / 2));
    sample->slices[hit].target = std::floor(expected[hit] + 0.5);
  }
  if (variant >= 0) target.reserved[variant] = true;
  Slot& slot = next ? target.next : target.current;
  clear_slot(slot);
  slot.sample = sample; ++sample->refs;
  slot.prepared = true; slot.seconds = seconds;
  if (!next) clear_slot(target.next);
  return 0;
}
int st_start(st_engine* engine, int channel, double frame, int next) {
  if (!valid_engine_channel(engine, channel)) return -1;
  if (!valid_frame(frame)) return fail(engine, "Invalid recording start frame");
  if (next != 0 && next != 1) return fail(engine, "Invalid next slot option");
  Channel& target = engine->channels[channel];
  if (target.current.recording) return fail(engine, next ? "Commit recording before starting the next take" : "Sample is already recording");
  if (next) {
    if (!target.next.sample) return fail(engine, "Next recording slot is not prepared");
    clear_slot(target.current); target.current = target.next; target.next = Slot{};
  } else if (!target.current.sample || !target.current.prepared) return fail(engine, "Recording slot is not prepared");
  activate(engine, target.current, frame);
  return 0;
}
int st_stop(st_engine* engine, int channel, double frame, int reason) {
  if (!valid_engine_channel(engine, channel)) return -1;
  if (!valid_frame(frame)) return fail(engine, "Invalid recording stop frame");
  Slot& slot = engine->channels[channel].current;
  if (!slot.recording) return 0;
  slot.frames = uint32_t(std::min(double(slot.frames), std::max(0.0, std::ceil(frame) - slot.start)));
  commit_slot(engine, channel, slot, reason);
  return slot.frames ? 1 : 0;
}
int st_commit(st_engine* engine, int channel, int reason) {
  if (!valid_engine_channel(engine, channel)) return -1;
  Slot& slot = engine->channels[channel].current;
  if (!slot.sample) return fail(engine, "Recording slot is not prepared");
  commit_slot(engine, channel, slot, reason);
  return 0;
}
void st_cancel_next(st_engine* engine, int channel) { if (engine && valid_channel(channel)) clear_slot(engine->channels[channel].next); }
void st_stop_all_recordings(st_engine* engine, int reason) {
  if (!engine) return;
  for (int channel = 0; channel < ST_CHANNELS; ++channel) {
    Channel& target = engine->channels[channel];
    clear_slot(target.next);
    if (target.current.recording) commit_slot(engine, channel, target.current, reason);
  }
}
uint32_t st_capture(st_engine* engine, const float* input, uint32_t frames, double frame_start) {
  if (!engine) return 0;
  if (!valid_block(frame_start, frames)) { fail(engine, "Invalid capture frame range"); return 0; }
  uint32_t limited = 0;
  for (int channel = 0; channel < ST_CHANNELS; ++channel) {
    Slot& slot = engine->channels[channel].current;
    if (!slot.recording) continue;
    Sample* sample = slot.sample;
    const double begin = std::max(0.0, slot.start - frame_start);
    for (uint32_t index = begin < frames ? uint32_t(begin) : frames; index < frames && slot.frames < sample->capacity; ++index) {
      const float raw = input ? input[index] : 0;
      const float value = std::isfinite(raw) ? raw : 0;
      const double magnitude = std::abs(double(value));
      if (!slot.onset_found && magnitude > 0.005) { sample->onset = slot.frames; slot.onset_found = true; }
      const double attack = magnitude - slot.envelope;
      if (magnitude > 0.01 && magnitude > slot.envelope * 1.8 + 0.005) {
        for (int hit = 0; hit < sample->hits; ++hit) {
          Window& window = sample->windows[hit];
          if (slot.frames >= window.begin && slot.frames < window.end && attack > window.score) {
            window.score = attack; window.start = slot.frames; window.stop = -1;
            window.quiet = 0; window.level = magnitude; window.noise = slot.envelope;
          }
        }
      }
      for (int hit = 0; hit < sample->hits; ++hit) {
        Window& window = sample->windows[hit];
        if (window.start < 0 || window.stop >= 0) continue;
        window.quiet = magnitude < std::max({0.005, window.level * 0.02, window.noise * 1.5}) ? window.quiet + 1 : 0;
        if (window.quiet >= engine->quiet_frames) window.stop = slot.frames - window.quiet + 1;
      }
      slot.envelope = std::max(magnitude, slot.envelope * engine->decay);
      sample->pcm[slot.frames++] = value;
      slot.peak = std::max(slot.peak, magnitude);
    }
    if (slot.frames == sample->capacity) { commit_slot(engine, channel, slot, ST_LIMIT); limited |= uint32_t(1) << channel; }
  }
  engine->capture_frame = std::max(engine->capture_frame, frame_start + frames);
  return limited;
}
void st_render(st_engine* engine, float* left, float* right, uint32_t frames, double frame_start) {
  if (!engine) return;
  if (!valid_block(frame_start, frames)) { fail(engine, "Invalid render frame range"); return; }
  for (int voice_index = 0; voice_index < engine->max_voices; ++voice_index) {
    Voice& voice = engine->voices[voice_index];
    Sample* sample = voice.sample;
    if (!sample) continue;
    const double begin = std::max(0.0, std::ceil(voice.frame - frame_start));
    const float* source_left = sample->pcm;
    const float* source_right = sample->channels == 2 ? sample->pcm + sample->capacity : sample->pcm;
    const Channel& channel = engine->channels[sample->channel];
    const double gain = voice.gain * engine->volume * (channel.muted ? 0 : channel.gain);
    for (uint32_t index = begin < frames ? uint32_t(begin) : frames; index < frames; ++index) {
      const double age = (frame_start + index - voice.frame) * sample->ratio + voice.source_offset;
      double position = voice.loop ? std::fmod(age, sample->length) : age;
      double end = voice.source_end;
      if (position >= end) { replace(voice.sample, nullptr); break; }
      if (voice.slice < 0 && sample->hits) {
        const Slice* selected = nullptr;
        for (int hit = 0; hit < sample->hits; ++hit) {
          const Slice& slice = sample->slices[hit];
          if (slice.present && position >= slice.target && position < slice.target + slice.end - slice.start) { selected = &slice; break; }
        }
        if (!selected) continue;
        position += selected->start - selected->target; end = selected->end;
      }
      const uint32_t base = uint32_t(std::floor(position));
      const double fraction = position - base;
      const uint32_t next = voice.loop && !sample->hits ? (base + 1) % sample->length : base + 1;
      const double l = source_left[base] + fraction * ((next < end ? double(source_left[next]) : 0) - source_left[base]);
      const double r = source_right[base] + fraction * ((next < end ? double(source_right[next]) : 0) - source_right[base]);
      if (right) { if (left) left[index] = float(left[index] + l * gain); right[index] = float(right[index] + r * gain); }
      else if (left) left[index] = float(left[index] + (l + r) * 0.5 * gain);
    }
    if (!voice.loop && (frame_start + frames - voice.frame) * sample->ratio + voice.source_offset >= voice.source_end) replace(voice.sample, nullptr);
  }
  engine->render_frame = std::max(engine->render_frame, frame_start + frames);
}
int st_trigger(st_engine* engine, int channel, double frame, double gain, int flags, int slice, int variant) {
  if (!valid_engine_channel(engine, channel)) return -1;
  const Sample* selected_sample = sample_for(engine, channel, variant);
  if (!selected_sample) return fail(engine, "Unknown sample");
  if (!valid_frame(frame)) return fail(engine, "Invalid sample start frame");
  if (!std::isfinite(gain) || gain < 0) return fail(engine, "Invalid sample gain");
  if ((flags & ~3) || slice < -1) return fail(engine, "Invalid trigger option");
  if (slice >= 0 && !st_has_slice(engine, channel, slice, variant)) return fail(engine, "Recorded hit is missing");
  if (slice >= 0 && (flags & ST_LOOP)) return fail(engine, "A hit slice cannot loop");
  Sample* sample = const_cast<Sample*>(selected_sample);
  if (flags & ST_LOOP) st_stop_voices(engine, channel);
  if (std::ceil(frame) < engine->render_frame) { ++engine->late; engine->max_late = std::max(engine->max_late, engine->render_frame - frame); frame = engine->render_frame; }
  Voice* selected = nullptr;
  for (int index = 0; index < engine->max_voices; ++index) {
    Voice& voice = engine->voices[index];
    if (!voice.sample) { selected = &voice; break; }
    if (!selected || voice.serial < selected->serial) selected = &voice;
  }
  if (selected->sample) ++engine->stolen;
  replace(selected->sample, sample);
  selected->frame = frame; selected->gain = gain; selected->loop = (flags & ST_LOOP) != 0;
  selected->source_offset = slice >= 0 ? sample->slices[slice].start : (flags & ST_TRIM_START) ? sample->onset : 0;
  selected->source_end = slice >= 0 ? sample->slices[slice].end : sample->length;
  selected->slice = slice; selected->serial = ++engine->triggered;
  return 0;
}
void st_stop_voices(st_engine* engine, int channel) {
  if (!engine) return;
  for (int index = 0; index < engine->max_voices; ++index) if (engine->voices[index].sample && engine->voices[index].sample->channel == channel) replace(engine->voices[index].sample, nullptr);
}
void st_stop_all_voices(st_engine* engine) {
  if (!engine) return;
  for (int index = 0; index < engine->max_voices; ++index) replace(engine->voices[index].sample, nullptr);
}
int st_set_channel(st_engine* engine, int channel, double gain, int muted) {
  if (!valid_engine_channel(engine, channel)) return -1;
  if (!std::isfinite(gain) || gain < 0 || gain > 1) return fail(engine, "Channel gain must be between zero and one");
  if (muted != 0 && muted != 1) return fail(engine, "Channel mute must be boolean");
  Channel& target = engine->channels[channel]; target.configured = true; target.gain = gain; target.muted = muted != 0;
  return 0;
}
int st_set_volume(st_engine* engine, double volume) {
  if (!engine) return -1;
  if (!std::isfinite(volume) || volume < 0) return fail(engine, "Invalid volume");
  engine->volume = volume; return 0;
}
int st_has(const st_engine* engine, int channel, int variant) { return sample_for(engine, channel, variant) ? 1 : 0; }
int st_is_looping(const st_engine* engine, int channel) {
  if (!engine || !valid_channel(channel)) return 0;
  for (int index = 0; index < engine->max_voices; ++index) {
    const Voice& voice = engine->voices[index];
    if (voice.sample && voice.sample->channel == channel && voice.loop) return 1;
  }
  return 0;
}
int st_slice_count(const st_engine* engine, int channel, int variant) { const Sample* sample = sample_for(engine, channel, variant); return sample ? sample->hits : 0; }
int st_has_slice(const st_engine* engine, int channel, int slice, int variant) { const Sample* sample = sample_for(engine, channel, variant); return sample && slice >= 0 && slice < sample->hits && sample->slices[slice].present ? 1 : 0; }
void st_sample_info(const st_engine* engine, int channel, int variant, double* out) {
  if (!out) return;
  std::fill(out, out + ST_SAMPLE_FIELDS, 0);
  const Sample* sample = sample_for(engine, channel, variant);
  if (!sample) return;
  out[ST_SAMPLE_PRESENT] = 1; out[ST_SAMPLE_CHANNELS] = sample->channels; out[ST_SAMPLE_LENGTH] = sample->length;
  out[ST_SAMPLE_RATE] = sample->rate; out[ST_SAMPLE_ONSET] = sample->onset; out[ST_SAMPLE_CAPACITY] = sample->capacity;
  out[ST_SAMPLE_LEFT] = double(reinterpret_cast<uintptr_t>(sample->pcm));
  out[ST_SAMPLE_RIGHT] = sample->channels == 2 ? double(reinterpret_cast<uintptr_t>(sample->pcm + sample->capacity)) : 0;
  out[ST_SAMPLE_SLICES] = sample->hits; out[ST_SAMPLE_VARIANT] = sample->variant;
}
void st_sample_slice(const st_engine* engine, int channel, int variant, int slice, double* out) {
  if (!out) return;
  std::fill(out, out + ST_SLICE_FIELDS, 0);
  const Sample* sample = sample_for(engine, channel, variant);
  if (!sample || slice < 0 || slice >= sample->hits) return;
  const Slice& hit = sample->slices[slice]; out[ST_SLICE_PRESENT] = hit.present;
  out[ST_SLICE_START] = hit.start; out[ST_SLICE_END] = hit.end; out[ST_SLICE_TARGET] = hit.target;
}
void st_slot_info(const st_engine* engine, int channel, int next, double* out) {
  if (!out) return;
  std::fill(out, out + ST_SLOT_FIELDS, 0);
  if (!engine || !valid_channel(channel)) return;
  const Slot& slot = next ? engine->channels[channel].next : engine->channels[channel].current;
  if (!slot.sample) return;
  out[ST_SLOT_PRESENT] = 1; out[ST_SLOT_RECORDING] = slot.recording; out[ST_SLOT_PREPARED] = slot.prepared;
  out[ST_SLOT_FRAMES] = slot.frames; out[ST_SLOT_START] = slot.start; out[ST_SLOT_SECONDS] = slot.seconds;
  out[ST_SLOT_PEAK] = slot.peak; out[ST_SLOT_REASON] = slot.reason;
  out[ST_SLOT_BUFFER] = double(reinterpret_cast<uintptr_t>(slot.sample->pcm)); out[ST_SLOT_CAPACITY] = slot.sample->capacity;
  out[ST_SLOT_VARIANT] = slot.sample->variant; out[ST_SLOT_WINDOWS] = slot.sample->hits;
  out[ST_SLOT_ONSET_FOUND] = slot.onset_found; out[ST_SLOT_ENVELOPE] = slot.envelope; out[ST_SLOT_ONSET] = slot.sample->onset;
}
void st_window_info(const st_engine* engine, int channel, int next, int hit, double* out) {
  if (!out) return;
  std::fill(out, out + ST_WINDOW_FIELDS, 0);
  if (!engine || !valid_channel(channel)) return;
  const Sample* sample = (next ? engine->channels[channel].next : engine->channels[channel].current).sample;
  if (!sample || hit < 0 || hit >= sample->hits) return;
  const Window& window = sample->windows[hit]; const Slice& slice = sample->slices[hit];
  out[ST_WINDOW_BEGIN] = window.begin; out[ST_WINDOW_END] = window.end; out[ST_WINDOW_SCORE] = window.score;
  out[ST_WINDOW_START] = window.start; out[ST_WINDOW_STOP] = window.stop; out[ST_WINDOW_QUIET] = window.quiet;
  out[ST_WINDOW_LEVEL] = window.level; out[ST_WINDOW_NOISE] = window.noise; out[ST_WINDOW_TARGET] = slice.target;
  out[ST_WINDOW_SLICE_PRESENT] = slice.present; out[ST_WINDOW_SLICE_START] = slice.start; out[ST_WINDOW_SLICE_END] = slice.end;
}
void st_voice_info(const st_engine* engine, int voice, double* out) {
  if (!out) return;
  std::fill(out, out + ST_VOICE_FIELDS, 0); out[ST_VOICE_CHANNEL] = -1;
  if (!engine || voice < 0 || voice >= engine->max_voices) return;
  const Voice& selected = engine->voices[voice];
  if (selected.sample) out[ST_VOICE_CHANNEL] = selected.sample->channel;
  out[ST_VOICE_LOOP] = selected.loop; out[ST_VOICE_FRAME] = selected.frame; out[ST_VOICE_GAIN] = selected.gain;
  out[ST_VOICE_SERIAL] = selected.serial; out[ST_VOICE_SOURCE_OFFSET] = selected.source_offset;
  out[ST_VOICE_SOURCE_END] = selected.source_end; out[ST_VOICE_SLICE] = selected.slice;
}
void st_channel_info(const st_engine* engine, int channel, double* out) {
  if (!out) return;
  std::fill(out, out + ST_CHANNEL_FIELDS, 0);
  if (!engine || !valid_channel(channel)) return;
  const Channel& target = engine->channels[channel]; out[ST_CHANNEL_CONFIGURED] = target.configured;
  out[ST_CHANNEL_GAIN] = target.gain; out[ST_CHANNEL_MUTED] = target.muted;
}
void st_stats(const st_engine* engine, double* out) {
  if (!out) return;
  std::fill(out, out + ST_STATS_FIELDS, 0);
  if (!engine) return;
  out[ST_STATS_RENDER_FRAME] = engine->render_frame; out[ST_STATS_CAPTURE_FRAME] = engine->capture_frame;
  out[ST_STATS_TRIGGERED] = engine->triggered; out[ST_STATS_STOLEN] = engine->stolen; out[ST_STATS_LATE] = engine->late; out[ST_STATS_MAX_LATE] = engine->max_late;
  for (const Sample* sample = engine->samples; sample; sample = sample->next) out[ST_STATS_MEMORY_BYTES] += double(sample->capacity) * sample->channels * sizeof(float);
  out[ST_STATS_VOLUME] = engine->volume; out[ST_STATS_RATE] = engine->rate; out[ST_STATS_VOICES] = engine->max_voices;
  out[ST_STATS_SLOTS] = engine->max_slots; out[ST_STATS_MAX_SECONDS] = engine->max_seconds;
}
}
