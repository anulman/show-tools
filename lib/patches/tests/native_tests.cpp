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
  ReferenceEffect(Kind kind, float amount, bool capture = true, uint64_t* calls = nullptr): kind_(kind), amount_(amount), capture_(capture), calls_(calls) {}
  const EffectDescriptor& descriptor() const noexcept override {
    static const EffectDescriptor unsupported{"test-unsupported", 1, 0, 0, nullptr, 0};
    static const EffectDescriptor gain{"test-gain", 1, 0, 0, nullptr, 0, true, true};
    static const EffectDescriptor clip{"test-clip", 1, 0, 0, nullptr, 0, true, true};
    if (!capture_) return unsupported;
    return kind_ == Kind::gain ? gain : clip;
  }
  Stereo process(Stereo input) noexcept override {
    if (calls_) ++*calls_;
    if (kind_ == Kind::gain) return {input.left * amount_, input.right * amount_};
    return {std::max(-amount_, std::min(amount_, input.left)), std::max(-amount_, std::min(amount_, input.right))};
  }
  void reset() noexcept override {}
  bool compatible(const Effect& other) const noexcept override {
    const auto* value = dynamic_cast<const ReferenceEffect*>(&other);
    return value && value->kind_ == kind_ && value->amount_ == amount_ && value->capture_ == capture_;
  }
  void copy_state(const Effect&) noexcept override {}
  std::unique_ptr<Effect> snapshot() const noexcept override { return std::unique_ptr<Effect>(new (std::nothrow) ReferenceEffect(kind_, amount_, capture_, calls_)); }
  size_t memory_bytes() const noexcept override { return sizeof(*this); }
 private:
  Kind kind_;
  float amount_;
  bool capture_;
  uint64_t* calls_;
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
  auto take = ProcessedTake::create(*live, length, warm ? 2 : 1); auto playback = Playback::create(*take);
  if (warm) for (unsigned i = 0; i < 77; ++i) live->process(source_at(i + 300));
  auto initial = live->snapshot();
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
      for (unsigned i = 0; i < count; ++i) {
        Stereo expected = oracle->process(source_at(i % length));
        equal({out_l[i],out_r[i]}, expected, "audible loop follows continuous original-source effect history");
        if (i < length) equal({out_l[i],out_r[i]}, take->sample(i), "first cycle uses exact live printed PCM");
        if (loops == 2 && cut == 61 && i >= 2 * length) fixture.push_back({out_l[i],out_r[i]});
      }
      playback->stop(); require(playback->render(tail_l.data(), tail_r.data(), tail), "release render");
      for (unsigned i = 0; i < tail; ++i) {
        Stereo expected = oracle->process({}), actual{tail_l[i],tail_r[i]};
        equal(actual, expected, "all-cut release equals complete repeated-source history then zero oracle");
        max_error = std::max(max_error, double(std::max(std::abs(actual.left - expected.left), std::abs(actual.right - expected.right))));
        if (cut % 20 == 0) fixture.push_back(actual);
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
  for (unsigned i = 0; i < 1024; ++i) equal({tl[i],tr[i]}, i < 100 ? Stereo{.5f,.5f} : Stereo{.625f,.625f}, "one-frame loops evolve once delay history fills");
  require(voice->render(tl.data(), tr.data(), 1024), "tiny release");
  close(tl[99], .125f, "exact-end tiny loop release uses final state");
#ifndef __EMSCRIPTEN__
  std::puts("PASS block partitions, one-frame loops, native zero allocations/frees, reset");
#else
  std::puts("PASS block partitions, one-frame loops, reset; allocation hooks run on native only");
#endif
}
void appended_capture_and_reuse() {
  constexpr unsigned length = 173;
  auto direct = serial(), appended = serial();
  for (unsigned i = 0; i < 83; ++i) { direct->process(source_at(i + 500)); appended->process(source_at(i + 500)); }
  auto take = ProcessedTake::create(*direct, length, 3), copy = ProcessedTake::create(*appended, length, 3);
  auto first = Playback::create(*take, PlaybackMode::evolving), second = Playback::create(*copy, PlaybackMode::evolving);
  auto unrelated = appended->snapshot();
  auto shared = Playback::create(*copy);
  std::array<float, length> sl{}, sr{}, dl{}, dr{}, al{}, ar{};
  for (unsigned i = 0; i < length; ++i) { Stereo source = source_at(i); sl[i] = source.left; sr[i] = source.right; }
  {
    NoHeap guard;
    require(take->begin(*direct) && copy->begin(*appended), "warm begin without heap");
    require(!copy->append_processed(*appended, sl.data(), sr.data(), nullptr, ar.data(), 1), "missing processed channel rejected");
    require(!copy->append_processed(*unrelated, sl.data(), sr.data(), al.data(), ar.data(), 1), "append requires bound live rack");
    require(!copy->append_processed(*appended, sl.data(), sr.data(), al.data(), ar.data(), length + 1), "append capacity rejected before reads");
    require(copy->length() == 0, "append rejects without take mutation");
    for (unsigned offset = 0; offset < length;) {
      unsigned block = std::min(23u, length - offset);
      require(take->capture(*direct, sl.data() + offset, sr.data() + offset, dl.data() + offset, dr.data() + offset, block), "direct capture block");
      require(appended->process(sl.data() + offset, sr.data() + offset, al.data() + offset, ar.data() + offset, block), "host processes live exactly once");
      require(copy->append_processed(*appended, sl.data() + offset, sr.data() + offset, al.data() + offset, ar.data() + offset, block), "append already processed block without heap");
      offset += block;
    }
    require(take->commit() && copy->commit(), "commit appended take without heap");
    require(first->start(true) && second->start(true), "prepared playback after appended commit");
    for (unsigned i = 0; i < length * 3; ++i) equal(first->next(), second->next(), "split append equals single-process capture and evolving playback");
    require(!copy->reset_for_capture(), "playing take cannot be reused");
    require(shared->start(true), "second concurrent playback pins same take");
    shared->reset();
    require(!copy->reset_for_capture(), "resetting one playback preserves another active pin");
    require(shared->start(true), "shared playback can acquire its pin again");
    shared->stop();
    first->stop(); second->stop();
    require(!copy->reset_for_capture(), "releasing take remains pinned");
    for (unsigned i = 0; i < 500; ++i) equal(first->next(), second->next(), "append release equals direct release");
    first->reset(); second->reset();
    require(!copy->reset_for_capture(), "another releasing playback retains its pin after first reset");
    shared->reset();
    require(copy->reset_for_capture(), "idle prepared bank can be reused without heap");
    require(copy->state() == TakeState::prepared && copy->length() == 0 && copy->revision() == 3, "reuse clears length and keeps graph revision");
    equal(copy->sample(0), {}, "old cache unavailable after reuse");
    require(!second->start(true), "reused take cannot play before fresh commit");
    require(copy->begin(*appended), "same prepared bank begins again");
    require(appended->process(sl.data(), sr.data(), al.data(), ar.data(), 2), "new bank source processing");
    require(copy->append_processed(*appended, sl.data(), sr.data(), al.data(), ar.data(), 2) && copy->commit(), "new bank commit");
    require(second->start(false), "prepared playback can use replacement bank");
    equal(second->next(), copy->sample(0), "replacement bank has fresh printed PCM");
    require(!second->start(true, 1), "nonzero start explicitly unavailable");
    equal(second->next(), copy->sample(1), "unsupported seek leaves playhead and processing state intact");
    second->reset();
  }
  uint64_t calls = 0;
  std::unique_ptr<Effect> stages[] = {std::unique_ptr<Effect>(new ReferenceEffect(ReferenceEffect::Kind::gain, 1, true, &calls))};
  auto counted = Rack::create(stages, 1); auto counted_take = ProcessedTake::create(*counted, 2, 4);
  require(counted_take->begin(*counted), "counted begin");
  std::array<float, 2> mono{.2f, .4f}, outl{}, outr{};
  require(counted->process(mono.data(), nullptr, outl.data(), outr.data(), 2) && calls == 2, "host DSP count");
  {
    NoHeap guard;
    require(counted_take->append_processed(*counted, mono.data(), nullptr, outl.data(), outr.data(), 2), "counted append");
    require(calls == 2, "append does not advance live DSP");
    require(counted_take->commit(), "counted commit");
  }
  auto borrowed = Playback::create(*counted_take);
  require(borrowed->start(true) && !counted_take->reset_for_capture(), "borrowed playback pins take");
  borrowed.reset();
  require(counted_take->reset_for_capture(), "playback destructor releases pin");
  auto identity = Rack::create(nullptr, 0);
  auto dry_take = ProcessedTake::create(*identity, 1, 5); auto dry_voice = Playback::create(*dry_take);
  float sample = .7f, l = 0, r = 0;
  {
    NoHeap guard;
    require(dry_take->begin(*identity) && dry_take->capture(*identity, &sample, nullptr, &l, &r, 1) && dry_take->commit(), "identity capture baseline");
    require(dry_voice->start(false), "identity playback baseline");
    equal(dry_voice->next(), {.7f,.7f}, "identity cached first pass");
    equal(dry_voice->next(), {}, "identity playback ends without release");
    require(dry_take->reset_for_capture(), "zero-tail completion releases pin");
  }
  std::puts("PASS append process-once equivalence, prepared reuse pins, unavailable seek, identity baseline");
}
void mono_source_storage() {
  constexpr unsigned length = 173;
  auto mono_live = serial(), stereo_live = serial(), appended_live = serial();
  for (unsigned i = 0; i < 83; ++i) {
    Stereo warm = source_at(i + 500);
    mono_live->process(warm); stereo_live->process(warm); appended_live->process(warm);
  }
  auto mono = ProcessedTake::create(*mono_live, length, 7, 1);
  auto stereo = ProcessedTake::create(*stereo_live, length, 7);
  auto appended = ProcessedTake::create(*appended_live, length, 7, 1);
  require(mono && stereo && appended, "mono and stereo source preparation");
  require(mono->source_channels() == 1 && stereo->source_channels() == 2, "fixed source channel query and stereo default");
  require(stereo->memory_bytes() - mono->memory_bytes() == length * sizeof(float), "mono saves exactly one float per prepared frame");
  require(!ProcessedTake::create(*mono_live, length, 7, 0) && !ProcessedTake::create(*mono_live, length, 7, 3), "invalid source channel counts rejected");
  auto mv = Playback::create(*mono), sv = Playback::create(*stereo), av = Playback::create(*appended);
  std::array<float, length> source{}, ml{}, mr{}, sl{}, sr{}, al{}, ar{}, equal_right{};
  for (unsigned i = 0; i < length; ++i) source[i] = equal_right[i] = ml[i] = source_at(i).left;
  {
    NoHeap guard;
    require(mono->begin(*mono_live) && stereo->begin(*stereo_live) && appended->begin(*appended_live), "mono warm begin without heap");
    require(mono->capture(*mono_live, ml.data(), nullptr, ml.data(), mr.data(), length), "mono original preserved before in-place capture output");
    require(stereo->capture(*stereo_live, source.data(), equal_right.data(), sl.data(), sr.data(), length), "stereo source capture of equal channels");
    require(appended_live->process(source.data(), nullptr, al.data(), ar.data(), length), "mono append host processing");
    require(appended->append_processed(*appended_live, source.data(), equal_right.data(), al.data(), ar.data(), length), "mono append accepts distinct equal source channels");
    require(mono->commit() && stereo->commit() && appended->commit(), "mono commit without heap");
    require(mv->start(true) && sv->start(true) && av->start(true), "mono start without heap");
    for (unsigned i = 0; i < length * 3 + 61; ++i) {
      Stereo actual = mv->next();
      equal(actual, sv->next(), "mono source evolution equals stereo original storage");
      equal(actual, av->next(), "mono append evolution equals direct mono capture");
    }
    mv->stop(); sv->stop(); av->stop();
    for (unsigned i = 0; i < 500; ++i) {
      Stereo actual = mv->next();
      equal(actual, sv->next(), "mono source multi-cycle Stop equals stereo");
      equal(actual, av->next(), "mono append multi-cycle Stop equals direct capture");
    }
    mv->reset(); sv->reset(); av->reset();
    require(mono->reset_for_capture() && stereo->reset_for_capture() && appended->reset_for_capture(), "mono prepared reuse without heap");
    require(mono->source_channels() == 1 && stereo->source_channels() == 2, "reuse preserves source shape");
  }
  uint64_t calls = 0;
  std::unique_ptr<Effect> stages[] = {std::unique_ptr<Effect>(new ReferenceEffect(ReferenceEffect::Kind::gain, 2, true, &calls))};
  auto live = Rack::create(stages, 1); auto take = ProcessedTake::create(*live, 3, 8, 1);
  auto voice = Playback::create(*take);
  std::array<float, 3> l{.2f,.4f,.6f}, r = l, outl{9,9,9}, outr{8,8,8};
  r[2] = -.6f;
  {
    NoHeap guard;
    require(take->begin(*live), "mono rejection begin");
    require(!take->capture(*live, l.data(), r.data(), outl.data(), outr.data(), 3), "mono capture rejects last-frame stereo mismatch");
    require(!take->append_processed(*live, l.data(), r.data(), outl.data(), outr.data(), 3), "mono append rejects stereo mismatch");
    require(calls == 0 && take->length() == 0 && take->state() == TakeState::capturing, "mono rejection leaves rack and take unchanged");
    for (unsigned i = 0; i < 3; ++i) { close(outl[i], 9, "mono rejection preserves entire left output"); close(outr[i], 8, "mono rejection preserves entire right output"); }
    r = l;
    require(take->capture(*live, l.data(), r.data(), outl.data(), outr.data(), 1), "mono capture accepts separate equal channel");
    require(take->capture(*live, l.data() + 1, l.data() + 1, outl.data() + 1, outr.data() + 1, 1), "mono capture accepts same input pointer");
    require(take->append_processed(*live, l.data() + 2, l.data() + 2, outl.data() + 2, outr.data() + 2, 1), "mono append accepts same input pointer and stereo print");
    require(calls == 2 && take->commit() && voice->start(true), "mono accepted captures process only once");
    equal(take->sample(2), {9,8}, "mono original storage preserves full stereo printed output");
    for (unsigned i = 0; i < 3; ++i) equal(voice->next(), take->sample(i), "mono first cycle uses full stereo print");
    equal(voice->next(), {.4f,.4f}, "mono original expands into both effect channels on evolved cycle");
    voice->reset(); require(take->reset_for_capture(), "mono rejection bank resets without heap");
  }
  std::puts("PASS mono 12-byte versus stereo 16-byte source storage, warm evolution, in-place preservation, atomic stereo rejection, zero heap");
}
void finite_slapback_release() {
  for (double delay : {40.0, 40.5}) {
    auto live = slap(1000, {delay, 0, .5});
    auto take = ProcessedTake::create(*live, 1, 9, 1); auto voice = Playback::create(*take);
    unsigned bound = unsigned(std::ceil(delay));
    require(live->maximum_tail_frames() == bound, "zero-feedback tail is ceil delay");
    float input = 1, left = 0, right = 0;
    {
      NoHeap guard;
      require(take->begin(*live) && take->capture(*live, &input, nullptr, &left, &right, 1) && take->commit() && voice->start(false), "finite release capture");
      equal(voice->next(), {1,1}, "finite release source");
      voice->stop();
      for (unsigned i = 0; i < bound; ++i) {
        require(voice->state() == PlaybackState::releasing && !take->reset_for_capture(), "finite release pins until final tail frame");
        Stereo actual = voice->next();
        float expected = delay == 40 ? (i == 39 ? .5f : 0) : (i == 39 || i == 40 ? .25f : 0);
        equal(actual, {expected,expected}, "integer and fractional impulse tail positions");
        if (i == bound - 1) require(actual.left > 0, "last audible impulse tail at ceil delay minus one");
      }
      require(voice->state() == PlaybackState::idle && take->reset_for_capture(), "finite tail ends and unpins exactly after ceil delay");
      equal(voice->next(), {}, "finite tail has no stale output");
    }
  }
  auto live = slap(1000, {40.5, .7, 0});
  auto take = ProcessedTake::create(*live, 1, 10); auto voice = Playback::create(*take);
  require(live->maximum_tail_frames() == 0, "fixed wet zero has no audible tail");
  float input = 1, left = 0, right = 0;
  {
    NoHeap guard;
    require(take->begin(*live) && take->capture(*live, &input, nullptr, &left, &right, 1) && take->commit() && voice->start(true), "wet-zero capture");
    equal(voice->next(), {1,1}, "wet-zero direct source"); voice->stop();
    require(voice->state() == PlaybackState::idle && take->reset_for_capture(), "wet-zero stop immediately releases pin");
    equal(voice->next(), {}, "wet-zero stopped silence");
  }
  std::puts("PASS exact zero-feedback integer/fractional release bounds and immediate wet-zero release");
}
void evolving_history() {
  auto live = slap(1000, {40, .5, .5});
  auto take = ProcessedTake::create(*live, 50, 6); auto playback = Playback::create(*take);
  std::array<float, 50> source{}, left{}, right{}; source[0] = 1;
  require(take->begin(*live) && take->capture(*live, source.data(), nullptr, left.data(), right.data(), 50) && take->commit(), "short evolving take");
  require(playback->start(true), "evolving start");
  auto oracle = slap(1000, {40, .5, .5});
  bool changed = false;
  for (unsigned frame = 0; frame < 150; ++frame) {
    Stereo expected = oracle->process({source[frame % 50],source[frame % 50]});
    Stereo actual = playback->next();
    equal(actual, expected, "continuous original-source iteration oracle");
    Stereo printed = take->sample(frame % 50);
    if (frame >= 50 && frame < 100) changed = changed || std::abs(actual.left - printed.left) > 1e-6f;
    fixture.push_back(actual);
  }
  require(changed, "second cycle differs from printed first cycle");
  playback->stop();
  for (unsigned i = 0; i < 100; ++i) {
    Stereo actual = playback->next();
    equal(actual, oracle->process({}), "evolved history drains without another baked pass");
    fixture.push_back(actual);
  }
  std::puts("PASS evolving iterations differ from printed first pass and preserve continuous stop tail");
}
void capture_period_history() {
  for (bool warm : {false, true}) for (unsigned length : {1u, 73u}) for (unsigned silence : {0u, 39u}) {
    const unsigned period = length + silence;
    auto live = serial();
    auto take = ProcessedTake::create(*live, length, 11);
    auto playback = Playback::create(*take);
    if (warm) for (unsigned i = 0; i < 83; ++i) live->process(source_at(i + 900));
    auto initial = live->snapshot();
    std::vector<float> source_l(length), source_r(length), printed_l(length), printed_r(length);
    for (unsigned i = 0; i < length; ++i) { Stereo source = source_at(i); source_l[i] = source.left; source_r[i] = source.right; }
    require(take->begin(*live), "period capture begins at warm boundary");
    require(take->capture(*live, source_l.data(), source_r.data(), printed_l.data(), printed_r.data(), length), "period capture prefix");
    auto endpoint = live->snapshot();
    {
      NoHeap guard;
      if (length > 1) {
        require(!take->commit(length - 1), "period shorter than capture rejected");
        require(take->state() == TakeState::capturing && take->length() == length && take->period() == 0, "invalid period leaves capture metadata unchanged");
      }
      require(take->commit(period), "commit independent loop period without heap");
      require(take->length() == length && take->period() == period && take->capacity() == length, "capture prefix and virtual period remain distinct");
      equal(take->sample(length), {}, "virtual suffix is not printed microphone audio");
    }
    for (unsigned i = 0; i < 111; ++i) live->process(source_at(i + 1700));
    auto oracle = initial->snapshot();
    std::vector<Stereo> output(period * 3 + 17);
    {
      NoHeap guard;
      require(playback->start(true), "phase-zero period playback starts without heap");
      for (unsigned i = 0; i < output.size(); ++i) {
        unsigned phase = i % period;
        Stereo expected = oracle->process(phase < length ? source_at(phase) : Stereo{});
        output[i] = playback->next();
        equal(output[i], expected, "phase-zero printed prefix and zero suffix follow evolving full-period oracle");
        if (i < length) equal(output[i], take->sample(i), "phase-zero first prefix remains exact printed capture");
      }
      playback->stop();
      for (unsigned i = 0; i < 200; ++i) equal(playback->next(), oracle->process({}), "period multi-wrap Stop retains full original and zero-source history");
      playback->reset();
      require(oracle->copy_state(*endpoint), "restore independent endpoint oracle");
      require(playback->start_at_capture_end(true), "endpoint continuation starts without heap or seek");
      require(!take->reset_for_capture(), "endpoint continuation pins take");
      for (unsigned i = 0; i < output.size(); ++i) {
        unsigned phase = (length + i) % period;
        Stereo expected = oracle->process(phase < length ? source_at(phase) : Stereo{});
        output[i] = playback->next();
        equal(output[i], expected, "endpoint continuation uses durable capture-end state and wraps without reset");
      }
      playback->stop();
      require(!take->reset_for_capture(), "endpoint release keeps take pinned");
      for (unsigned i = 0; i < 200; ++i) equal(playback->next(), oracle->process({}), "endpoint continuation Stop drains continuous oracle");
      playback->reset();
      require(oracle->copy_state(*endpoint) && playback->start_at_capture_end(false), "endpoint nonloop continuation");
      for (unsigned i = 0; i < silence + 200; ++i) equal(playback->next(), oracle->process({}), "nonloop endpoint plays only zero suffix then natural release");
      playback->reset();
      require(oracle->copy_state(*initial) && playback->start(false), "phase-zero nonloop period start");
      for (unsigned i = 0; i < period + 200; ++i) {
        Stereo input = i < length ? source_at(i) : Stereo{};
        equal(playback->next(), oracle->process(input), "nonloop phase-zero emits prefix and zero suffix before natural release");
      }
      playback->reset();
      require(oracle->copy_state(*endpoint) && playback->start_at_capture_end(true), "endpoint immediate Stop start");
      playback->stop();
      for (unsigned i = 0; i < 200; ++i) equal(playback->next(), oracle->process({}), "Stop before endpoint continuation frame preserves exact capture-end history");
      playback->reset();
      require(take->reset_for_capture() && take->period() == 0 && take->length() == 0, "period metadata resets only after playback unpins");
      require(!playback->start_at_capture_end(true) && !playback->start(true), "reused bank cannot start either mode before new commit");
    }
    fixture.insert(fixture.end(), output.begin(), output.end());
  }
  std::puts("PASS distinct capture cutoff and loop period, warm ordered nonlinear oracle, durable endpoint continuation, zero suffix, wraps and Stop");
}
void capture_period_admission() {
  uint64_t calls = 0;
  std::unique_ptr<Effect> stages[] = {std::unique_ptr<Effect>(new ReferenceEffect(ReferenceEffect::Kind::gain, 1, true, &calls))};
  auto live = Rack::create(stages, 1);
  auto take = ProcessedTake::create(*live, 2, 12, 1);
  auto playback = Playback::create(*take);
  std::array<float, 2> source{.2f,.4f}, left{}, right{};
  {
    NoHeap guard;
    require(take->period() == 0 && !playback->start_at_capture_end(true), "prepared endpoint start rejected");
    require(playback->state() == PlaybackState::idle && calls == 0, "uncommitted endpoint rejection does not advance DSP");
    require(take->begin(*live) && !playback->start_at_capture_end(false), "capturing endpoint start rejected");
    require(take->capture(*live, source.data(), nullptr, left.data(), right.data(), 2) && calls == 2, "counted period source processed once");
    require(!take->commit(1) && calls == 2 && take->state() == TakeState::capturing, "short period rejected without DSP or capture mutation");
    require(take->commit(std::numeric_limits<uint32_t>::max()), "virtual period beyond PCM capacity admitted");
    require(take->period() == std::numeric_limits<uint32_t>::max() && take->length() == 2 && calls == 2, "virtual period does not process or store suffix at commit");
    require(!take->commit(2) && take->period() == std::numeric_limits<uint32_t>::max(), "recommit cannot change sealed period");
    require(playback->start_at_capture_end(true) && calls == 2, "endpoint start copies state without DSP");
    equal(playback->next(), {}, "huge virtual period reads implicit zero suffix");
    require(calls == 3, "one virtual suffix frame advances DSP exactly once");
    require(!playback->start(true, 1) && playback->state() == PlaybackState::playing, "unsupported arbitrary seek preserves active endpoint playback");
    equal(playback->next(), {}, "rejected seek preserves endpoint suffix cursor and state");
    require(calls == 4, "rejected seek neither advances nor replays DSP");
    playback->reset();
    require(take->reset_for_capture() && take->period() == 0, "huge virtual period reset has no suffix work");
    require(take->begin(*live) && take->capture(*live, source.data(), nullptr, left.data(), right.data(), 2), "reuse period bank");
    uint64_t before = calls;
    require(take->commit() && take->period() == take->length(), "default commit preserves whole-take period");
    require(playback->start_at_capture_end(true) && calls == before, "full-period endpoint start is state copy only");
    equal(playback->next(), {.2f,.2f}, "full-period endpoint wraps directly to original source");
    require(calls == before + 1, "full-period endpoint wrap advances exactly one frame");
    playback->reset();
  }
  std::puts("PASS period admission is atomic, virtual suffix exceeds PCM capacity, commit/start perform no DSP, pins and reuse preserve metadata");
}

