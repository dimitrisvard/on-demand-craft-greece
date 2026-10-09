#!/usr/bin/env python3
"""CAD parity comparator of the Cloudflare migration (P5-6, exit gate item 4).

"Byte-identical" means: the raw HTTP response bodies of the unfold service are equal byte for byte after
replacing ONLY the values the service itself makes different on every call:

  DXF  (inside the /flat-pattern "dxf_base64" value, or a raw /api/v1/unfold dxf body):
       $TDCREATE $TDUCREATE $TDUPDATE $TDUUPDATE (group 40), $VERSIONGUID $FINGERPRINTGUID (group 2), the ezdxf
       marker "<version> @ <ISO timestamp>", and the order of the CLASS records of the CLASSES section (it follows
       the Python hash seed of the process)
  PDF  (raw /api/v1/unfold pdf body): /CreationDate, /ModDate and the trailer /ID

Everything else (JSON key order, number text, SVG, outline, bends, the listed headers) must match exactly.

Subcommands (standard library only; Python 3.9 or later):
  self-test                       proves the masks: volatile fields equal, a 0.01 mm change DIFFERS
  diff A B [KIND]                 one pair of bodies; KIND = flat-pattern (default), dxf, svg, pdf, json
  capture --base URL --files URL --out DIR [--key-env NAME] [--refs a,b] [--compat]
                                  calls the service for every reference and writes raw bodies + headers to DIR
  compare DIR_A DIR_B             every capture of A against B (exit 0 only when all are IDENTICAL)
  manifest DIR                    writes DIR/manifest.json: normalised SHA-256, size, status and headers per capture
  check --base URL --files URL --golden DIR [--key-env NAME] [--refs ...] [--compat]
                                  capture into a temporary folder and compare with DIR/manifest.json

The shared key is read from the environment variable named by --key-env (default CAD_PARITY_KEY), never from the
command line. --compat captures /flat-pattern only, without a key (the compat URL carries its own credential as
part of --base). Reference files are the five STEP fixtures of sheet-metal-service/tests/fixtures/unfold, served at
--files (for example `python3 -m http.server -d sheet-metal-service/tests/fixtures/unfold`).

Exit codes: 0 identical (or self-test passed), 1 differs, 2 usage or transport error.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request
import uuid

REFERENCES = ("l_bend_45", "l_bend_90", "l_bend_135", "u_channel", "z_fold")

DXF_DATE_VARS = (b"$TDCREATE", b"$TDUCREATE", b"$TDUPDATE", b"$TDUUPDATE")
DXF_GUID_VARS = (b"$VERSIONGUID", b"$FINGERPRINTGUID")
EZDXF_MARKER = re.compile(rb"^\d+\.\d+(?:\.\d+)*(?:[a-z0-9.+-]*)? @ \d{4}-\d\d-\d\dT[0-9:.]+(?:[+-]\d\d:\d\d|Z)?$")

# Headers compared exactly (lower case); every other header is ignored.
COMPARED_HEADERS = (
    "content-type",
    "content-disposition",
    "x-part-thickness",
    "x-part-flat-width",
    "x-part-flat-height",
    "x-part-num-bends",
    "x-part-warnings",
)

# One capture per (reference, endpoint): (suffix, method path, kind, form output_format or None).
ENDPOINTS = (
    ("flat-pattern", "/flat-pattern", "flat-pattern", None),
    ("unfold-dxf", "/api/v1/unfold", "dxf", "dxf"),
    ("unfold-svg", "/api/v1/unfold", "svg", "svg"),
    ("unfold-pdf", "/api/v1/unfold", "pdf", "pdf"),
    ("info", "/api/v1/unfold/info", "json", None),
)


# ----- normalisation -----


def normalise_dxf(raw: bytes) -> bytes:
    nl = b"\r\n" if b"\r\n" in raw[:4096] else b"\n"
    lines = raw.split(nl)
    out = list(lines)
    for i in range(len(lines)):
        stripped = lines[i].strip()
        if i > 0 and i + 2 < len(lines) and lines[i - 1].strip() == b"9":
            if stripped in DXF_DATE_VARS and lines[i + 1].strip() == b"40":
                out[i + 2] = b"<DATE>"
            elif stripped in DXF_GUID_VARS and lines[i + 1].strip() == b"2":
                out[i + 2] = b"<GUID>"
        if EZDXF_MARKER.match(stripped):
            out[i] = b"<EZDXF_MARKER>"
    return canonical_classes(nl.join(out), nl)


def canonical_classes(raw: bytes, nl: bytes) -> bytes:
    """Sorts the CLASS records of the CLASSES section (their order follows the hash seed, their content does not)."""
    head_marker = b"CLASSES" + nl
    start = raw.find(head_marker)
    if start < 0:
        return raw
    end = raw.find(nl + b"  0" + nl + b"ENDSEC", start)
    if end < 0:
        return raw
    body = raw[start + len(head_marker):end]
    sep = b"  0" + nl + b"CLASS" + nl
    parts = body.split(sep)
    head, records = parts[0], parts[1:]
    if not records:
        return raw
    records = [r if r.endswith(nl) else r + nl for r in records]
    canon = head + b"".join(sep + r for r in sorted(records))
    if canon.endswith(nl):
        canon = canon[: -len(nl)]
    return raw[: start + len(head_marker)] + canon + raw[end:]


def normalise_pdf(raw: bytes) -> bytes:
    raw = re.sub(rb"/CreationDate\s*\(D:[^)]*\)", b"/CreationDate (D:MASKED)", raw)
    raw = re.sub(rb"/ModDate\s*\(D:[^)]*\)", b"/ModDate (D:MASKED)", raw)
    return re.sub(rb"/ID\s*\[\s*<[0-9a-fA-F]*>\s*<[0-9a-fA-F]*>\s*\]", b"/ID [<MASKED><MASKED>]", raw)


def normalise_flat_pattern(raw: bytes) -> bytes:
    def repl(m: "re.Match[bytes]") -> bytes:
        dxf = normalise_dxf(base64.b64decode(m.group(2)))
        return m.group(1) + b'"sha256:' + hashlib.sha256(dxf).hexdigest().encode() + b'"'

    return re.sub(rb'("dxf_base64"\s*:\s*)"([A-Za-z0-9+/=]*)"', repl, raw)


NORMALISERS = {
    "flat-pattern": normalise_flat_pattern,
    "dxf": normalise_dxf,
    "pdf": normalise_pdf,
    "svg": lambda b: b,
    "json": lambda b: b,
}


def normalise(raw: bytes, kind: str) -> bytes:
    return NORMALISERS[kind](raw)


def normalised_sha256(raw: bytes, kind: str) -> str:
    return hashlib.sha256(normalise(raw, kind)).hexdigest()


def first_difference(a: bytes, b: bytes) -> int:
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            return i
    return min(len(a), len(b))


def diff_bodies(a: bytes, b: bytes, kind: str) -> tuple[bool, str]:
    na, nb = normalise(a, kind), normalise(b, kind)
    if na == nb:
        return True, f"IDENTICAL kind={kind} bytes={len(a)}/{len(b)} raw_equal={a == b}"
    off = first_difference(na, nb)
    return False, f"DIFFERS kind={kind} at normalised offset {off}: {na[max(0, off - 40):off + 40]!r} vs {nb[max(0, off - 40):off + 40]!r}"


# ----- self-test -----


def _synthetic_dxf(xy: tuple[float, float, float, float], classes_order: tuple[str, ...], stamp: str, guid: str, julian: float) -> bytes:
    classes = []
    for name in classes_order:
        classes.append(f"  0\nCLASS\n  1\n{name}\n  2\nAcDb{name.title()}\n 90\n0\n")
    text = (
        "999\n1.4.4 @ " + stamp + "\n"
        "  0\nSECTION\n  2\nHEADER\n"
        "  9\n$TDCREATE\n 40\n" + repr(julian) + "\n"
        "  9\n$TDUPDATE\n 40\n" + repr(julian + 0.000125) + "\n"
        "  9\n$VERSIONGUID\n  2\n{" + guid + "}\n"
        "  9\n$FINGERPRINTGUID\n  2\n{" + guid[::-1] + "}\n"
        "  0\nENDSEC\n"
        "  0\nSECTION\n  2\nCLASSES\n" + "".join(classes) + "  0\nENDSEC\n"
        "  0\nSECTION\n  2\nENTITIES\n  0\nLINE\n  8\nOUTLINE\n"
        + "".join(f"{code}\n{value:.4f}\n" for code, value in zip((" 10", " 20", " 11", " 21"), xy))
        + "  0\nENDSEC\n  0\nEOF\n"
    )
    return text.encode()


def _flat_pattern(dxf: bytes, width: float) -> bytes:
    body = {
        "success": True,
        "flat_pattern": {"width": width, "height": 120.0, "area": round(width * 120.0, 4)},
        "bends": [{"angle": 90.0, "radius": 2.0}],
        "dxf_base64": base64.b64encode(dxf).decode(),
        "svg_base64": base64.b64encode(b"<svg/>").decode(),
    }
    return json.dumps(body).encode()


def self_test() -> int:
    failures: list[str] = []

    def expect(label: str, ok: bool) -> None:
        if not ok:
            failures.append(label)

    xy = (0.0, 0.0, 180.0, 120.0)
    a = _synthetic_dxf(xy, ("ACDBPLACEHOLDER", "LAYOUT"), "2026-10-03T19:55:01.123456+00:00", "AAAA-1111", 2461317.33)
    b = _synthetic_dxf(xy, ("LAYOUT", "ACDBPLACEHOLDER"), "2026-10-03T20:01:44.000001+00:00", "BBBB-2222", 2461317.34)
    changed = _synthetic_dxf((0.0, 0.0, 180.01, 120.0), ("ACDBPLACEHOLDER", "LAYOUT"), "2026-10-03T19:55:01.123456+00:00", "AAAA-1111", 2461317.33)
    expect("raw DXF bodies differ before masking", a != b)
    expect("DXF: dates, GUIDs, marker and CLASSES order are masked", diff_bodies(a, b, "dxf")[0])
    for i in range(4):
        moved = tuple(v + 0.01 if j == i else v for j, v in enumerate(xy))
        other = _synthetic_dxf(moved, ("ACDBPLACEHOLDER", "LAYOUT"), "2026-10-03T19:55:01.123456+00:00", "AAAA-1111", 2461317.33)
        expect(f"DXF: a 0.01 mm change of coordinate {i + 1} of 4 DIFFERS", not diff_bodies(a, other, "dxf")[0])

    fa, fb = _flat_pattern(a, 180.0), _flat_pattern(b, 180.0)
    expect("flat-pattern: the embedded DXF is masked", diff_bodies(fa, fb, "flat-pattern")[0])
    expect("flat-pattern: a 0.01 mm change in a JSON number DIFFERS", not diff_bodies(fa, _flat_pattern(a, 180.01), "flat-pattern")[0])
    expect("flat-pattern: a 0.01 mm change in the embedded DXF DIFFERS", not diff_bodies(fa, _flat_pattern(changed, 180.0), "flat-pattern")[0])
    expect("flat-pattern: the SVG is compared raw", not diff_bodies(fa, fa.replace(b"PHN2Zy8+", b"PHN2ZyAvPg=="), "flat-pattern")[0])

    pa = b"%PDF-1.4\n/CreationDate (D:20261003195501+00'00') /ModDate (D:20261003195501+00'00')\n0 0 m 180.00 120.00 l\ntrailer << /ID [<0a1b><2c3d>] >>"
    pb = b"%PDF-1.4\n/CreationDate (D:20261003200144+00'00') /ModDate (D:20261003200144+00'00')\n0 0 m 180.00 120.00 l\ntrailer << /ID [<ffff><eeee>] >>"
    expect("PDF: dates and /ID are masked", diff_bodies(pa, pb, "pdf")[0])
    expect("PDF: a 0.01 mm drawing change DIFFERS", not diff_bodies(pa, pa.replace(b"180.00", b"180.01"), "pdf")[0])
    expect("SVG: compared raw", not diff_bodies(b"<svg>180</svg>", b"<svg>180.01</svg>", "svg")[0])

    if failures:
        for f in failures:
            print(f"self-test FAILED: {f}")
        return 1
    print("self-test ok (masks: DXF dates, GUIDs, ezdxf marker, CLASSES order; PDF dates and /ID; 0.01 mm changes DIFFER)")
    return 0


# ----- capture -----


def _multipart(fields: list[tuple[str, str]], file_name: str, content: bytes) -> tuple[bytes, str]:
    boundary = "cadparity" + uuid.uuid4().hex
    out = bytearray()
    for name, value in fields:
        out += f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
    out += f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file_name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()
    out += content + b"\r\n" + f"--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"


def _request(url: str, data: bytes, headers: dict[str, str], timeout: float) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, {k.lower(): v for k, v in res.headers.items()}, res.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def _get(url: str, timeout: float) -> bytes:
    with urllib.request.urlopen(url, timeout=timeout) as res:
        return res.read()


def capture(base: str, files: str, out_dir: str, key: str | None, refs: tuple[str, ...], compat: bool, timeout: float = 150.0) -> int:
    os.makedirs(out_dir, exist_ok=True)
    base = base.rstrip("/")
    files = files.rstrip("/")
    for ref in refs:
        file_name = f"{ref}.step"
        file_url = f"{files}/{file_name}"
        for suffix, path, kind, output_format in ENDPOINTS:
            if compat and suffix != "flat-pattern":
                continue
            headers: dict[str, str] = {}
            if key and not compat:
                headers["X-API-Key"] = key
            if path == "/flat-pattern":
                data = json.dumps({"file_url": file_url, "file_name": file_name}).encode()
                headers["Content-Type"] = "application/json"
            else:
                fields = [("material", "steel"), ("thickness_override", "0"), ("k_factor_override", "0")]
                if output_format:
                    fields += [("output_format", output_format), ("drawing_size", "A3")]
                data, ctype = _multipart(fields, file_name, _get(file_url, timeout))
                headers["Content-Type"] = ctype
            status, res_headers, body = _request(base + path, data, headers, timeout)
            stem = os.path.join(out_dir, f"{ref}.{suffix}")
            with open(stem + ".body", "wb") as f:
                f.write(body)
            meta = {"status": status, "kind": kind, "headers": {h: res_headers[h] for h in COMPARED_HEADERS if h in res_headers}}
            with open(stem + ".meta.json", "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=2, sort_keys=True)
                f.write("\n")
            print(f"captured {ref}.{suffix} status={status} bytes={len(body)}")
    return 0


# ----- compare and manifest -----


def _captures(directory: str) -> list[str]:
    return sorted(n[: -len(".meta.json")] for n in os.listdir(directory) if n.endswith(".meta.json"))


def _load(directory: str, stem: str) -> tuple[dict, bytes]:
    with open(os.path.join(directory, stem + ".meta.json"), encoding="utf-8") as f:
        meta = json.load(f)
    with open(os.path.join(directory, stem + ".body"), "rb") as f:
        return meta, f.read()


def manifest_entry(meta: dict, body: bytes) -> dict:
    return {
        "status": meta["status"],
        "kind": meta["kind"],
        "headers": meta["headers"],
        "bytes": len(body),
        "normalised_sha256": normalised_sha256(body, meta["kind"]),
    }


def write_manifest(directory: str) -> int:
    entries = {}
    for stem in _captures(directory):
        meta, body = _load(directory, stem)
        entries[stem] = manifest_entry(meta, body)
    with open(os.path.join(directory, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"v": 1, "captures": entries}, f, indent=2, sort_keys=True)
        f.write("\n")
    print(f"manifest: {len(entries)} captures")
    return 0


def _compare_entry(stem: str, want: dict, got: dict) -> tuple[bool, str]:
    problems = []
    if want["status"] != got["status"]:
        problems.append(f"status {want['status']} vs {got['status']}")
    if want["headers"] != got["headers"]:
        problems.append(f"headers {want['headers']} vs {got['headers']}")
    if want["normalised_sha256"] != got["normalised_sha256"]:
        problems.append("normalised body differs")
    if problems:
        return False, f"DIFFERS {stem}: " + "; ".join(problems)
    raw = " raw_equal=True" if want.get("bytes") == got.get("bytes") else ""
    return True, f"IDENTICAL {stem} kind={got['kind']} bytes={got['bytes']}{raw}"


def compare_dirs(a: str, b: str) -> int:
    stems_a, stems_b = _captures(a), _captures(b)
    ok = stems_a == stems_b and len(stems_a) > 0
    if stems_a != stems_b:
        print(f"DIFFERS capture sets: {sorted(set(stems_a) ^ set(stems_b))}")
    for stem in sorted(set(stems_a) & set(stems_b)):
        ma, ba = _load(a, stem)
        mb, bb = _load(b, stem)
        same, line = _compare_entry(stem, manifest_entry(ma, ba), manifest_entry(mb, bb))
        if same:
            line = diff_bodies(ba, bb, ma["kind"])[1].replace("IDENTICAL", f"IDENTICAL {stem}", 1)
        print(line)
        ok = ok and same
    return 0 if ok else 1


def check(base: str, files: str, golden: str, key: str | None, refs: tuple[str, ...], compat: bool) -> int:
    with open(os.path.join(golden, "manifest.json"), encoding="utf-8") as f:
        want = json.load(f)["captures"]
    with tempfile.TemporaryDirectory(prefix="cad-parity-") as tmp:
        capture(base, files, tmp, key, refs, compat)
        ok = True
        for stem in _captures(tmp):
            if stem not in want:
                print(f"DIFFERS {stem}: not in the golden manifest")
                ok = False
                continue
            meta, body = _load(tmp, stem)
            same, line = _compare_entry(stem, want[stem], manifest_entry(meta, body))
            print(line)
            ok = ok and same
        expected = {s for s in want if s.split(".")[0] in refs and (not compat or s.endswith(".flat-pattern"))}
        missing = expected - set(_captures(tmp))
        if missing:
            print(f"DIFFERS missing captures: {sorted(missing)}")
            ok = False
    return 0 if ok else 1


# ----- command line -----


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="CAD parity comparator (see the module docstring)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("self-test")
    d = sub.add_parser("diff")
    d.add_argument("a")
    d.add_argument("b")
    d.add_argument("kind", nargs="?", default="flat-pattern", choices=sorted(NORMALISERS))
    for name in ("capture", "check"):
        p = sub.add_parser(name)
        p.add_argument("--base", required=True)
        p.add_argument("--files", required=True)
        p.add_argument("--key-env", default="CAD_PARITY_KEY")
        p.add_argument("--refs", default=",".join(REFERENCES))
        p.add_argument("--compat", action="store_true")
        if name == "capture":
            p.add_argument("--out", required=True)
        else:
            p.add_argument("--golden", required=True)
    c = sub.add_parser("compare")
    c.add_argument("a")
    c.add_argument("b")
    m = sub.add_parser("manifest")
    m.add_argument("dir")
    args = parser.parse_args(argv)

    try:
        if args.cmd == "self-test":
            return self_test()
        if args.cmd == "diff":
            with open(args.a, "rb") as fa, open(args.b, "rb") as fb:
                same, line = diff_bodies(fa.read(), fb.read(), args.kind)
            print(line)
            return 0 if same else 1
        if args.cmd == "compare":
            return compare_dirs(args.a, args.b)
        if args.cmd == "manifest":
            return write_manifest(args.dir)
        refs = tuple(r for r in args.refs.split(",") if r)
        key = os.environ.get(args.key_env) or None
        if args.cmd == "capture":
            return capture(args.base, args.files, args.out, key, refs, args.compat)
        return check(args.base, args.files, args.golden, key, refs, args.compat)
    except (OSError, urllib.error.URLError, ValueError) as e:
        print(f"error: {type(e).__name__}: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
