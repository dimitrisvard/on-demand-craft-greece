#!/usr/bin/env python3
"""CAD parity comparator of the Cloudflare migration (P5-6, exit gate item 4).

"Byte-identical" means: the raw HTTP response bodies of the unfold service are equal byte for byte after
replacing ONLY the values the service itself makes different on every call:

  DXF  (inside the /flat-pattern "dxf_base64" value, or a raw /api/v1/unfold dxf body):
       $TDCREATE $TDUCREATE $TDUPDATE $TDUUPDATE (group 40), $VERSIONGUID $FINGERPRINTGUID (group 2), the ezdxf
       marker "<version> @ <ISO timestamp>", and the order of the CLASS records of the CLASSES section (it follows
       the Python hash seed of the process)
  PDF  (raw /api/v1/unfold pdf body): /CreationDate, /ModDate, the trailer /ID and the drawing date of the title
       block (the text "(Date: YYYY-MM-DD)" in a page content stream). Content streams with the filters
       ASCII85Decode and FlateDecode are compared decoded, so their compressed bytes, their /Length and the byte
       offsets of the xref table and startxref (which follow from those lengths) are not compared; a stream with any
       other filter or with /DecodeParms is compared raw

Everything else (JSON key order, number text, SVG, outline, bends, the drawing content, the listed headers) must
match exactly.

Subcommands (standard library only; Python 3.9 or later):
  self-test                       proves the masks: volatile fields equal, a 0.01 mm change DIFFERS
  diff A B [KIND]                 one pair of bodies; KIND = flat-pattern (default), dxf, svg, pdf, json
  capture BASE INPUTS --out DIR [--key-env NAME] [--refs a,b] [--compat]
                                  calls the service for every reference and writes raw bodies + headers to DIR
  compare DIR_A DIR_B             every capture of A against B (exit 0 only when all are IDENTICAL)
  manifest DIR                    writes DIR/manifest.json: normalised SHA-256, size, status and headers per capture
  check BASE INPUTS --golden DIR [--key-env NAME] [--refs ...] [--compat]
                                  capture into a temporary folder and compare with DIR/manifest.json

  BASE    --base URL, or --base-env NAME (the base URL is read from that environment variable). With --compat the
          base URL is read from the environment only (--base-env, default CAD_COMPAT_BASE).
  INPUTS  --files URL: a folder URL; the input of reference <ref> is URL/<ref>.step (for example a local
          `python3 -m http.server -d sheet-metal-service/tests/fixtures/unfold`), or
          --urls FILE: a JSON object {"<ref>": "<full input URL>", ...} with one entry per captured reference (for
          presigned GET URLs); each URL is used exactly as given.

The input URL is sent as "file_url" to /flat-pattern and downloaded by this tool for the multipart endpoints. The
shared key is read from the environment variable named by --key-env (default CAD_PARITY_KEY), never from the command
line. --compat captures /flat-pattern only and sends no key. Output and error lines never print the base URL or the
query of an input URL.

Exit codes: 0 identical (or self-test passed), 1 differs, 2 usage or transport error.
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import hashlib
import http.client
import http.server
import io
import json
import os
import re
import sys
import tempfile
import threading
import urllib.error
import urllib.request
import uuid
import zlib

REFERENCES = ("l_bend_45", "l_bend_90", "l_bend_135", "u_channel", "z_fold")

DEFAULT_KEY_ENV = "CAD_PARITY_KEY"
DEFAULT_COMPAT_BASE_ENV = "CAD_COMPAT_BASE"

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


PDF_STREAM_KEYWORD = re.compile(rb">>\s*stream(?:\r\n|\n)")
PDF_OBJ_HEAD = re.compile(rb"\d+\s+\d+\s+obj\b")
PDF_DIRECT_LENGTH = re.compile(rb"/Length\s+(\d+)(?![\d\s]*R\b)")
PDF_FILTER = re.compile(rb"/Filter\s*(\[[^\]]*\]|/[A-Za-z0-9]+)")
PDF_DRAWING_DATE = re.compile(rb"\(Date: \d{4}-\d\d-\d\d\)")
PDF_XREF_ENTRY = re.compile(rb"\d{10}([ \t]+\d{5}[ \t]+[fn])")
PDF_XREF_SECTION = re.compile(rb"(\bxref\s+\d+\s+\d+\s+)((?:\d{10}[ \t]+\d{5}[ \t]+[fn][ \t]*\r?\n?)+)")


def _pdf_decode(data: bytes, filters: list[bytes]) -> bytes | None:
    """The decoded stream for the filters ASCII85Decode and FlateDecode (in order), else None (compared raw)."""
    try:
        for name in filters:
            if name in (b"ASCII85Decode", b"A85"):
                text = data.strip()
                if text.startswith(b"<~"):
                    text = text[2:]
                end = text.find(b"~>")
                if end < 0:
                    return None
                data = base64.a85decode(text[:end])
            elif name in (b"FlateDecode", b"Fl"):
                data = zlib.decompress(data)
            else:
                return None
    except (ValueError, zlib.error):
        return None
    return data


def _pdf_content_streams(raw: bytes) -> bytes:
    """Every decodable stream replaced by its decoded content with the drawing date masked, /Length masked."""
    out = bytearray()
    pos = 0
    while True:
        m = PDF_STREAM_KEYWORD.search(raw, pos)
        if not m:
            break
        heads = list(PDF_OBJ_HEAD.finditer(raw, pos, m.start()))
        if not heads:
            break
        obj_start = heads[-1].start()
        head = raw[obj_start:m.start() + 2]
        start = m.end()
        length = PDF_DIRECT_LENGTH.search(head)
        end = -1
        if length:
            candidate = start + int(length.group(1))
            if re.match(rb"\s*endstream", raw[candidate:candidate + 32]):
                end = candidate
        if end < 0:
            keyword = raw.find(b"endstream", start)
            if keyword < 0:
                break
            end = keyword
            while end > start and raw[end - 1:end] in (b"\n", b"\r"):
                end -= 1
        filters_match = PDF_FILTER.search(head)
        filters = re.findall(rb"/([A-Za-z0-9]+)", filters_match.group(1)) if filters_match else []
        decoded = None if b"/DecodeParms" in head else _pdf_decode(raw[start:end], filters)
        out += raw[pos:obj_start]
        if decoded is None:
            out += raw[obj_start:end]
        else:
            out += PDF_DIRECT_LENGTH.sub(b"/Length <DECODED>", head) + raw[m.start() + 2:start]
            out += PDF_DRAWING_DATE.sub(b"(Date: <DATE>)", decoded)
        pos = end
    out += raw[pos:]
    return bytes(out)


def normalise_pdf(raw: bytes) -> bytes:
    raw = _pdf_content_streams(raw)
    raw = re.sub(rb"/CreationDate\s*\(D:[^)]*\)", b"/CreationDate (D:MASKED)", raw)
    raw = re.sub(rb"/ModDate\s*\(D:[^)]*\)", b"/ModDate (D:MASKED)", raw)
    raw = re.sub(rb"/ID\s*\[\s*<[0-9a-fA-F]*>\s*<[0-9a-fA-F]*>\s*\]", b"/ID [<MASKED><MASKED>]", raw)
    raw = PDF_XREF_SECTION.sub(lambda x: x.group(1) + PDF_XREF_ENTRY.sub(rb"<OFFSET>\1", x.group(2)), raw)
    return re.sub(rb"\bstartxref(\s+)\d+", rb"startxref\1<OFFSET>", raw)


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


def _drawing(day: str, width: str = "180.00", flat: str = "180.0", rev: str = "2026-01-01") -> bytes:
    """A page content stream shaped like the service's sheet: outline, a revision label and the title block."""
    return (
        b"1 0 0 1 0 0 cm\nq\n0 0 m " + width.encode() + b" 120.00 l S\n"
        b"BT /F1 7 Tf 1 0 0 1 120.5 40.51969 Tm (Rev: " + rev.encode() + b") Tj T* ET\n"
        b"BT /F1 7 Tf 1 0 0 1 640.25 40.51969 Tm (Flat: " + flat.encode() + b"\xd7120.0mm) Tj T* ET\n"
        b"BT /F1 7 Tf 1 0 0 1 782.763 40.51969 Tm (Date: " + day.encode() + b") Tj T* ET\n"
        b"BT /F2 8 Tf 1 0 0 1 1139.528 40.51969 Tm (MICRONS HUB) Tj T* ET\nQ\n"
    )


