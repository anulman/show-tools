#include "shake_percussion.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <vector>

namespace {
using namespace patches;

void require(bool condition, const char* message) {
  if (condition) return;
  std::fprintf(stderr, "FAIL %s\n", message);
  std::abort();
}

bool equal(Stereo a, Stereo b) {
  return a.left == b.left && a.right == b.right;
}

std::vector<Stereo> render(ShakePercussion& kit, unsigned frames) {
  std::vector<Stereo> result;
  result.reserve(frames);
  for (unsigned i = 0; i < frames; ++i) {
    auto frame = kit.next();
    require(std::isfinite(frame.left) && std::isfinite(frame.right), "finite PCM");
    result.push_back(frame);
  }
  return result;
}

double energy(const std::vector<Stereo>& pcm, size_t begin) {
  double sum = 0;
  for (size_t i = begin; i < pcm.size(); ++i) {
    sum += double(pcm[i].left) * pcm[i].left + double(pcm[i].right) * pcm[i].right;
  }
  return sum;
}

void verify(double rate) {
  auto kit = ShakePercussion::create(rate);
  require(bool(kit), "kit prepares");
  require(!kit->note_on(53, 127) && !kit->note_on(tambourine_note, 128)
    && !kit->note_on(sleigh_bells_note, -1), "invalid events reject");
  require(kit->note_on(sleigh_bells_note, 0) && equal(kit->next(), {}), "velocity zero is silent");
  const unsigned frames = unsigned(rate);
  require(kit->note_on(tambourine_note, 127), "tambourine triggers");
  auto tambourine = render(*kit, frames);
  require(kit->note_on(tambourine_note, 127), "next variation triggers");
  auto variation = render(*kit, frames);
  require(!std::equal(tambourine.begin(), tambourine.end(), variation.begin(), equal), "successive shakes vary");
  kit->reset();
  require(kit->note_on(tambourine_note, 32), "quiet trigger");
  auto quiet = render(*kit, frames);
  require(energy(quiet, 0) > 0 && energy(quiet, 0) < energy(tambourine, 0) * .1, "velocity affects gain");
  require(kit->note_on(sleigh_bells_note, 127), "bells trigger");
  auto bells = render(*kit, frames);
  require(energy(tambourine, 0) > .001 && energy(bells, 0) > .001, "both instruments sound");
  require(!equal(tambourine.front(), {}) && !equal(bells.front(), {}), "each hit begins at the requested frame");
  const unsigned later = unsigned(.3 * rate);
  require(energy(tambourine, later) == 0 && energy(bells, later) > .00001, "bells ring beyond tambourine");
  require(energy(bells, unsigned(.61 * rate)) == 0, "bell tail ends");

  kit->reset();
  require(kit->note_on(tambourine_note, 127) && kit->note_on(sleigh_bells_note, 127), "both instruments can overlap");
  const auto mixed = render(*kit, frames);
  for (unsigned i = 0; i < frames; ++i) {
    require(equal(mixed[i], {tambourine[i].left + bells[i].left, tambourine[i].right + bells[i].right}),
      "overlap preserves both tails and reset restores the first variation");
  }
  for (unsigned i = 0; i < 8; ++i) require(kit->note_on(sleigh_bells_note, 127), "eight hits fit");
  require(!kit->note_on(sleigh_bells_note, 127), "overflow returns rejection");
  for (auto frame : render(*kit, frames)) {
    require(std::abs(frame.left) < .801f && std::abs(frame.right) < .801f, "full polyphony retains headroom");
  }
  require(kit->note_on(tambourine_note, 127), "expired slots can be reused");
  kit->reset();
  require(equal(kit->next(), {}), "reset cancels active voices");
}

void audition(std::vector<Stereo>& pcm, double rate, int note) {
  auto kit = ShakePercussion::create(rate);
  require(bool(kit), "audition kit prepares");
  const unsigned hit_ms[]{80, 340, 600, 860, 990, 1120, 1250, 1510, 1770, 2030, 2290};
  const int velocities[]{55, 82, 115, 68, 96, 77, 118, 63, 94, 80, 127};
  unsigned hit = 0;
  for (unsigned i = 0; i < unsigned(3 * rate); ++i) {
    if (hit < std::size(hit_ms) && i == unsigned(hit_ms[hit] * rate / 1000)) {
      require(kit->note_on(note, velocities[hit]), "audition note admitted");
      ++hit;
    }
    pcm.push_back(kit->next());
  }
  require(hit == std::size(hit_ms), "all audition notes played");
}

void write(const char* path, const std::vector<Stereo>& pcm) {
  auto* file = std::fopen(path, "wb");
  require(file, "fixture output opens");
  require(std::fwrite(pcm.data(), sizeof(Stereo), pcm.size(), file) == pcm.size(), "fixture output writes");
  require(std::fclose(file) == 0, "fixture output closes");
}
}

int main(int argc, char** argv) {
  require(!ShakePercussion::create(15999) && !ShakePercussion::create(192001)
    && !ShakePercussion::create(std::numeric_limits<double>::quiet_NaN()), "bad rates reject");
  for (double rate : {16000., 44100., 48000., 192000.}) verify(rate);
  if (argc == 3 && std::strcmp(argv[1], "--fixture") == 0) {
    std::vector<Stereo> pcm;
    for (double rate : {44100., 48000.}) {
      audition(pcm, rate, tambourine_note);
      audition(pcm, rate, sleigh_bells_note);
    }
    write(argv[2], pcm);
  } else require(argc == 1, "usage: shake_percussion_tests [--fixture PATH]");
}
