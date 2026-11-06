"""Local tabbed CAD desk. Publishes one scene at a time to the existing viewer."""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import signal
from pathlib import Path
import subprocess
import sys
import threading

HERE = Path(__file__).resolve().parent
UI = HERE.parents[1] / "ui" / "cad"
MODELS = ("box-mount", "disco-bar", "mushroom-mount", "micro-enclosure", "all-controls")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=3940)
    parser.add_argument("--disco-step", type=Path, help="Private reference path, kept outside the repository")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be 1..65535")
    step = args.disco_step or (Path(os.environ["SHOW_TOOLS_DISCO_STEP"]) if os.environ.get("SHOW_TOOLS_DISCO_STEP") else None)
    if step is not None:
        step = step.expanduser().resolve()
        if not step.is_file():
            parser.error("private disco STEP file does not exist")
    compiled = HERE / "build" / "desk" / "app.js"
    if not compiled.is_file():
        parser.error("UI bundle missing; start with hardware/cad/cad desk")
    publishing = threading.Lock()
    process_guard = threading.Lock()
    stopping = threading.Event()
    active_process = None

    def stop_process(process):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
    receipt_path = HERE / "build" / "workspace" / "current-view.json"
    selected = "box-mount"
    if receipt_path.exists():
        candidate = json.loads(receipt_path.read_text()).get("workspace")
        if candidate in MODELS:
            selected = candidate
    if selected in ("disco-bar", "all-controls") and step is None:
        selected = "box-mount"
    origin = f"http://127.0.0.1:{args.port}"

    class Handler(BaseHTTPRequestHandler):
        def respond(self, code, body=b"", content_type="text/plain; charset=utf-8"):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path in ("/", "/viewer"):
                page = (UI / "index.html").read_text().replace("__SELECTED__", selected)
                self.respond(200, page.encode(), "text/html; charset=utf-8")
            elif self.path == "/app.js":
                self.respond(200, compiled.read_bytes(), "text/javascript; charset=utf-8")
            else:
                self.respond(404, b"Not found")

        def do_POST(self):
            nonlocal selected, active_process
            # Browser requests must come from this local desk. No cross-origin publication.
            if self.headers.get("Origin") != origin or self.headers.get("Host") != f"127.0.0.1:{args.port}":
                self.respond(403, b"Open the local CAD desk to switch models.")
                return
            model = self.path.removeprefix("/select/")
            if self.path != f"/select/{model}" or model not in MODELS:
                self.respond(404, b"Unknown CAD workstream")
                return
            if self.headers.get("Content-Length", "0") != "0":
                self.respond(400, b"This action does not accept a request body.")
                return
            if model in ("disco-bar", "all-controls") and step is None:
                self.respond(503, b"Disco reference is not configured. Ask the CAD session to connect it.")
                return
            if not publishing.acquire(blocking=False):
                self.respond(409, b"A preview is already building. Try again in a moment.")
                return
            command = [sys.executable, str(HERE / "workspace.py"), model]
            if model in ("disco-bar", "all-controls"):
                command.extend(("--step", str(step)))
            process = None
            try:
                with process_guard:
                    if stopping.is_set():
                        self.respond(503, b"CAD desk is stopping.")
                        return
                    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                    active_process = process
                stdout, stderr = process.communicate(timeout=120)
                if process.returncode == 78:
                    missing = json.loads(stdout)['missing_measurements']
                    self.respond(503, ('Measurements needed: ' + '; '.join(missing)).encode())
                elif process.returncode:
                    print(stdout, stderr, file=sys.stderr, flush=True)
                    self.respond(503, b"Could not build the preview. Ask the CAD session to check it, then try again.")
                else:
                    selected = model
                    receipt = json.loads(receipt_path.read_text())
                    pending = receipt.get('pending_measurements', {})
                    message = ('All controls · Awaiting measurements for ' +
                               ', '.join(name.replace('-', ' ') for name in pending)) if pending else ''
                    self.respond(200, message.encode())
            except OSError as error:
                print(error, file=sys.stderr, flush=True)
                self.respond(503, b"Could not start the preview. Ask the CAD session to check it.")
            except subprocess.TimeoutExpired:
                stop_process(process)
                process.communicate()
                self.respond(504, b"Preview build timed out. Try again or ask the CAD session to check it.")
            finally:
                with process_guard:
                    if active_process is process:
                        active_process = None
                publishing.release()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"CAD desk: {origin}/", flush=True)

    def interrupt(_signal, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupt)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stopping.set()
        with process_guard:
            process = active_process
        if process is not None:
            stop_process(process)
        server.server_close()


if __name__ == "__main__":
    main()