def _synthetic_pdf(content: bytes, created: str, file_id: str, stream: bytes | None = None, filters: bytes = b"[ /ASCII85Decode /FlateDecode ]", length_ref: bool = False) -> bytes:
    """A one-page PDF laid out as ReportLab writes it (object offsets, /Length, xref and startxref computed)."""
    data = stream if stream is not None else base64.a85encode(zlib.compress(content), wrapcol=72) + b"~>"
    # the content stream is not the last object, so a change of its length moves the offsets of the objects after it
    objects = [
        b"<<\n/F1 2 0 R /F2 3 0 R\n>>",
        b"<<\n/BaseFont /Helvetica /Encoding /WinAnsiEncoding /Name /F1 /Subtype /Type1 /Type /Font\n>>",
        b"<<\n/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding /Name /F2 /Subtype /Type1 /Type /Font\n>>",
        b"<<\n/Contents 5 0 R /MediaBox [ 0 0 1190.551 841.8898 ] /Parent 8 0 R /Resources <<\n/Font 1 0 R\n>> /Type /Page\n>>",
        b"<<\n/Filter " + filters + b" /Length " + (b"12 0 R" if length_ref else str(len(data)).encode()) + b"\n>>\nstream\n" + data + b"\nendstream",
        b"<<\n/PageMode /UseNone /Pages 8 0 R /Type /Catalog\n>>",
        b"<<\n/Author (anonymous) /CreationDate (D:" + created.encode() + b"+00'00') /ModDate (D:" + created.encode()
        + b"+00'00') /Producer (ReportLab PDF Library - \\(opensource\\))\n>>",
        b"<<\n/Count 1 /Kids [ 4 0 R ] /Type /Pages\n>>",
    ]
    out = bytearray(b"%PDF-1.4\n%\x93\x8c\x8b\x9e ReportLab Generated PDF document (opensource)\n")
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += str(number).encode() + b" 0 obj\n" + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 " + str(len(objects) + 1).encode() + b"\n0000000000 65535 f \n"
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<<\n/ID \n[<" + file_id.encode() + b"><" + file_id.encode() + b">]\n/Info 7 0 R\n/Root 6 0 R\n/Size "
    out += str(len(objects) + 1).encode() + b"\n>>\nstartxref\n" + str(xref).encode() + b"\n%%EOF\n"
    return bytes(out)


