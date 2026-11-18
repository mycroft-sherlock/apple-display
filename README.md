# dsh-apple-display

DeepSeek Harness tools for controlling **Apple Studio Display** and **Pro Display XDR** brightness on **Windows 10/11**.

Apple's modern displays do not implement DDC/CI. They expose a vendor USB HID "Monitor Control" feature report instead. This plugin reads and writes that report.

> Status: Windows-only. Tested without a physical Apple display for the no-device error paths; hardware verification requires a connected Studio Display / Pro Display XDR.

## Tools

| Tool | Mutates | Purpose |
|---|---|---|
| `apple_display_list` | No | List Apple USB HID devices and Monitor Control interfaces |
| `apple_display_get` | No | Read current brightness percentage |
| `apple_display_set` | Yes | Set brightness to an exact 0–100 percentage |
| `apple_display_step` | Yes | Increase or decrease brightness by a signed delta |

## Install

```bash
dsh plugin --profile web add github:mycroft-sherlock/plugins
```

Requirements:

```text
Windows 10 or 11
Python 3.9+
pip install hidapi
Apple Studio Display or Pro Display XDR connected over USB-C/Thunderbolt
```

Set a non-default Python if needed:

```powershell
$env:APPLE_DISPLAY_PYTHON = "C:\Python312\python.exe"
```

## Safety and boundaries

```text
No shell execution
Fixed argv array
No arbitrary paths from the model
Percent validated 0..100
Delta validated -100..100, non-zero
15 second timeout
Python not found -> explicit error
hidapi missing -> explicit error
No display -> explicit error
Reads/writes only the Apple HID Monitor Control report
```

The plugin does not install Python packages automatically. It fails closed with an install instruction.

## Hardware verification

Without hardware, verify the error path:

```bash
python python/appledisplay.py list
python python/appledisplay.py get
```

With hardware:

```bash
python python/appledisplay.py list
python python/appledisplay.py get
python python/appledisplay.py set 50
python python/appledisplay.py step 10
```

Expected `list` shape:

```json
{"ok":true,"devices":[],"count":0}
```

If hardware is absent, `get` returns a JSON error and exit code 1, not a stack trace.

## Repository layout

```text
package.json
cordis.patch.yml
lib/index.js
python/appledisplay.py
README.md
LICENSE
```

## License

MIT. This is a clean-room bridge based on the publicly documented behavior of Apple's USB HID Monitor Control report; it does not vendor the original `AppleDisplay` Python application.