std::unique_ptr<Rack> chorus(double rate = 1000, ChorusParameters parameters = {}) {
  std::unique_ptr<Effect> stages[] = {make_chorus(rate, parameters)};
  auto rack = Rack::create(stages, 1); require(bool(rack), "chorus preparation"); return rack;
}
Stereo chorus_oracle(const std::vector<Stereo>& history, unsigned frame, double rate, ChorusParameters parameters) {
  constexpr double pi = 3.14159265358979323846;
  double phase = std::fmod(double(frame) * parameters.rate_hz / rate, 1.0);
  double delay = rate * (parameters.base_delay_ms + parameters.depth_ms * std::sin(2 * pi * phase)) / 1000;
  double position = double(frame) - delay;
  int64_t first = int64_t(std::floor(position));
  double fraction = position - double(first);
  auto sample = [&](int64_t index) { return index >= 0 && uint64_t(index) < history.size() ? history[size_t(index)] : Stereo{}; };
  Stereo a = sample(first), b = sample(first + 1), input = history[frame];
  return {float(input.left + parameters.wet * (a.left + fraction * (double(b.left) - a.left))),
    float(input.right + parameters.wet * (a.right + fraction * (double(b.right) - a.right)))};
}
Stereo clipped(Stereo input, float bound) {
  return {std::max(-bound, std::min(bound, input.left)), std::max(-bound, std::min(bound, input.right))};
}
void chorus_validation_and_impulses() {
  for (double invalid : {0., 999., 384001., std::numeric_limits<double>::quiet_NaN(), std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::infinity()})
    require(!make_chorus(invalid), "chorus invalid sample rate rejected");
  for (unsigned field = 0; field < 4; ++field) {
    const double below[] = {.049, -.01, 9.99, -.01}, above[] = {5.01, 9.01, 40.01, 1.01};
    for (double invalid : {below[field], above[field], std::numeric_limits<double>::quiet_NaN(), std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::infinity()}) {
      ChorusParameters p;
      if (field == 0) p.rate_hz = invalid;
      if (field == 1) p.depth_ms = invalid;
      if (field == 2) p.base_delay_ms = invalid;
      if (field == 3) p.wet = invalid;
      require(!make_chorus(1000, p), "chorus every parameter validates finite bounds");
    }
  }
  require(bool(make_chorus(1000, {.05, 0, 10, 0})) && bool(make_chorus(384000, {5, 9, 40, 1})), "chorus inclusive parameter and sample-rate bounds");
  auto effect = make_chorus(1000);
  const auto& descriptor = effect->descriptor();
  require(std::strcmp(descriptor.type, "chorus") == 0 && descriptor.version == 1 && descriptor.parameter_count == 4, "chorus descriptor identity and four parameters");
  require(descriptor.latency_frames == 0 && descriptor.maximum_tail_frames == 25 && descriptor.deterministic_source_replay && descriptor.complete_state_snapshot, "chorus direct latency and replay capability");
  auto fixed = chorus(1000, {.8, 0, 20.5, .5}), dry = chorus(1000, {5, 9, 40, 0});
  require(dry->maximum_tail_frames() == 0, "chorus wet zero releases immediately");
  {
    NoHeap guard;
    for (unsigned frame = 0; frame < 100; ++frame) {
      Stereo actual = fixed->process({frame == 0 ? 1.f : 0.f, 0});
      equal(actual, {frame == 0 ? 1.f : frame == 20 || frame == 21 ? .25f : 0.f, 0}, "chorus zero depth is fractional dry-plus-delayed impulse with stereo isolation");
      Stereo input = source_at(frame);
      equal(dry->process(input), input, "chorus wet zero is exact identity despite modulation");
    }
  }
  std::puts("PASS chorus finite validation, full-output fractional impulse, zero wet, descriptor and stereo isolation");
}
void chorus_independent_oracle_and_state() {
  constexpr unsigned frames = 8000, warm = 317;
  ChorusParameters parameters{5, 9, 20, .65};
  auto rack = chorus(1000, parameters), fixed = chorus(1000, {5, 0, 20, .65});
  std::vector<Stereo> history(frames), actual(frames);
  for (unsigned i = 0; i < frames; ++i) history[i] = source_at(i);
  bool modulation_changes_audio = false;
  {
    NoHeap guard;
    for (unsigned i = 0; i < warm; ++i) equal(rack->process(history[i]), chorus_oracle(history, i, 1000, parameters), "chorus warmup independent absolute-phase oracle");
  }
  auto saved = rack->snapshot(), restored = chorus(1000, parameters), wrong = chorus(1000, {5, 8, 20, .65});
  require(saved && restored->copy_state(*saved), "chorus snapshot contains nonzero modulation phase and ring cursor");
  {
    NoHeap guard;
    require(!rack->copy_state(*wrong), "chorus incompatible parameters reject atomically");
    for (unsigned i = warm; i < frames; ++i) {
      actual[i] = rack->process(history[i]);
      equal(actual[i], chorus_oracle(history, i, 1000, parameters), "chorus independent unbounded-history oracle over forty modulation periods");
      equal(restored->process(history[i]), actual[i], "chorus snapshot restores phase cursor and history exactly");
    }
    rack->reset(); restored->reset();
    for (unsigned i = 0; i < frames; ++i) {
      actual[i] = rack->process(history[i]);
      equal(actual[i], chorus_oracle(history, i, 1000, parameters), "chorus reset returns to cold phase and zero ring");
      Stereo fixed_output = fixed->process(history[i]);
      modulation_changes_audio = modulation_changes_audio || std::abs(actual[i].left - fixed_output.left) > .01f;
    }
  }
  require(modulation_changes_audio, "chorus modulation PCM differs from fixed delay");
  fixture.insert(fixture.end(), actual.begin(), actual.end());
  auto mono = chorus(44100, {.8, 5, 20, .35});
  {
    NoHeap guard;
    for (unsigned i = 0; i < 5000; ++i) { float source = source_at(i).left; Stereo output = mono->process({source,source}); require(output.left == output.right, "chorus shared modulation keeps mono exactly centered"); }
  }
  std::puts("PASS chorus independent absolute-phase history oracle, modulation, forty wraps, warm snapshot, reset and mono centering");
}
void chorus_order_and_capture() {
  ChorusParameters parameters{5, 9, 20, .7};
  std::unique_ptr<Effect> before_stages[] = {std::unique_ptr<Effect>(new ReferenceEffect(ReferenceEffect::Kind::clip, .3f)), make_chorus(1000, parameters)};
  std::unique_ptr<Effect> after_stages[] = {make_chorus(1000, parameters), std::unique_ptr<Effect>(new ReferenceEffect(ReferenceEffect::Kind::clip, .3f))};
  auto before = Rack::create(before_stages, 2), after = Rack::create(after_stages, 2);
  std::vector<Stereo> raw(1000), limited(1000);
  for (unsigned i = 0; i < raw.size(); ++i) { raw[i] = source_at(i); limited[i] = clipped(raw[i], .3f); }
  bool differs = false;
  {
    NoHeap guard;
    for (unsigned i = 0; i < raw.size(); ++i) {
      Stereo first = before->process(raw[i]), second = after->process(raw[i]);
      equal(first, chorus_oracle(limited, i, 1000, parameters), "nonlinear clip before chorus matches independent stage-order oracle");
      equal(second, clipped(chorus_oracle(raw, i, 1000, parameters), .3f), "chorus before nonlinear clip matches independent stage-order oracle");
      differs = differs || std::abs(first.left - second.left) > .01f;
    }
  }
  require(differs, "chorus nonlinear stage order changes output");
  constexpr unsigned warm = 317, length = 73, period = 109, count = period * 8 + 19;
  auto live = chorus(1000, parameters); auto take = ProcessedTake::create(*live, length, 19);
  auto playback = Playback::create(*take);
  std::vector<Stereo> phase_zero(warm + count + 60), endpoint(warm + length + count + 60), output(count + 60);
  for (unsigned i = 0; i < warm; ++i) phase_zero[i] = endpoint[i] = source_at(i + 800);
  for (unsigned i = 0; i < count; ++i) {
    unsigned phase = i % period;
    phase_zero[warm + i] = phase < length ? source_at(phase) : Stereo{};
    unsigned end_phase = (length + i) % period;
    endpoint[warm + length + i] = end_phase < length ? source_at(end_phase) : Stereo{};
  }
  for (unsigned i = 0; i < length; ++i) endpoint[warm + i] = source_at(i);
  std::array<float, length> sl{}, sr{}, pl{}, pr{};
  for (unsigned i = 0; i < length; ++i) { sl[i] = source_at(i).left; sr[i] = source_at(i).right; }
  {
    NoHeap guard;
    for (unsigned i = 0; i < warm; ++i) live->process(phase_zero[i]);
    require(take->begin(*live) && take->capture(*live, sl.data(), sr.data(), pl.data(), pr.data(), length) && take->commit(period), "chorus capture prefix and virtual zero suffix");
    for (unsigned i = 0; i < 111; ++i) live->process(source_at(i + 3000));
    require(playback->start(true), "chorus phase-zero captured playback");
    for (unsigned i = 0; i < count; ++i) {
      output[i] = playback->next();
      equal(output[i], chorus_oracle(phase_zero, warm + i, 1000, parameters), "chorus evolving original-source loops and suffix match independent oracle");
      if (i < length) equal(output[i], take->sample(i), "chorus first cycle exact printed provenance");
    }
    playback->stop();
    for (unsigned i = 0; i < 60; ++i) {
      output[count + i] = playback->next();
      equal(output[count + i], chorus_oracle(phase_zero, warm + count + i, 1000, parameters), "chorus multi-loop Stop follows independent zero-input oracle");
    }
    require(playback->state() == PlaybackState::idle, "chorus finite release completes");
    require(playback->start_at_capture_end(true), "chorus durable endpoint continuation");
    for (unsigned i = 0; i < count; ++i) {
      output[i] = playback->next();
      equal(output[i], chorus_oracle(endpoint, warm + length + i, 1000, parameters), "chorus endpoint restores modulation phase after live advances and evolves across wraps");
    }
    playback->stop();
    for (unsigned i = 0; i < 60; ++i) {
      output[count + i] = playback->next();
      equal(output[count + i], chorus_oracle(endpoint, warm + length + count + i, 1000, parameters), "chorus endpoint multi-wrap Stop tail oracle");
    }
    require(playback->state() == PlaybackState::idle && take->reset_for_capture(), "chorus tail ends and permits bank reuse");
  }
  fixture.insert(fixture.end(), output.begin(), output.end());
  std::puts("PASS chorus nonlinear order, original-source evolving capture, zero suffix, endpoint phase provenance and finite Stop");
}
void chorus_release_bounds() {
  for (double rate : {1000., 44100., 384000.}) for (double base : {10., 40.}) {
    ChorusParameters parameters{5, 9, base, 1};
    auto rack = chorus(rate, parameters);
    unsigned prefix = unsigned(std::ceil(.75 * rate / parameters.rate_hz)) + 1;
    unsigned tail = unsigned(std::ceil(rate * (base + 9) / 1000));
    require(rack->maximum_tail_frames() == tail, "chorus release bound is ceil maximum modulated delay");
    std::vector<Stereo> history(prefix + tail + 3), actual(history.size());
    for (unsigned i = 0; i < prefix; ++i) history[i] = source_at(i + 1500);
    {
      NoHeap guard;
      for (unsigned i = 0; i < history.size(); ++i) {
        actual[i] = rack->process(history[i]);
        equal(actual[i], chorus_oracle(history, i, rate, parameters), "chorus release bound at min-delay corner and high sample rate matches independent history");
        if (rate == 1000 && base == 10 && i == prefix - 1) equal(actual[i],
          {history[i].left + history[i - 1].left, history[i].right + history[i - 1].right},
          "chorus minimum-delay phase reads the immediately preceding source frame");
        if (i >= prefix + tail) equal(actual[i], {}, "chorus has exact zero source contribution after maximum tail");
      }
    }
    fixture.insert(fixture.end(), actual.begin(), actual.end());
  }
  std::puts("PASS chorus exact zero after finite tail at minimum delay corner and 1k/44.1k/384k rates");
}