def _pdf_self_test(expect) -> None:
    day_a, day_b = "2026-10-08", "2026-10-09"
    pa = _synthetic_pdf(_drawing(day_a), "20261008193556", "6c0a2a06dcf20d9747ff72a1ded3ca6f")
    pb = _synthetic_pdf(_drawing(day_b), "20261009101501", "0f1e2d3c4b5a69788796a5b4c3d2e1f0")
    expect("PDF: the drawing date is inside the compressed content stream", b"Date:" not in pa and pa != pb)
    expect("PDF: two sheets that differ only in the drawing date, dates and /ID are IDENTICAL", diff_bodies(pa, pb, "pdf")[0])

    # a drawing date whose compressed stream has another length moves /Length, the xref offsets and startxref
    length_a = len(base64.a85encode(zlib.compress(_drawing(day_a)), wrapcol=72))
    other = next((f"20{y:02d}-{m:02d}-{d:02d}" for y in range(26, 40) for m in range(1, 13) for d in range(1, 29)
                  if len(base64.a85encode(zlib.compress(_drawing(f"20{y:02d}-{m:02d}-{d:02d}")), wrapcol=72)) != length_a), None)
    expect("PDF: a drawing date with another compressed length exists (precondition)", other is not None)
    if other is not None:
        pc = _synthetic_pdf(_drawing(other), "20270315080000", "aa55aa55aa55aa55aa55aa55aa55aa55")
        expect("PDF: precondition, the raw sizes differ", len(pc) != len(pa))
        expect("PDF: another drawing date with another stream length is IDENTICAL", diff_bodies(pa, pc, "pdf")[0])

    for label, changed in (
        ("a 0.01 mm outline change", _drawing(day_a, width="180.01")),
        ("a 0.1 mm change of the title block flat size", _drawing(day_a, flat="180.1")),
        ("another date-shaped text on the sheet", _drawing(day_a, rev="2026-01-02")),
        ("a drawing date in another form", _drawing(day_a).replace(b"(Date: 2026-10-08)", b"(Date: 08.10.2026)")),
    ):
        pd = _synthetic_pdf(changed, "20261008193556", "6c0a2a06dcf20d9747ff72a1ded3ca6f")
        expect(f"PDF: {label} inside the compressed stream DIFFERS", not diff_bodies(pa, pd, "pdf")[0])
        expect(f"PDF: {label} DIFFERS when the drawing dates differ as well", not diff_bodies(pb, pd, "pdf")[0])

    ref_a = _synthetic_pdf(_drawing(day_a), "20261008193556", "01", length_ref=True)
    ref_b = _synthetic_pdf(_drawing(day_b), "20261009101501", "02", length_ref=True)
    ref_c = _synthetic_pdf(_drawing(day_a, width="180.01"), "20261008193556", "01", length_ref=True)
    expect("PDF: a stream with an indirect /Length is decoded up to endstream", diff_bodies(ref_a, ref_b, "pdf")[0])
    expect("PDF: a stream with an indirect /Length and a 0.01 mm change DIFFERS", not diff_bodies(ref_a, ref_c, "pdf")[0])

    plain_a = _synthetic_pdf(b"", "20261008193556", "01", stream=_drawing(day_a), filters=b"[ ]")
    plain_b = _synthetic_pdf(b"", "20261009101501", "02", stream=_drawing(day_b), filters=b"[ ]")
    plain_c = _synthetic_pdf(b"", "20261008193556", "01", stream=_drawing(day_a, width="180.01"), filters=b"[ ]")
    expect("PDF: an unfiltered stream masks the drawing date", diff_bodies(plain_a, plain_b, "pdf")[0])
    expect("PDF: an unfiltered stream with a 0.01 mm change DIFFERS", not diff_bodies(plain_a, plain_c, "pdf")[0])

    image_a = _synthetic_pdf(b"", "20261008193556", "01", stream=b"\xff\xd8 Date: 2026-10-08", filters=b"/DCTDecode")
    image_b = _synthetic_pdf(b"", "20261008193556", "01", stream=b"\xff\xd8 Date: 2026-10-09", filters=b"/DCTDecode")
    broken_a = _synthetic_pdf(b"", "20261008193556", "01", stream=b"Gau0E>B=\"+&:XA~>")
    broken_b = _synthetic_pdf(b"", "20261008193556", "01", stream=b"Gau0E>B=\"+&:XB~>")
    expect("PDF: a stream with another filter is compared raw", not diff_bodies(image_a, image_b, "pdf")[0])
    expect("PDF: an undecodable stream is compared raw", not diff_bodies(broken_a, broken_b, "pdf")[0])
    expect("PDF: an undecodable stream equals itself", diff_bodies(broken_a, broken_a, "pdf")[0])


