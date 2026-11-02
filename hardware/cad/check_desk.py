"""Exercise the real local CAD desk boundary without publishing a model."""
from __future__ import annotations

import os
from pathlib import Path
import socket
import signal
import shutil
import subprocess
import sys
import time
import tempfile
import threading
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent


def request(origin, route, expected, *, method="GET", headers=None, body=None):
    req = Request(origin+route, method=method, headers=headers or {}, data=body)
    try:
        with urlopen(req, timeout=2) as response:
            status, result = response.status, response.read().decode()
    except HTTPError as error:
        status, result = error.code, error.read().decode()
    if status != expected:
        raise AssertionError(f"{method} {route}: {status} != {expected}: {result}")
    return result


def check_active_shutdown(environment):
    with tempfile.TemporaryDirectory(prefix="cad-desk-shutdown-") as directory:
        invalid_step = Path(directory) / "invalid.step"
        invalid_step.write_text("Invalid reference: must never publish geometry.\n")
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        origin = f"http://127.0.0.1:{port}"
        fixture = Path(directory) / 'repo'
        cad = fixture / 'hardware/cad'
        ui = fixture / 'ui/cad'
        (cad / 'build/desk').mkdir(parents=True)
        ui.mkdir(parents=True)
        shutil.copyfile(HERE / 'desk_server.py', cad / 'desk_server.py')
        shutil.copyfile(HERE.parents[1] / 'ui/cad/index.html', ui / 'index.html')
        shutil.copyfile(HERE / 'build/desk/app.js', cad / 'build/desk/app.js')
        (cad / 'workspace.py').write_text('import time\ntime.sleep(60)\n')
        server = subprocess.Popen([sys.executable, str(cad / "desk_server.py"), "--port", str(port),
                                   "--disco-step", str(invalid_step)], env=environment,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        responses = []
        child_pid = None
        def select_invalid_reference():
            try:
                responses.append(request(origin, "/select/disco-bar", 503, method="POST", headers={"Origin":origin}))
            except Exception as error:
                responses.append(type(error).__name__)
        try:
            deadline = time.monotonic()+5
            while True:
                try:
                    request(origin, "/", 200)
                    break
                except URLError:
                    if server.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError("Shutdown fixture did not start")
                    time.sleep(.05)
            client = threading.Thread(target=select_invalid_reference)
            client.start()
            deadline = time.monotonic()+3
            while child_pid is None and time.monotonic() < deadline:
                listing = subprocess.check_output(["ps", "-axo", "pid=,ppid=,command="], text=True)
                for line in listing.splitlines():
                    fields = line.strip().split(None, 2)
                    if len(fields) == 3 and fields[1] == str(server.pid) and "workspace.py" in fields[2]:
                        child_pid = int(fields[0])
                        break
                if child_pid is None:
                    time.sleep(.02)
            assert child_pid is not None, "Publisher child was not observed"
            server.terminate()
            assert server.wait(timeout=5) == 0
            client.join(timeout=3)
            assert not client.is_alive(), "Publication request did not finish on shutdown"
            assert responses and "AssertionError" not in responses, responses
            try:
                os.kill(child_pid, 0)
            except ProcessLookupError:
                child_pid = None
            else:
                raise AssertionError("Publisher child survived desk shutdown")
        finally:
            if server.poll() is None:
                server.kill()
                server.wait(timeout=3)
            if child_pid is not None:
                try:
                    os.kill(child_pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass


def main():
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    environment = os.environ.copy()
    environment.pop("SHOW_TOOLS_DISCO_STEP", None)
    process = subprocess.Popen([sys.executable, str(HERE / "desk_server.py"), "--port", str(port)],
                               env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.monotonic()+5
        while True:
            try:
                html = request(origin, "/", 200)
                break
            except URLError:
                if process.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError("Temporary desk did not start")
                time.sleep(.05)
        assert 'role="tablist"' in html and 'data-selected="box-mount"' in html
        for label in ('Arcade button', 'Disco ball', 'All controls'):
            assert f'>{label}</button>' in html
        assert request(origin, "/viewer", 200) == html
        assert request(origin, "/app.js", 200)
        request(origin, "/../../etc/passwd", 404)
        request(origin, "/select/disco-bar", 403, method="POST")
        request(origin, "/select/disco-bar", 403, method="POST", headers={"Origin":"https://example.com"})
        request(origin, "/select/unknown", 404, method="POST", headers={"Origin":origin})
        request(origin, "/select/box-mount", 400, method="POST", headers={"Origin":origin}, body=b"x")
        message = request(origin, "/select/disco-bar", 503, method="POST", headers={"Origin":origin})
        assert "not configured" in message
        request(origin, "/select/all-controls", 403, method="POST")
        request(origin, "/select/all-controls", 400, method="POST", headers={"Origin":origin}, body=b"x")
        message = request(origin, "/select/all-controls", 503, method="POST", headers={"Origin":origin})
        assert "not configured" in message
        assert 'data-selected="box-mount"' in request(origin, "/", 200)
    finally:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)
        process.communicate()
    with socket.socket() as probe:
        probe.settimeout(.3)
        assert probe.connect_ex(("127.0.0.1", port)) != 0, "Temporary desk leaked its listener"
    check_active_shutdown(environment)
    print("PASS: real desk routes, origin/body validation, error recovery, and active publisher cleanup; no model published")


if __name__ == "__main__":
    main()
