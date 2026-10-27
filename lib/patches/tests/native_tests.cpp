#include "patch_engine.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <new>
#include <vector>

namespace {
bool watch_heap = false;
uint64_t heap_allocations = 0, heap_frees = 0;
}
#ifndef __EMSCRIPTEN__
void* operator new(std::size_t bytes) {
  if (watch_heap) ++heap_allocations;
  void* result = std::malloc(bytes ? bytes : 1);
  if (!result) std::abort();
  return result;
}
void* operator new[](std::size_t bytes) { return ::operator new(bytes); }
void operator delete(void* pointer) noexcept { if (watch_heap && pointer) ++heap_frees; std::free(pointer); }
void operator delete[](void* pointer) noexcept { ::operator delete(pointer); }
void operator delete(void* pointer, std::size_t) noexcept { ::operator delete(pointer); }
void operator delete[](void* pointer, std::size_t) noexcept { ::operator delete(pointer); }
#endif
namespace {
using namespace patches;
std::vector<Stereo> fixture;
void require(bool condition, const char* message) {
  if (!condition) { std::fprintf(stderr, "FAIL %s\n", message); std::abort(); }
}
void close(float actual, float expected, const char* message) {
  if (!std::isfinite(actual) || std::abs(actual - expected) > 1e-6f) {
    std::fprintf(stderr, "FAIL %s actual=%.9g expected=%.9g\n", message, actual, expected); std::abort();
  }
}
void equal(Stereo actual, Stereo expected, const char* message) { close(actual.left, expected.left, message); close(actual.right, expected.right, message); }
struct NoHeap {
  NoHeap() { watch_heap = true; heap_allocations = heap_frees = 0; }
  ~NoHeap() { watch_heap = false; require(!heap_allocations && !heap_frees, "processing must not allocate or free"); }
};
class ReferenceEffect final : public Effect {
 public:
  enum class Kind { gain, clip };
  ReferenceEffect(Kind kind, float amount, bool capture = true): kind_(kind), amount_(amount), capture_(capture) {}
  const EffectDescriptor& descriptor() const noexcept override {
    static const EffectDescriptor unsupported{"test-unsupported", 1, 0, 0, nullptr, 0};
    static const EffectDescriptor gain{"test-gain", 1, 0, 0, nullptr, 0, true, true};
    static const EffectDescriptor clip{"test-clip", 1, 0, 0, nullptr, 0, true, true};
    if (!capture_) return unsupported;
    return kind_ == Kind::gain ? gain : clip;
  }
  Stereo process(Stereo input) noexcept override {
    if (kind_ == Kind::gain) return {input.left * amount_, input.right * amount_};
    return {std::max(-amount_, std::min(amount_, input.left)), std::max(-amount_, std::min(amount_, input.right))};
  }
  void reset() noexcept override {}
  bool compatible(const Effect& other) const noexcept override {
    const auto* value = dynamic_cast<const ReferenceEffect*>(&other);
    return value && value->kind_ == kind_ && value->amount_ == amount_ && value->capture_ == capture_;
  }
  void copy_state(const Effect&) noexcept override {}
  std::unique_ptr<Effect> snapshot() const noexcept override { return std::unique_ptr<Effect>(new (std::nothrow) ReferenceEffect(kind_, amount_, capture_)); }
  size_t memory_bytes() const noexcept override { return sizeof(*this); }
 private:
  Kind kind_;
  float amount_;
  bool capture_;
};
std::unique_ptr<Rack> slap(double rate = 1000, SlapbackParameters params = {}) {
  std::unique_ptr<Effect> stages[] = {make_slapback(rate, params)};
  auto rack = Rack::create(stages, 1); require(bool(rack), "slapback preparation"); return rack;
}
std::unique_ptr<Rack> serial() {
  std::unique_ptr<Effect> stages[] = {
    std::unique_ptr<Effect>(new ReferenceEffect(ReferenceEffect::Kind::gain, 2)),
    std::unique_ptr<Effect>(new ReferenceEffect(ReferenceEffect::Kind::clip, .6f)),
    make_slapback(1000, {40.5, .6, .4}), make_slapback(1000, {55.25, .3, .2})};
  auto rack = Rack::create(stages, 4); require(bool(rack), "serial preparation"); return rack;
}
Stereo source_at(unsigned frame) {
  int left = int((frame * 37 + 11) % 101) - 50;
  int right = int((frame * 23 + 7) % 97) - 48;
  return {float(left) / 80, float(right) / 83};
}
void validation_and_order() {
  require(!make_slapback(0) && !make_slapback(std::numeric_limits<double>::infinity()), "invalid rates");
  require(!make_slapback(1000, {39, 0, .25}) && !make_slapback(1000, {251, 0, .25}), "delay bounds");
  require(!make_slapback(1000, {100, .71, .25}) && !make_slapback(1000, {100, 0, -1}), "parameter bounds");
  require(!make_slapback(1000, {100, 0, std::numeric_limits<double>::quiet_NaN()}), "nonfinite parameter");
  require(!Rack::create(nullptr, 1) && !Rack::create(nullptr, 65), "invalid stage array/count");
  auto bypass = Rack::create(nullptr, 0); require(bool(bypass), "empty rack is bypass");
  std::unique_ptr<Effect> unsupported[] = {std::unique_ptr<Effect>(new ReferenceEffect(ReferenceEffect::Kind::gain, 1, false))};
  auto unrecordable = Rack::create(unsupported, 1);
  require(!unrecordable->supports_capture() && !ProcessedTake::create(*unrecordable, 10, 0), "uncertified replay/snapshot capability rejected");
  equal(bypass->process({.2f, -.4f}), {.2f, -.4f}, "bypass equality");
  std::unique_ptr<Effect> gc[] = {
    std::unique_ptr<Effect>(new ReferenceEffect(ReferenceEffect::Kind::gain, 2)),
    std::unique_ptr<Effect>(new ReferenceEffect(ReferenceEffect::Kind::clip, .5f))};
  std::unique_ptr<Effect> cg[] = {
    std::unique_ptr<Effect>(new ReferenceEffect(ReferenceEffect::Kind::clip, .5f)),
    std::unique_ptr<Effect>(new ReferenceEffect(ReferenceEffect::Kind::gain, 2))};
  auto first = Rack::create(gc, 2), second = Rack::create(cg, 2);
  equal(first->process({.4f, -.4f}), {.5f, -.5f}, "gain before nonlinear clip");
  equal(second->process({.4f, -.4f}), {.8f, -.8f}, "nonlinear clip before gain");
  require(!first->copy_state(*second), "different stage order cannot restore");
  auto rack = slap(); auto same = rack->snapshot(), different = slap(1000, {101, 0, .25});
  rack->process({1, -1});
  require(!rack->copy_state(*different), "different parameters cannot restore");
  auto reference = rack->snapshot();
  for (unsigned i = 0; i < 105; ++i) equal(rack->process({}), reference->process({}), "failed restore preserves prior state");
  auto take = ProcessedTake::create(*rack, 2, 9); require(bool(take), "take allocation");
  require(!ProcessedTake::create(*rack, 0, 9), "empty capacity rejected");
  auto playback = Playback::create(*take); require(bool(playback) && !playback->start(true), "uncommitted playback unavailable");
  require(take->begin(*rack) && !take->begin(*rack), "capture begins once");
  std::array<float, 3> input{.5f, .2f, .1f}, left{9,9,9}, right{9,9,9};
  auto before = rack->snapshot();
  require(!take->capture(*rack, input.data(), nullptr, left.data(), right.data(), 3), "capacity reject");
  require(take->length() == 0 && left[0] == 9 && right[0] == 9, "capacity rejection leaves capture/output intact");
  require(!take->capture(*same, input.data(), nullptr, left.data(), right.data(), 1), "capture bound to live rack identity");
  require(!take->capture(*rack, input.data(), nullptr, nullptr, right.data(), 1), "invalid output rejected");
  require(!take->commit(), "empty commit rejected");
  require(take->capture(*rack, input.data(), nullptr, left.data(), right.data(), 2), "capture within capacity");
  for (unsigned i = 0; i < 2; ++i) { Stereo expected = before->process({input[i],input[i]}); equal({left[i],right[i]}, expected, "rejected capture did not advance live"); equal(take->sample(i), expected, "cache equals computed live"); }
  require(take->commit() && !take->commit(), "commit immutable");
  require(take->revision() == 9 && take->length() == 2 && take->capacity() == 2, "take provenance");
  require(!take->capture(*rack, input.data(), nullptr, left.data(), right.data(), 0), "committed take immutable");
  require(playback->start(false), "preprepared playback starts after commit");
  std::puts("PASS validation, atomic rejection, identity, generic order");
}
void impulses() {
  for (double rate : {44100.0, 48000.0}) {
    auto rack = slap(rate); unsigned delay = unsigned(rate * .1);
    std::vector<float> input(delay * 3 + 3), left(input.size()), right(input.size()); input[0] = 1;
    { NoHeap guard; require(rack->process(input.data(), nullptr, left.data(), right.data(), unsigned(input.size())), "mono block render"); }
    for (unsigned i = 0; i < input.size(); ++i) {
      float expected = i == 0 ? 1 : i == delay ? .25f : 0;
      equal({left[i],right[i]}, {expected,expected}, "mono impulse maps equally to L/R and exact first echo");
      fixture.push_back({left[i],right[i]});
    }
    rack->reset(); std::fill(input.begin(), input.end(), 0); input[0] = 1;
    std::fill(left.begin(), left.end(), 0);
    require(rack->process(left.data(), input.data(), left.data(), right.data(), unsigned(input.size())), "stereo in-place render");
    for (unsigned i = 0; i < input.size(); ++i) { close(left[i], 0, "stereo right isolation"); close(right[i], i == 0 ? 1 : i == delay ? .25f : 0, "stereo echo"); }
  }
  auto rack = slap(1000, {100, .5, .25});
  for (unsigned i = 0; i <= 300; ++i) {
    Stereo value = rack->process({i == 0 ? 1.0f : 0, 0});
    float expected = i == 0 ? 1 : i == 100 ? .25f : i == 200 ? .125f : i == 300 ? .0625f : 0;
    equal(value, {expected,0}, "feedback echoes");
  }
  std::puts("PASS mono/stereo 44.1k/48k impulses, feedback");
}
void arbitrary_stop(bool warm) {
  constexpr unsigned length = 121, tail = 500;
  auto live = serial();
  if (warm) for (unsigned i = 0; i < 77; ++i) live->process(source_at(i + 300));
  auto initial = live->snapshot();
  auto take = ProcessedTake::create(*live, length, warm ? 2 : 1); auto playback = Playback::create(*take);
  require(bool(take) && bool(playback) && take->begin(*live), "prepare all-cut capture");
  std::vector<float> l(length), r(length), sl(length), sr(length);
  for (unsigned i = 0; i < length; ++i) { auto value = source_at(i); sl[i] = value.left; sr[i] = value.right; }
  require(take->capture(*live, sl.data(), sr.data(), l.data(), r.data(), length) && take->commit(), "capture live once");
  for (unsigned i = 0; i < length; ++i) equal(take->sample(i), {l[i],r[i]}, "printed output equality");
  std::vector<float> out_l(length * 3 + 1), out_r(out_l.size()), tail_l(tail), tail_r(tail);
  auto oracle = initial->snapshot();
  double max_error = 0;
  for (unsigned cut = 0; cut <= length; ++cut) {
    for (unsigned loops : {0u, 2u}) {
      require(playback->start(true) && oracle->copy_state(*initial), "restart all-cut oracle");
      unsigned count = loops * length + cut;
      require(playback->render(out_l.data(), out_r.data(), count), "cached loop render");
      for (unsigned i = 0; i < count; ++i) equal({out_l[i],out_r[i]}, take->sample(i % length), "audible output copies printed PCM");
      unsigned effective = count && count % length == 0 ? length : count % length;
      for (unsigned i = 0; i < effective; ++i) oracle->process(source_at(i));
      playback->stop(); require(playback->render(tail_l.data(), tail_r.data(), tail), "release render");
      for (unsigned i = 0; i < tail; ++i) {
        Stereo expected = oracle->process({}), actual{tail_l[i],tail_r[i]};
        equal(actual, expected, "all-cut shadow release equals source-prefix then zero oracle");
        max_error = std::max(max_error, double(std::max(std::abs(actual.left - expected.left), std::abs(actual.right - expected.right))));
        if (!loops && cut % 20 == 0) fixture.push_back(actual);
      }
    }
  }
  require(playback->start(false), "nonloop start");
  require(playback->render(out_l.data(), out_r.data(), length + 1), "nonloop automatic release");
  for (unsigned i = 0; i < length; ++i) equal({out_l[i],out_r[i]}, take->sample(i), "nonloop printed prefix");
  require(playback->state() == PlaybackState::releasing, "nonloop releases naturally");
  std::printf("PASS all 122 stop phases, warm=%d, wraps=0/2, max_error=%.9g, memory_bytes=%zu\n", warm, max_error, live->memory_bytes() + take->memory_bytes() + playback->memory_bytes());
}
void block_partitioning_and_heap() {
  constexpr unsigned length = 257;
  auto live = slap(1000, {40.5, .7, .8});
  auto reference = live->snapshot();
  auto take = ProcessedTake::create(*live, length, 5); auto playback = Playback::create(*take);
  std::array<float, length> source{}, left{}, right{}, expected{};
  for (unsigned i = 0; i < length; ++i) source[i] = source_at(i).left;
  require(reference->process(source.data(), nullptr, expected.data(), right.data(), length), "partition reference");
  {
    NoHeap guard;
    require(take->begin(*live), "begin without heap");
    for (unsigned i = 0; i < length;) { unsigned block = std::min(17u, length - i); require(take->capture(*live, source.data() + i, nullptr, left.data() + i, right.data() + i, block), "partitioned capture"); i += block; }
    require(take->commit() && playback->start(true), "commit and start without heap");
    for (unsigned i = 0; i < length; ++i) close(left[i], expected[i], "capture partition invariant");
    for (unsigned block : {1u, 127u, 128u, 257u}) require(playback->render(left.data(), right.data(), block), "playback block without heap");
    playback->stop(); playback->stop(); require(playback->render(left.data(), right.data(), length), "release without heap");
    playback->reset(); live->reset(); reference->reset();
    require(playback->render(left.data(), right.data(), length), "reset render without heap");
    for (unsigned i = 0; i < length; ++i) equal({left[i],right[i]}, {}, "global reset has zero stale PCM");
    require(live->copy_state(*reference), "restore without heap");
  }
  auto tiny_live = slap(1000); auto tiny = ProcessedTake::create(*tiny_live, 1, 1); auto voice = Playback::create(*tiny);
  float input = .5f, l = 0, r = 0;
  require(tiny->begin(*tiny_live) && tiny->capture(*tiny_live, &input, nullptr, &l, &r, 1) && tiny->commit(), "tiny take");
  require(voice->start(true), "tiny loop starts");
  std::vector<float> tl(1024), tr(1024);
  { NoHeap guard; require(voice->render(tl.data(), tr.data(), 1024), "one-frame many-wrap render"); voice->stop(); }
  for (unsigned i = 0; i < 1024; ++i) equal({tl[i],tr[i]}, {.5f,.5f}, "one-frame printed loops unchanged");
  require(voice->render(tl.data(), tr.data(), 1024), "tiny release");
  close(tl[99], .125f, "exact-end tiny loop release uses final state");
#ifndef __EMSCRIPTEN__
  std::puts("PASS block partitions, one-frame loops, native zero allocations/frees, reset");
#else
  std::puts("PASS block partitions, one-frame loops, reset; allocation hooks run on native only");
#endif
}
bool write_pcm(const char* path, const std::vector<Stereo>& pcm) {
  static_assert(sizeof(Stereo) == sizeof(float) * 2);
  FILE* file = std::fopen(path, "wb");
  if (!file) return false;
  bool ok = std::fwrite(pcm.data(), sizeof(Stereo), pcm.size(), file) == pcm.size();
  return std::fclose(file) == 0 && ok;
}
void demo(const char* prefix) {
  constexpr unsigned rate = 48000, count = rate * 3;
  auto rack = slap(rate, {100, .3, .3});
  std::vector<Stereo> dry(count), wet(count);
  constexpr double pi = 3.14159265358979323846;
  for (unsigned i = 0; i < count; ++i) {
    double phase = double(i % (rate / 2)) / rate;
    float value = float(.25 * std::sin(2 * pi * 220 * phase) * std::exp(-phase * 30));
    dry[i] = {value,value}; wet[i] = rack->process(dry[i]);
  }
  std::vector<char> path(std::strlen(prefix) + 32);
  std::snprintf(path.data(), path.size(), "%s-dry.f32", prefix); require(write_pcm(path.data(), dry), "write dry demo");
  std::snprintf(path.data(), path.size(), "%s-wet.f32", prefix); require(write_pcm(path.data(), wet), "write wet demo");
}
}
int main(int argc, char** argv) {
  validation_and_order(); impulses(); arbitrary_stop(false); arbitrary_stop(true); block_partitioning_and_heap();
  if (argc == 3 && std::strcmp(argv[1], "--fixture") == 0) require(write_pcm(argv[2], fixture), "write deterministic fixture");
  else if (argc == 3 && std::strcmp(argv[1], "--demo") == 0) demo(argv[2]);
  else require(argc == 1, "usage: patch_engine_tests [--fixture PATH | --demo PREFIX]");
  std::printf("PASS patch engine; fixture_frames=%zu\n", fixture.size());
}