_SELF_TEST_STEP = b"ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n"


class _Recorder(http.server.BaseHTTPRequestHandler):
    """Local stand-in for the service and the file store: records every request, answers GET with a STEP file."""

    def _record(self, body: bytes) -> None:
        self.server.seen.append((self.command, self.path, {k.lower(): v for k, v in self.headers.items()}, body))  # type: ignore[attr-defined]

    def _answer(self, body: bytes, ctype: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802 - http.server naming
        self._record(b"")
        self._answer(_SELF_TEST_STEP, "application/octet-stream")

    def do_POST(self):  # noqa: N802 - http.server naming
        self._record(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
        self._answer(b'{"success": true}', "application/json")

    def log_message(self, *args):  # quiet
        pass


def _inputs_self_test(expect) -> None:
    refs = ("l_bend_45",)
    expect("inputs: --files gives <folder>/<ref>.step", inputs_from_files("http://127.0.0.1:8765/fixtures/", refs) == {"l_bend_45": "http://127.0.0.1:8765/fixtures/l_bend_45.step"})
    for label, text in (
        ("not JSON", "{"),
        ("not an object", '["https://files.example.test/a.step"]'),
        ("a missing reference", '{"l_bend_90": "https://files.example.test/a.step"}'),
        ("an unknown reference", '{"l_bend_45": "https://files.example.test/a.step", "l_bend_46": "https://files.example.test/b.step"}'),
        ("a value that is not an http(s) URL", '{"l_bend_45": "file:///tmp/a.step"}'),
    ):
        try:
            inputs_from_urls(text, refs)
            expect(f"inputs: --urls refuses {label}", False)
        except ValueError:
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Recorder)
    server.seen = []  # type: ignore[attr-defined]
    seen: list = server.seen  # type: ignore[attr-defined]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_address[1]}"
    signed_path = ("/microns-private/cad/parity/l_bend_45.step?X-Amz-Algorithm=AWS4-HMAC-SHA256"
                   "&X-Amz-Credential=T1PARITY%2F20261009%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20261009T090000Z"
                   "&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=" + "0f" * 32)
    signed = origin + signed_path
    key = "t1-" + uuid.uuid4().hex
    try:
        with tempfile.TemporaryDirectory(prefix="cad-parity-self-") as tmp:
            urls_file = os.path.join(tmp, "urls.json")
            with open(urls_file, "w", encoding="utf-8") as f:
                json.dump({"l_bend_45": signed}, f)
            expect("inputs: --urls keeps every URL exactly", inputs_from_urls(open(urls_file, encoding="utf-8").read(), refs) == {"l_bend_45": signed})

            with contextlib.redirect_stdout(io.StringIO()):
                capture(origin + "/svc", {"l_bend_45": signed}, os.path.join(tmp, "direct"), key, refs, False, timeout=10)
            posts = [s for s in seen if s[0] == "POST"]
            gets = [s for s in seen if s[0] == "GET"]
            flat = [p for p in posts if p[1] == "/svc/flat-pattern"]
            expect("inputs: /flat-pattern receives the presigned URL unchanged",
                   len(flat) == 1 and json.loads(flat[0][3]) == {"file_url": signed, "file_name": "l_bend_45.step"})
            expect("inputs: the multipart endpoints download the presigned URL unchanged", [g[1] for g in gets] == [signed_path] * 4)
            expect("inputs: the multipart endpoints upload the downloaded file",
                   len(posts) == 5 and all(_SELF_TEST_STEP in p[3] for p in posts if p[1] != "/svc/flat-pattern"))
            expect("inputs: the key goes to the service and never to the file store",
                   all(p[2].get("x-api-key") == key for p in posts) and all("x-api-key" not in g[2] for g in gets))

            seen.clear()
            with contextlib.redirect_stdout(io.StringIO()):
                capture(origin + "/api/cad/t1-direct", {"l_bend_45": signed}, os.path.join(tmp, "direct-compat"), key, refs, True, timeout=10)
            expect("compat: capture sends /flat-pattern only and never the key, even when one is given",
                   [(s[0], s[1]) for s in seen] == [("POST", "/api/cad/t1-direct/flat-pattern")] and "x-api-key" not in seen[0][2])

            seen.clear()
            env_name, key_name = "CAD_PARITY_SELF_TEST_BASE", "CAD_PARITY_SELF_TEST_KEY"
            previous = {n: os.environ.get(n) for n in (env_name, key_name)}
            os.environ[env_name] = origin + "/api/cad/t1-path-segment"
            os.environ[key_name] = key
            err = io.StringIO()
            common = ["--urls", urls_file, "--refs", "l_bend_45", "--key-env", key_name]
            try:
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                    code = main(["capture", "--compat", "--base-env", env_name, *common, "--out", os.path.join(tmp, "compat")])
                expect("compat: the base URL comes from the environment variable named by --base-env", code == 0)
                expect("compat: one /flat-pattern call with the presigned URL and no key",
                       [(s[0], s[1]) for s in seen] == [("POST", "/api/cad/t1-path-segment/flat-pattern")]
                       and json.loads(seen[0][3])["file_url"] == signed and "x-api-key" not in seen[0][2])
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                    code = main(["capture", "--compat", "--base", origin + "/api/cad/t1-path-segment", *common, "--out", os.path.join(tmp, "x")])
                expect("compat: the base URL is taken from the environment only (--base is a usage error)", code == 2 and len(seen) == 1)
                os.environ[env_name] = "cad.invalid/api/cad/t1-hidden-segment"
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                    code = main(["capture", "--compat", "--base-env", env_name, *common, "--out", os.path.join(tmp, "y")])
                expect("errors: a transport or usage error exits 2", code == 2)
            finally:
                for n, v in previous.items():
                    if v is None:
                        os.environ.pop(n, None)
                    else:
                        os.environ[n] = v
            text = err.getvalue()
            expect("errors: error lines never print the base URL", "t1-hidden-segment" not in text and "t1-path-segment" not in text and "<hidden>" in text)
    finally:
        server.shutdown()
        server.server_close()
    expect("errors: the query of a URL is never printed",
           redact("error: x " + signed + " y", []) == f"error: x {origin}/microns-private/cad/parity/l_bend_45.step?<query> y")


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
    _pdf_self_test(expect)
    _inputs_self_test(expect)

    if failures:
        for f in failures:
            print(f"self-test FAILED: {f}")
        return 1
    print("self-test ok (masks: DXF dates, GUIDs, ezdxf marker, CLASSES order; PDF dates, /ID and drawing date;"
          " 0.01 mm changes DIFFER; input URLs reach the service unchanged)")
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


def inputs_from_files(files: str, refs: tuple[str, ...]) -> dict[str, str]:
    """Input URL per reference for a folder URL: <files>/<ref>.step."""
    folder = files.rstrip("/")
    return {ref: f"{folder}/{ref}.step" for ref in refs}


def inputs_from_urls(text: str, refs: tuple[str, ...]) -> dict[str, str]:
    """Input URL per reference from a JSON object {"<ref>": "<URL>"}; every URL is kept exactly as given."""
    try:
        data = json.loads(text)
    except ValueError:
        raise ValueError("--urls: the file is not JSON") from None
    if not isinstance(data, dict):
        raise ValueError("--urls: expected a JSON object {\"<ref>\": \"<URL>\"}")
    unknown = sorted(k for k in data if k not in REFERENCES)
    if unknown:
        raise ValueError(f"--urls: unknown references {unknown} (known: {', '.join(REFERENCES)})")
    out: dict[str, str] = {}
    for ref in refs:
        url = data.get(ref)
        if not isinstance(url, str) or not re.match(r"^https?://[^\s/?#]+", url):
            raise ValueError(f"--urls: no http(s) URL for {ref}")
        out[ref] = url
    return out


def capture(base: str, inputs: dict[str, str], out_dir: str, key: str | None, refs: tuple[str, ...], compat: bool, timeout: float = 150.0) -> int:
    os.makedirs(out_dir, exist_ok=True)
    base = base.rstrip("/")
    for ref in refs:
        file_name = f"{ref}.step"
        file_url = inputs[ref]
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
    raw = " same_size=True" if want.get("bytes") == got.get("bytes") else ""
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


def check(base: str, inputs: dict[str, str], golden: str, key: str | None, refs: tuple[str, ...], compat: bool) -> int:
    with open(os.path.join(golden, "manifest.json"), encoding="utf-8") as f:
        want = json.load(f)["captures"]
    with tempfile.TemporaryDirectory(prefix="cad-parity-") as tmp:
        capture(base, inputs, tmp, key, refs, compat)
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


URL_QUERY = re.compile(r"(https?://[^\s'\"?#]*)\?[^\s'\"]*")


def redact(text: str, hidden: list[str]) -> str:
    """Text with every hidden value replaced and the query of every URL removed."""
    for value in sorted((v for v in hidden if v), key=len, reverse=True):
        text = text.replace(value, "<hidden>")
    return URL_QUERY.sub(r"\1?<query>", text)


class UsageError(ValueError):
    pass


def resolve_base(args: argparse.Namespace) -> str:
    """The base URL: --base, or the environment variable named by --base-env (always the environment for --compat)."""
    if args.compat and args.base is not None:
        raise UsageError(f"--compat reads the base URL from the environment variable named by --base-env (default {DEFAULT_COMPAT_BASE_ENV}), not from --base")
    if args.base is not None:
        return args.base
    name = args.base_env or (DEFAULT_COMPAT_BASE_ENV if args.compat else None)
    if not name:
        raise UsageError("give --base URL or --base-env NAME")
    value = os.environ.get(name, "").strip()
    if not value:
        raise UsageError(f"the environment variable {name} is empty")
    return value


def resolve_inputs(args: argparse.Namespace, refs: tuple[str, ...]) -> dict[str, str]:
    if args.urls is not None:
        with open(args.urls, encoding="utf-8") as f:
            return inputs_from_urls(f.read(), refs)
    return inputs_from_files(args.files, refs)


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
        base = p.add_mutually_exclusive_group()
        base.add_argument("--base")
        base.add_argument("--base-env")
        inputs = p.add_mutually_exclusive_group(required=True)
        inputs.add_argument("--files")
        inputs.add_argument("--urls")
        p.add_argument("--key-env", default=DEFAULT_KEY_ENV)
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

    hidden: list[str] = []
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
        unknown = sorted(set(refs) - set(REFERENCES))
        if unknown or not refs:
            raise UsageError(f"--refs: unknown references {unknown} (known: {', '.join(REFERENCES)})")
        base = resolve_base(args)
        hidden.append(base)
        key = os.environ.get(args.key_env) or None
        if key:
            hidden.append(key)
        inputs = resolve_inputs(args, refs)
        if args.cmd == "capture":
            return capture(base, inputs, args.out, key, refs, args.compat)
        return check(base, inputs, args.golden, key, refs, args.compat)
    except (OSError, urllib.error.URLError, ValueError, http.client.HTTPException) as e:
        print(redact(f"error: {type(e).__name__}: {e}", hidden), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
