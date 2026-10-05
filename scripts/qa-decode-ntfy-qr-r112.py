"""r112 QA — true decode check: decode the QR PNG the browser actually
rendered (extracted from the live DOM) and assert the decoded string IS
the expected payload. Decoding is build-independent — the browser and
node PNG encoders differ byte-wise, but the DECODED PAYLOAD is the only
truth that matters."""
import base64
import json
import sys

import cv2
import numpy as np

raw = open("/tmp/ntfy-qr-state.json").read().strip()
state = json.loads(json.loads(raw))
dom_qr: str = state["qr"]
topic: str = state["topic"]
web_anchor: str | None = state.get("webAnchor")

assert dom_qr.startswith("data:image/png;base64,"), "not a PNG data URL"
b64 = dom_qr.split(",", 1)[1]
png_bytes = base64.b64decode(b64)
arr = np.frombuffer(png_bytes, dtype=np.uint8)
img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
assert img is not None, "unparseable PNG"

detector = cv2.QRCodeDetector()
decoded, _, _ = detector.detectAndDecode(img)
expected = f"https://ntfy.sh/{topic}"

print("decoded:", decoded)
print("expected:", expected)
print("web anchor:", web_anchor)
ok = decoded == expected
print("PASS — decoded payload === documented web link" if ok else "FAIL")
sys.exit(0 if ok else 1)