void source_prefix_views() {
  for (double rate : {44100., 48000.}) for (bool effects : {false, true}) {
    std::unique_ptr<Effect> stages[] = {make_slapback(rate, {100, .25, .5}), make_chorus(rate, {.8, 5, 20, .35})};
    auto live = Rack::create(stages, effects ? 2 : 0);
    auto oracle = live->snapshot();
    const double count = rate * 60 / 98;
    const unsigned length = unsigned(std::ceil(333 * count) - std::ceil(329 * count));
    const unsigned cut = unsigned(std::ceil(332.5 * count) - std::ceil(329 * count));
    const unsigned period = unsigned(std::ceil(4 * count));
    auto take = ProcessedTake::create(*live, length, 31);
    auto playback = Playback::create(*take);
    std::vector<float> source(length), left(length), right(length);
    source[cut - 10] = .25f; source[cut] = .75f; source[cut + 10] = .5f;
    require(take->begin(*live) && take->capture(*live, source.data(), source.data(), left.data(), right.data(), length) && take->commit(period), "prepare immutable full source for prefix view");
    std::vector<Stereo> output(period * 3);
    {
      NoHeap guard;
      require(playback->start(true) && playback->set_source_end(cut), "prefix view starts without PCM copy");
      require(!playback->set_source_end(length + 1) && playback->source_end() == cut, "invalid source limit preserves prior prefix");
      for (unsigned i = 0; i < output.size(); ++i) {
        unsigned phase = i % period;
        if (i == cut + 5 || i == period * 2) playback->clear_source_end();
        bool full = (i >= cut + 5 && i < period) || i >= period * 2;
        if (i == period) require(playback->set_source_end(cut), "next traversal can select prefix without resetting state");
        float admitted = phase < length && (full || phase < cut) ? source[phase] : 0;
        auto expected = oracle->process({admitted, admitted});
        output[i] = playback->next();
        equal(output[i], expected, "prefix evolves admitted source and preserves tails across restoration and wraps");
      }
      require(playback->phase() == period, "prefix preserves logical loop period");
      playback->reset(); require(playback->source_end() == -1, "reset clears view");
      require(playback->start(true) && playback->set_source_end(0), "zero-source prefix is distinct from full");
      for (unsigned i = 0; i < period; ++i) equal(playback->next(), {}, "zero-source prefix never injects retained PCM");
      require(playback->start(true) && playback->source_end() == -1, "fresh start restores full source and printed eligibility");
      for (unsigned i = 0; i < length; ++i) equal(playback->next(), take->sample(i), "fresh full start retains original printed PCM");
      playback->reset();
    }
    if (rate == 48000) require(cut == 102857 && std::floor(period * .875) == cut + 1, "absolute-grid source cut differs from rounded period ratio");
    fixture.insert(fixture.end(), output.begin(), output.end());
  }
  std::puts("PASS dry and serial Slapback/Chorus prefix views at 44.1/48k preserve source, tails, phase and heap discipline");
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
void source_slice_views() {
  for (double rate : {44100., 48000.}) {
    const uint32_t begin = uint32_t(rate / 10), period = uint32_t(rate / 5), end = begin + period;
    auto live = slap(rate, {40, .4, .5});
    auto initial = live->snapshot(), oracle = live->snapshot();
    auto take = ProcessedTake::create(*live, end + 100, 77, 1);
    auto player = Playback::create(*take);
    std::vector<float> source(end + 100), left(end + 100), right(end + 100);
    for (uint32_t i = 0; i < source.size(); ++i) source[i] = i % 173 == 0 ? .6f : 0;
    require(take->begin(*live), "slice parent capture starts");
    require(take->capture(*live, source.data(), source.data(), left.data(), right.data(), begin), "slice parent prefix captures");
    require(initial->copy_state(*live) && oracle->copy_state(*live), "slice snapshots include prior DSP history");
    require(take->capture(*live, source.data() + begin, source.data() + begin, left.data() + begin, right.data() + begin, uint32_t(source.size()) - begin)
      && take->commit(), "slice parent is immutable committed PCM");
    auto end_oracle = live->snapshot();
    {
      NoHeap guard;
      require(player->start_window(true, begin, end, period, *initial), "slice starts from captured rack without prefix replay");
      require(!player->set_window(end, begin, period), "inverted view rejected");
      for (uint32_t i = 0; i < period * 3; ++i) {
        const auto expected = oracle->process({source[begin + i % period], source[begin + i % period]});
        equal(player->next(), expected, "slice head, loop seam and evolving history match independent oracle");
      }
      require(player->set_window(begin, end - 50, period), "shorter slice source keeps period and phase");
      for (uint32_t i = 0; i < period * 2; ++i) {
        const float value = i % period < period - 50 ? source[begin + i % period] : 0;
        equal(player->next(), oracle->process({value, value}), "slice cuts source while preserving effects tails");
      }
      player->next(); oracle->process({source[begin], source[begin]});
      require(player->set_window(0, period, period) && player->phase() == 1, "switching source slices retains relative loop phase");
      equal(player->next(), oracle->process({source[1], source[1]}), "switch evolves existing rack rather than resetting it");
      const uint32_t final_begin = uint32_t(source.size()) - period, final_end = uint32_t(source.size());
      require(player->start_window_at_capture_end(true, final_begin, final_end, period) && player->phase() == 0,
        "last-bar commit starts at phase zero independently of parent frame divisibility");
      for (uint32_t i = 0; i < period * 2; ++i) {
        const float value = source[final_begin + i % period];
        equal(player->next(), end_oracle->process({value, value}), "last-bar commit continues the original capture-end DSP history");
      }
    }
  }
}
int main(int argc, char** argv) {
  source_slice_views();
  source_prefix_views(); validation_and_order(); impulses(); arbitrary_stop(false); arbitrary_stop(true); block_partitioning_and_heap(); appended_capture_and_reuse(); mono_source_storage(); finite_slapback_release(); evolving_history(); capture_period_history(); capture_period_admission(); chorus_validation_and_impulses(); chorus_independent_oracle_and_state(); chorus_order_and_capture(); chorus_release_bounds();
  if (argc == 3 && std::strcmp(argv[1], "--fixture") == 0) require(write_pcm(argv[2], fixture), "write deterministic fixture");
  else if (argc == 3 && std::strcmp(argv[1], "--demo") == 0) demo(argv[2]);
  else require(argc == 1, "usage: patch_engine_tests [--fixture PATH | --demo PREFIX]");
  std::printf("PASS patch engine; fixture_frames=%zu\n", fixture.size());
}
