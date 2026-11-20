"""Verify that the handover files match FILE_MANIFEST.json. No network access."""
from pathlib import Path
import hashlib
import json
import sys

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'FILE_MANIFEST.json').read_text(encoding='utf-8'))
errors = []
for item in manifest['files']:
    path = root / item['path']
    if not path.is_file():
        errors.append(f"Missing: {item['path']}")
        continue
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != item['sha256'] or path.stat().st_size != item['bytes']:
        errors.append(f"Changed: {item['path']}")
print(f"Checked {len(manifest['files'])} files; mismatches: {len(errors)}")
for error in errors[:30]:
    print(error)
sys.exit(1 if errors else 0)
