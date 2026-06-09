# -*- coding: utf-8 -*-
"""Prepare the bundled Windows Python runtime used by Excel writing.

This script downloads the official Windows embeddable Python distribution and
installs openpyxl into the bundled runtime directory. Run it before building the
Tauri installer on Windows:

    python prepare_bundled_python.py

The generated runtime is written to resources/python-windows/ and is bundled by
Tauri via tauri.conf.json.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

PYTHON_VERSION = "3.12.10"
PYTHON_TAG = "312"
PYTHON_EMBED_URL = (
    f"https://www.python.org/ftp/python/{PYTHON_VERSION}/"
    f"python-{PYTHON_VERSION}-embed-amd64.zip"
)
ROOT = Path(__file__).resolve().parent
RUNTIME_DIR = ROOT / "resources" / "python-windows"
REQUIREMENTS = ROOT / "requirements.txt"


def download(url, target):
    print(f"Downloading {url}")
    urllib.request.urlretrieve(url, target)


def enable_site_packages(runtime_dir):
    pth = runtime_dir / f"python{PYTHON_TAG}._pth"
    lines = []
    if pth.exists():
        lines = pth.read_text(encoding="utf-8").splitlines()

    required = ["Lib/site-packages", "import site"]
    for line in required:
        if line not in lines:
            lines.append(line)

    pth.write_text("\n".join(lines) + "\n", encoding="utf-8")


def install_packages(runtime_dir):
    site_packages = runtime_dir / "Lib" / "site-packages"
    site_packages.mkdir(parents=True, exist_ok=True)

    subprocess.check_call(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--upgrade",
            "--target",
            str(site_packages),
            "-r",
            str(REQUIREMENTS),
        ]
    )


def smoke_test(runtime_dir):
    python_exe = runtime_dir / "python.exe"
    subprocess.check_call([str(python_exe), "-c", "import openpyxl; print(openpyxl.__version__)"])


def main():
    if os.name != "nt":
        raise SystemExit("Bundled Python preparation currently supports Windows builds only.")

    if not REQUIREMENTS.exists():
        raise SystemExit(f"Missing requirements file: {REQUIREMENTS}")

    if RUNTIME_DIR.exists():
        shutil.rmtree(RUNTIME_DIR)
    RUNTIME_DIR.mkdir(parents=True)

    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "python-embed.zip"
        download(PYTHON_EMBED_URL, archive)
        with zipfile.ZipFile(archive) as zf:
            zf.extractall(RUNTIME_DIR)

    enable_site_packages(RUNTIME_DIR)
    install_packages(RUNTIME_DIR)
    smoke_test(RUNTIME_DIR)
    print(f"Bundled Python is ready: {RUNTIME_DIR}")


if __name__ == "__main__":
    main()
