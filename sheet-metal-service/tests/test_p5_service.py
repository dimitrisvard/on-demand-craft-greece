"""P5-6 service rules: the shared key on every non-health route and the enforced wall clock.

Each test module run starts the service with uvicorn in subprocesses on free local ports (one per configuration)
and serves the STEP fixtures from a local HTTP server, so nothing leaves 127.0.0.1. Keys are random values built
at run time.

Covered:
  - key matrix: /health and /api/v1/health open; every other route (including /flat-pattern, /docs and
    /openapi.json) answers 401 without the key or with a wrong one; REQUIRE_API_KEY=1 without a key answers 503
  - PROCESSING_TIMEOUT: 504 {"detail": "Processing timeout after 0.05 s"} and no child process left
  - client disconnect: the job's child process is stopped, the service keeps serving
  - a job process that dies: 500 {"detail": "Processing crashed (exit -9)"}, the service keeps serving
  - the 5 reference parts: every endpoint answer equals the golden manifest after the comparator's masks
    (workers/cad/parity), X-Part-* headers included; 3 parallel requests give equal answers
"""

from __future__ import annotations

import concurrent.futures
import functools
import http.server
import json
import os
import secrets
import socket
import subprocess
import sys
import threading
import time

import httpx
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
SERVICE_DIR = os.path.dirname(HERE)
FIXTURES = os.path.join(HERE, "fixtures", "unfold")
PARITY_DIR = os.path.join(os.path.dirname(SERVICE_DIR), "workers", "cad", "parity")
GOLDEN = os.path.join(PARITY_DIR, "golden", "manifest.json")
REFERENCES = ("l_bend_45", "l_bend_90", "l_bend_135", "u_channel", "z_fold")
START_TIMEOUT_S = 120
SLOW_INPUT_S = 8


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# ----- fixture file server (with a slow path for the disconnect and crash tests) -----


class _FixtureHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - http.server naming
        if self.path.startswith("/slow/"):
            time.sleep(SLOW_INPUT_S)
            self.path = self.path[len("/slow"):]
        return super().do_GET()

    def log_message(self, *args):  # quiet
        pass


@pytest.fixture(scope="module")
def files() -> str:
    port = _free_port()
    handler = functools.partial(_FixtureHandler, directory=FIXTURES)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{port}"
    server.shutdown()


# ----- the service -----


class Service:
    def __init__(self, env: dict[str, str]):
        self.port = _free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        full = {k: v for k, v in os.environ.items() if k not in ("API_KEY", "REQUIRE_API_KEY", "PROCESSING_TIMEOUT")}
        full.update({"PYTHONHASHSEED": "0", "PYTHONDONTWRITEBYTECODE": "1"})
        full.update(env)
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(self.port), "--log-level", "warning"],
            cwd=SERVICE_DIR,
            env=full,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        deadline = time.time() + START_TIMEOUT_S
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError("service exited: " + self.proc.stderr.read().decode(errors="replace")[-2000:])
            try:
                if httpx.get(self.base + "/health", timeout=2).status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.2)
        self.stop()
        raise RuntimeError("service did not become healthy")

    def stop(self) -> None:
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(10)

    def job_children(self) -> list[int]:
        """Processes forked by the service for jobs (parent = the service, same command line)."""
        own = _cmdline(self.proc.pid)
        out = []
        for name in os.listdir("/proc"):
            if not name.isdigit():
                continue
            try:
                with open(f"/proc/{name}/stat") as f:
                    stat = f.read()
            except OSError:
                continue
            ppid = int(stat[stat.rindex(")") + 2:].split()[1])
            if ppid == self.proc.pid and _cmdline(int(name)) == own:
                out.append(int(name))
        return out

    def wait_children(self, want: int, timeout: float = 10.0) -> list[int]:
        deadline = time.time() + timeout
        while time.time() < deadline:
            kids = self.job_children()
            if len(kids) == want:
                return kids
            time.sleep(0.05)
        return self.job_children()


