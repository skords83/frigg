#!/usr/bin/env bash
set -euo pipefail
# A fixed, upstream release; no production server or credentials are involved.
frigg_test_root="${1:?temporary download directory required}"
mkdir -p "$frigg_test_root"
curl -fLsS https://github.com/sabre-io/Baikal/releases/download/0.13.0/baikal-0.13.0.zip -o "$frigg_test_root/baikal.zip"
python3 - "$frigg_test_root" <<'PY'
import hashlib, pathlib, sys, zipfile
root = pathlib.Path(sys.argv[1])
archive = root / 'baikal.zip'
assert hashlib.sha256(archive.read_bytes()).hexdigest() == '81e74df123230e863f608d228fdd7b9a1a788f60b04d37e6973c302192e83f32'
zipfile.ZipFile(archive).extractall(root)
PY
