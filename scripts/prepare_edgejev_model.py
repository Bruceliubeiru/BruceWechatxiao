#!/usr/bin/env python3
import hashlib
import os
import pathlib
import shutil
import sys
import tempfile
import urllib.request
import zipfile

MODEL_DIR = pathlib.Path(os.environ.get("EDGEJEV_MODEL_DIR", "/models/jev-int8"))
MODEL_ZIP = os.environ.get("EDGEJEV_MODEL_ZIP", "").strip()
EXPECTED_SHA = os.environ.get("EDGEJEV_MODEL_ZIP_SHA256", "").strip().lower()

REQUIRED = ("edgejev.json", "model.onnx", "tokenizer.json")

def ready():
    return all((MODEL_DIR / name).is_file() for name in REQUIRED)

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

if ready():
    print(f"[edgejev] model ready at {MODEL_DIR}")
    sys.exit(0)

if not MODEL_ZIP:
    print("[edgejev] no model present and EDGEJEV_MODEL_ZIP is not set; inference will stay disabled")
    sys.exit(0)

MODEL_DIR.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="edgejev-") as td:
    archive = pathlib.Path(td) / "model.zip"
    if MODEL_ZIP.startswith(("https://", "http://")):
        print("[edgejev] downloading model archive...")
        with urllib.request.urlopen(MODEL_ZIP, timeout=120) as src, open(archive, "wb") as dst:
            shutil.copyfileobj(src, dst)
    else:
        src = pathlib.Path(MODEL_ZIP)
        if not src.is_file():
            raise SystemExit(f"[edgejev] model archive not found: {src}")
        shutil.copy2(src, archive)

    actual = sha256(archive)
    print(f"[edgejev] archive sha256={actual}")
    if EXPECTED_SHA and actual != EXPECTED_SHA:
        raise SystemExit(f"[edgejev] checksum mismatch: expected {EXPECTED_SHA}, got {actual}")

    with zipfile.ZipFile(archive) as z:
        z.extractall(MODEL_DIR)

if not ready():
    # Support archives that contain one top-level folder.
    children = [p for p in MODEL_DIR.iterdir() if p.is_dir()]
    if len(children) == 1 and all((children[0] / n).is_file() for n in REQUIRED):
        child = children[0]
        for n in REQUIRED:
            shutil.move(str(child / n), str(MODEL_DIR / n))

if not ready():
    raise SystemExit("[edgejev] archive extracted, but required files are missing")

print(f"[edgejev] model prepared at {MODEL_DIR}")
