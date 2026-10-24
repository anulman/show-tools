#!/usr/bin/env python3
"""Generate deterministic PCM fixtures for the native runner and browser replay."""

import argparse
import array
import json
import math
from pathlib import Path
import random
import sys
import wave


def generate(rate, bpm, seconds, signal, silence_at=None, ramp_to=None):
    randomizer = random.Random(73021)
    samples = array.array("h")
    beats = []
    phase = 0.0
    age = rate
    ordinal = 0
    for frame in range(round(seconds * rate)):
        time = frame / rate
        tempo = bpm if ramp_to is None else bpm + (ramp_to - bpm) * min(time / 20, 1)
        if phase >= 1 or frame == 0:
            phase %= 1
            age = 0
            beats.append(time)
            ordinal += 1
        phase += tempo / (60 * rate)
        value = 0.0
        if silence_at is None or time < silence_at:
            if signal == "click" and age < rate * 0.025:
                value = randomizer.uniform(-1, 1) * math.exp(-age / (rate * 0.004)) * 0.85
            elif signal == "phrase" and age < rate * 0.28:
                attack = min(age / (rate * 0.012), 1)
                envelope = attack * math.exp(-age / (rate * 0.09))
                note = [220, 246.94, 261.63, 329.63, 293.66, 261.63, 246.94, 196][ordinal % 8]
                value = envelope * sum(math.sin(2 * math.pi * note * harmonic * time) / harmonic
                                       for harmonic in range(1, 5)) * 0.32
        samples.append(round(max(-1, min(1, value)) * 32767))
        age += 1
    if sys.byteorder != "little":
        samples.byteswap()
    return samples, [time for time in beats if silence_at is None or time < silence_at]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path, default=Path("build/fixtures"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    cases = []
    for rate in [44100, 48000]:
        for bpm in [90, 120, 180]:
            cases.append((f"click-{bpm}-{rate}", rate, bpm, 30, "click", None, None))
        cases.extend([
            (f"silence-120-{rate}", rate, 120, 50, "click", 30, None),
            (f"ramp-up-{rate}", rate, 90, 30, "click", None, 120),
            (f"ramp-down-{rate}", rate, 120, 30, "click", None, 90),
            (f"phrase-120-{rate}", rate, 120, 30, "phrase", None, None),
        ])
    manifest = []
    for name, rate, bpm, seconds, signal, silence_at, ramp_to in cases:
        samples, beats = generate(rate, bpm, seconds, signal, silence_at, ramp_to)
        path = args.output / f"{name}.wav"
        with wave.open(str(path), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(rate)
            output.writeframes(samples.tobytes())
        manifest.append(dict(file=path.name, rate=rate, bpm=bpm, seconds=seconds,
                             signal=signal, silence_at=silence_at, ramp_to=ramp_to,
                             beat_times=beats))
        print(path)
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
