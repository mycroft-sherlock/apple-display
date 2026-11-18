#!/usr/bin/env python3
"""Apple display brightness bridge for DSH.

Windows only. A connected Apple Studio Display / Pro Display XDR exposes a
vendor HID "Monitor Control" feature report. This script reads and writes that
report and always emits one JSON object so the Node host can parse failures.

Requires: pip install hidapi
"""

from __future__ import annotations

import argparse
import json
import struct
import sys

try:
    import hid
except ImportError:
    hid = None

APPLE_VID = 0x05AC
KNOWN_PIDS = {
    0x1114: "Studio Display",
    0x1116: "Pro Display XDR",
    0x1118: "Studio Display (2nd generation)",
}
REPORT_ID = 0x01
BRIGHTNESS_MIN = 400
BRIGHTNESS_MAX = 60000
FEATURE_LEN = 7


class DisplayError(RuntimeError):
    pass


def emit(payload: dict, code: int = 0) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    raise SystemExit(code)


def require_hid() -> None:
    if hid is None:
        raise DisplayError(
            "Python package hidapi is not installed. Run: python -m pip install hidapi"
        )


def find_display():
    require_hid()
    candidates = list(hid.enumerate(APPLE_VID, 0))
    if not candidates:
        raise DisplayError(
            "No Apple USB HID device found. Connect the display with a "
            "data-capable USB-C/Thunderbolt cable and power it on."
        )
    monitor_ifaces = [
        d
        for d in candidates
        if d.get("usage_page") == 0x80 and d.get("usage") == 0x01
    ]
    if monitor_ifaces:
        return monitor_ifaces[0]
    known = [d for d in candidates if d.get("product_id") in KNOWN_PIDS]
    if known:
        return known[0]
    raise DisplayError(
        "Apple USB HID device found, but no Monitor Control interface. "
        "This is not a supported Studio Display / Pro Display XDR."
    )


def open_device():
    info = find_display()
    dev = hid.device()
    try:
        dev.open_path(info["path"])
    except Exception:
        try:
            dev.close()
        except Exception:
            pass
        raise
    name = KNOWN_PIDS.get(
        info["product_id"], "Apple Display (PID 0x%04x)" % info["product_id"]
    )
    return dev, name


def pct_to_raw(pct: int) -> int:
    pct = max(0, min(100, int(pct)))
    return round(BRIGHTNESS_MIN + (BRIGHTNESS_MAX - BRIGHTNESS_MIN) * pct / 100)


def raw_to_pct(raw: int) -> int:
    raw = max(BRIGHTNESS_MIN, min(BRIGHTNESS_MAX, int(raw)))
    return round((raw - BRIGHTNESS_MIN) * 100 / (BRIGHTNESS_MAX - BRIGHTNESS_MIN))


def get_raw(dev) -> int:
    data = dev.get_feature_report(REPORT_ID, FEATURE_LEN)
    if data is None or len(data) < 5:
        raise DisplayError(
            "Display returned a short HID feature report; brightness is unavailable."
        )
    return struct.unpack_from("<I", bytes(data), 1)[0]


def set_raw(dev, raw: int) -> int:
    raw = max(BRIGHTNESS_MIN, min(BRIGHTNESS_MAX, int(raw)))
    payload = struct.pack("<BIH", REPORT_ID, raw, 0)
    dev.send_feature_report(payload)
    return raw


def list_devices() -> list[dict]:
    require_hid()
    result = []
    for d in hid.enumerate(APPLE_VID, 0):
        result.append(
            {
                "productId": "0x%04x" % d["product_id"],
                "name": KNOWN_PIDS.get(d["product_id"], "Unknown Apple HID"),
                "usagePage": "0x%02x" % d.get("usage_page", 0),
                "usage": "0x%02x" % d.get("usage", 0),
                "path": d.get("path", ""),
                "monitorControl": d.get("usage_page") == 0x80
                and d.get("usage") == 0x01,
            }
        )
    return result


def with_device(action: str, value: int | None = None) -> dict:
    dev, name = open_device()
    try:
        if action == "get":
            raw = get_raw(dev)
            return {
                "ok": True,
                "name": name,
                "percent": raw_to_pct(raw),
                "raw": raw,
            }
        if action == "set":
            raw = set_raw(dev, pct_to_raw(int(value)))
            return {
                "ok": True,
                "name": name,
                "percent": raw_to_pct(raw),
                "raw": raw,
            }
        if action == "step":
            before = raw_to_pct(get_raw(dev))
            after = max(0, min(100, before + int(value)))
            raw = set_raw(dev, pct_to_raw(after))
            return {
                "ok": True,
                "name": name,
                "before": before,
                "percent": raw_to_pct(raw),
                "raw": raw,
            }
        raise DisplayError("Unknown action: %s" % action)
    finally:
        try:
            dev.close()
        except Exception:
            pass


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list")
    sub.add_parser("get")
    p_set = sub.add_parser("set")
    p_set.add_argument("percent", type=int)
    p_step = sub.add_parser("step")
    p_step.add_argument("delta", type=int)
    args = parser.parse_args()

    try:
        if args.command == "list":
            devices = list_devices()
            emit({"ok": True, "devices": devices, "count": len(devices)})
        if args.command == "set" and not 0 <= args.percent <= 100:
            emit({"ok": False, "error": "percent must be between 0 and 100"}, 2)
        if args.command == "step" and not 1 <= abs(args.delta) <= 100:
            emit({"ok": False, "error": "step must be between -100 and 100, not 0"}, 2)
        if args.command == "get":
            emit(with_device("get"))
        if args.command == "set":
            emit(with_device("set", args.percent))
        if args.command == "step":
            emit(with_device("step", args.delta))
    except DisplayError as exc:
        emit({"ok": False, "error": str(exc)}, 1)
    except Exception as exc:
        emit({"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}, 1)


if __name__ == "__main__":
    main()