def _cmdline(pid: int) -> bytes:
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return f.read()
    except OSError:
        return b""


KEY = "t1-" + secrets.token_hex(16)


@pytest.fixture(scope="module")
def keyed():
    s = Service({"API_KEY": KEY, "REQUIRE_API_KEY": "1"})
    yield s
    s.stop()


def _flat(service: Service, files: str, name: str, key: str | None = KEY, timeout: float = 120) -> httpx.Response:
    headers = {"X-API-Key": key} if key else {}
    return httpx.post(service.base + "/flat-pattern", json={"file_url": f"{files}/{name}.step", "file_name": f"{name}.step"}, headers=headers, timeout=timeout)


# ----- key matrix -----


OPEN_PATHS = ("/health", "/api/v1/health")
KEYED_ROUTES = (
    ("POST", "/flat-pattern"),
    ("POST", "/api/v1/unfold"),
    ("POST", "/api/v1/unfold/preview"),
    ("POST", "/api/v1/unfold/info"),
    ("GET", "/docs"),
    ("GET", "/openapi.json"),
    ("GET", "/redoc"),
)


def test_health_routes_are_open(keyed):
    for path in OPEN_PATHS:
        r = httpx.get(keyed.base + path, timeout=10)
        assert r.status_code == 200, path
        assert r.json()["status"] == "healthy"


def test_every_other_route_needs_the_key(keyed):
    for method, path in KEYED_ROUTES:
        for headers in ({}, {"X-API-Key": "wrong-" + secrets.token_hex(4)}, {"X-API-Key": KEY[:-1]}, {"X-API-Key": KEY + "x"}):
            r = httpx.request(method, keyed.base + path, headers=headers, timeout=10)
            assert r.status_code == 401, (method, path, headers.keys())
            assert r.json() == {"error": "Invalid API key"}
    assert keyed.job_children() == []  # unauthenticated requests never fork
    assert httpx.get(keyed.base + "/docs", headers={"X-API-Key": KEY}, timeout=10).status_code == 200
    assert httpx.get(keyed.base + "/openapi.json", headers={"X-API-Key": KEY}, timeout=10).status_code == 200


def test_required_key_without_a_key_refuses_every_keyed_route():
    s = Service({"REQUIRE_API_KEY": "1"})
    try:
        assert httpx.get(s.base + "/health", timeout=10).status_code == 200
        for method, path in KEYED_ROUTES:
            r = httpx.request(method, s.base + path, timeout=10)
            assert r.status_code == 503, (method, path)
            assert r.json() == {"error": "API key not configured"}
    finally:
        s.stop()


# ----- wall clock, disconnect, crash -----


def test_processing_timeout_answers_504_and_leaves_no_child(files):
    s = Service({"API_KEY": KEY, "PROCESSING_TIMEOUT": "0.05"})
    try:
        r = _flat(s, files, "l_bend_90")
        assert r.status_code == 504
        assert r.json() == {"detail": "Processing timeout after 0.05 s"}
        assert s.wait_children(0) == []
        u = httpx.post(s.base + "/api/v1/unfold", files={"file": ("p.step", open(os.path.join(FIXTURES, "l_bend_90.step"), "rb"))}, data={"output_format": "dxf"}, headers={"X-API-Key": KEY}, timeout=60)
        assert u.status_code == 504
        assert httpx.get(s.base + "/health", timeout=10).status_code == 200
    finally:
        s.stop()


def test_client_disconnect_stops_the_job(keyed, files):
    body = json.dumps({"file_url": f"{files}/slow/l_bend_90.step", "file_name": "l_bend_90.step"}).encode()
    request = (
        f"POST /flat-pattern HTTP/1.1\r\nHost: 127.0.0.1\r\nX-API-Key: {KEY}\r\nContent-Type: application/json\r\n"
        f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n"
    ).encode() + body
    sock = socket.create_connection(("127.0.0.1", keyed.port), timeout=10)
    sock.sendall(request)
    assert len(keyed.wait_children(1)) == 1  # the job runs in its own process while it waits for the input
    sock.close()
    assert keyed.wait_children(0) == []
    assert httpx.get(keyed.base + "/health", timeout=10).status_code == 200
    assert _flat(keyed, files, "l_bend_45").status_code == 200


