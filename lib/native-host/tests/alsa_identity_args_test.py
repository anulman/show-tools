import os
from pathlib import Path
import subprocess
import sys
import tempfile

binary = sys.argv[1]
with tempfile.TemporaryDirectory(prefix="alsa-identity-args-") as directory:
    base = [binary, str(Path(directory) / "host.sock"), "48000", "256", "32", "30",
            "hw:CARD=USB,DEV=0", "hw:CARD=USB,DEV=0", "2", "0", "256", "1024", "s32"]
    owner = ["--owner-pid", str(os.getpid())]
    identity = ["--usb-identity", "/dev/snd/by-id/usb-show-tools-test-missing", "test-serial", "1235", "8211",
                "USB", "0", "Direct Monitor Playback Switch"]
    monitor = ["--idle-monitor"]
    cases = [(owner, 2), (identity[:-1], 2), (identity + identity, 2), (owner + owner, 2),
             (["--unknown", "value"], 2), (identity + owner, 1), (owner + identity, 1),
             (owner + identity + monitor, 1), (owner + identity + monitor + monitor, 2)]
    for tail, expected in cases:
        result = subprocess.run(base + tail, capture_output=True, timeout=5)
        if result.returncode != expected:
            raise RuntimeError(f"Native identity option contract rejected incorrectly: {tail[0]}, code={result.returncode}")
        if Path(directory, "host.sock").exists():
            raise RuntimeError("Rejected identity published a native control socket")
print("Native identity option groups fail closed before readiness")
