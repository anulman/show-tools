#!/usr/bin/env python3
"""Score declared steady PCM fixtures against the native clock's emitted beats."""

import argparse
import csv
import io
import json
from pathlib import Path
import statistics
import subprocess


def main():
    module = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", type=Path, default=module / "build")
    args = parser.parse_args()
    fixtures = args.build / "fixtures"
    if not (fixtures / "manifest.json").exists():
        parser.error("Generate fixtures with scripts/generate-fixtures.py first")
    output = args.build / "verification"
    output.mkdir(parents=True, exist_ok=True)
    results = []
    manifest = json.loads((fixtures / "manifest.json").read_text())
    for case in manifest:
        if not case["file"].startswith("click-"):
            continue
        for seeded in [True, False]:
            command = [str(args.build / "beat-tracker"), str(fixtures / case["file"])]
            if seeded:
                command += ["--bpm", str(case["bpm"])]
            run = subprocess.run(command, text=True, capture_output=True, check=True)
            name = Path(case["file"]).stem + ("-seeded" if seeded else "-auto")
            (output / f"{name}.csv").write_text(run.stdout)
            rows = [{key: float(value) for key, value in row.items()}
                    for row in csv.DictReader(io.StringIO(run.stdout))]
            accepted = [row for row in rows if row["kind"] == 3]
            clock = [row for row in rows if row["kind"] == 1 and 10 <= row["frame"] / case["rate"] <= 30]
            first = accepted[0]["available_frame"] / case["rate"] if accepted else None
            initial = next((row["bpm"] for row in rows if row["kind"] == 5 and row["bpm"] > 0), 0)
            grid = case["bpm"] if seeded else min(
                [case["bpm"] / 2, case["bpm"], case["bpm"] * 2],
                key=lambda bpm: abs(bpm - initial))
            period = 60 / grid
            tempo_error = statistics.median(abs(row["bpm"] / grid - 1) for row in clock) if clock else 1
            phase_error = statistics.median(
                abs((row["frame"] / case["rate"] + period / 2) % period - period / 2)
                for row in clock) if clock else float("inf")
            okay = first is not None and first <= 8 and tempo_error < 0.02 and phase_error < 0.05
            results.append(dict(case=name, grid_bpm=grid, first_accept_seconds=first,
                                median_tempo_error_percent=round(tempo_error * 100, 3),
                                median_phase_error_ms=round(phase_error * 1000, 3),
                                accepted=len(accepted), clock_beats=len(clock), passed=okay))
    (output / "fixtures.json").write_text(json.dumps(results, indent=2) + "\n")
    for result in results:
        print(json.dumps(result))
    raise SystemExit(0 if all(result["passed"] for result in results) else 1)


if __name__ == "__main__":
    main()
