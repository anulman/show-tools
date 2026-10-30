#include "tribulations_guitar.h"
#include "tribulations_internal.h"
#include <cmath>
#include <new>

namespace patches {
namespace {
class TribulationsGuitar final : public Effect {
 public:
  TribulationsGuitar(double rate, std::unique_ptr<Rack> rack) noexcept:
    descriptor_{"tribulations_guitar", 1, 0, rack->maximum_tail_frames(), nullptr, 0, true, true},
    rate_(rate), rack_(std::move(rack)) {}
  const EffectDescriptor& descriptor() const noexcept override { return descriptor_; }
  Stereo process(Stereo input) noexcept override { return rack_->process(input); }
  void reset() noexcept override { rack_->reset(); }
  bool compatible(const Effect& other) const noexcept override {
    const auto* candidate = dynamic_cast<const TribulationsGuitar*>(&other);
    return candidate && rate_ == candidate->rate_;
  }
  std::unique_ptr<Effect> snapshot() const noexcept override {
    auto result = make_tribulations_guitar(rate_);
    if (result) static_cast<TribulationsGuitar*>(result.get())->copy_state(*this);
    return result;
  }
  size_t memory_bytes() const noexcept override { return sizeof(*this) + rack_->memory_bytes(); }
 private:
  void copy_state(const Effect& other) noexcept override {
    const auto& source = static_cast<const TribulationsGuitar&>(other);
    rack_->copy_state(*source.rack_);
  }
  EffectDescriptor descriptor_;
  double rate_;
  std::unique_ptr<Rack> rack_;
};
}
std::unique_ptr<Effect> make_tribulations_guitar(double rate) noexcept {
  if (!std::isfinite(rate) || rate < 16000 || rate > 192000) return nullptr;
  std::unique_ptr<Effect> stages[]{tribulations::make_string(rate), tribulations::make_filter(rate), tribulations::make_amp(rate)};
  auto rack = Rack::create(stages, 3);
  if (!rack) return nullptr;
  return std::unique_ptr<Effect>(new (std::nothrow) TribulationsGuitar(rate, std::move(rack)));
}
}