def test_a_job_process_that_dies_answers_500_and_the_service_keeps_running(keyed, files):
    with concurrent.futures.ThreadPoolExecutor(1) as pool:
        future = pool.submit(lambda: httpx.post(
            keyed.base + "/flat-pattern",
            json={"file_url": f"{files}/slow/l_bend_90.step", "file_name": "l_bend_90.step"},
            headers={"X-API-Key": KEY},
            timeout=60,
        ))
        kids = keyed.wait_children(1)
        assert len(kids) == 1
        os.kill(kids[0], 9)
        r = future.result()
    assert r.status_code == 500
    assert r.json() == {"detail": "Processing crashed (exit -9)"}
    assert keyed.wait_children(0) == []
    assert _flat(keyed, files, "l_bend_90").status_code == 200


# ----- answers equal to the golden manifest -----


def _parity():
    if not os.path.isfile(GOLDEN) or not os.path.isfile(os.path.join(PARITY_DIR, "cad_parity.py")):
        pytest.skip("workers/cad/parity is not part of this checkout (the image build runs cad_parity.py check instead)")
    sys.path.insert(0, PARITY_DIR)
    previous, sys.dont_write_bytecode = sys.dont_write_bytecode, True  # no __pycache__ beside the parity tool
    try:
        import cad_parity  # noqa: PLC0415
    finally:
        sys.dont_write_bytecode = previous
        sys.path.remove(PARITY_DIR)
    with open(GOLDEN, encoding="utf-8") as f:
        return cad_parity, json.load(f)["captures"]


def _headers(cad_parity, r: httpx.Response) -> dict[str, str]:
    return {h: r.headers[h] for h in cad_parity.COMPARED_HEADERS if h in r.headers}


@pytest.mark.parametrize("name", REFERENCES)
def test_reference_answers_equal_the_golden(keyed, files, name):
    cad_parity, golden = _parity()
    step = open(os.path.join(FIXTURES, f"{name}.step"), "rb").read()
    answers = {"flat-pattern": _flat(keyed, files, name)}
    for suffix, fmt in (("unfold-dxf", "dxf"), ("unfold-svg", "svg"), ("unfold-pdf", "pdf")):
        answers[suffix] = httpx.post(
            keyed.base + "/api/v1/unfold",
            files={"file": (f"{name}.step", step, "application/octet-stream")},
            data={"material": "steel", "thickness_override": "0", "k_factor_override": "0", "output_format": fmt, "drawing_size": "A3"},
            headers={"X-API-Key": KEY},
            timeout=120,
        )
    answers["info"] = httpx.post(
        keyed.base + "/api/v1/unfold/info",
        files={"file": (f"{name}.step", step, "application/octet-stream")},
        data={"material": "steel", "thickness_override": "0", "k_factor_override": "0"},
        headers={"X-API-Key": KEY},
        timeout=120,
    )
    for suffix, r in answers.items():
        want = golden[f"{name}.{suffix}"]
        assert r.status_code == want["status"], suffix
        assert _headers(cad_parity, r) == want["headers"], suffix
        assert cad_parity.normalised_sha256(r.content, want["kind"]) == want["normalised_sha256"], suffix


def test_three_parallel_requests_give_equal_answers(keyed, files):
    cad_parity, golden = _parity()
    with concurrent.futures.ThreadPoolExecutor(3) as pool:
        answers = list(pool.map(lambda _: _flat(keyed, files, "u_channel"), range(3)))
    assert [a.status_code for a in answers] == [200, 200, 200]
    hashes = {cad_parity.normalised_sha256(a.content, "flat-pattern") for a in answers}
    assert hashes == {golden["u_channel.flat-pattern"]["normalised_sha256"]}
    assert keyed.wait_children(0) == []
