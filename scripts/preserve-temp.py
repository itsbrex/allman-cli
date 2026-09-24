#!/usr/bin/env python3
"""Copy relevant temporary artifacts into a unique private archive; never execute them."""
import argparse
from datetime import date, datetime, time, timedelta
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
PREFIXES = ('allman-', 'jp-', 'JPLauncher', 'JPBridge', 'browseros-jp')
RELATED = {
    'add-career-review.py', 'attio-review-redesign.py', 'attio-review-polish.py',
    'customize-allman-review.py', 'edit-list-support.py', 'fix-enrichment-drawer.py',
    'polish-target-review.py', 'wire-list-ui.py', 'wire-salesnav.py',
    'build-browseros-jp-plugin.py', 'lists-deco-queries.js', 'list-utils.js', 'list-biome.json',
}
TEXT = {'.json', '.html', '.ts', '.js', '.mjs', '.py', '.sh', '.md', '.txt', '.log'}
SKIP = {'node_modules', '.git', '__pycache__', 'Cache', 'CacheStorage', 'GPUCache', 'Code Cache'}
MARKERS = (b'github/allman-cli', b'allman-enrichment.localhost', b'allman-activity.localhost',
           b'apps/target-enrichment.html', b'browseros-jp')


def recover(source: Path, destination: Path, day: date, timezone: str) -> dict:
    source = source.resolve(strict=True)
    destination = destination.resolve()
    if destination == source or source in destination.parents:
        raise ValueError('Destination must be outside the source tree')
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    destination.chmod(0o700)
    archive = Path(tempfile.mkdtemp(prefix=f'recovered-{day}-', dir=destination))
    start = datetime.combine(day, time(), ZoneInfo(timezone)).timestamp()
    end = datetime.combine(day + timedelta(days=1), time(), ZoneInfo(timezone)).timestamp()
    records, errors = [], []
    def onerror(error):
        errors.append({'path': error.filename, 'error': str(error)})
    for base, dirs, files in os.walk(source, followlinks=False, onerror=onerror):
        dirs[:] = sorted(d for d in dirs if d not in SKIP and not Path(base, d).is_symlink())
        for name in sorted(files):
            path = Path(base, name)
            try:
                metadata = path.lstat()
                if not stat.S_ISREG(metadata.st_mode) or not start <= metadata.st_mtime < end:
                    continue
                relative = path.relative_to(source)
                record = {'source': str(path), 'bytes': metadata.st_size,
                          'mtimeNs': metadata.st_mtime_ns, 'status': 'unrelated'}
                records.append(record)
                selected = any(part.startswith(PREFIXES) for part in relative.parts) or name in RELATED
                if not selected and path.suffix in TEXT and metadata.st_size <= 2_000_000:
                    # Inspect bytes only for project markers; never emit file content.
                    content = path.read_bytes()
                    selected = any(marker in content for marker in MARKERS)
                if not selected:
                    continue
                target = archive / 'files' / relative
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                digest = hashlib.sha256()
                # O_NOFOLLOW and exclusive output prevent link copying and overwrites.
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(fd, 'rb') as src, target.open('xb') as dst:
                    target.chmod(0o600)
                    before = os.fstat(src.fileno())
                    if (metadata.st_ino, metadata.st_size, metadata.st_mtime_ns) != (before.st_ino, before.st_size, before.st_mtime_ns):
                        raise RuntimeError('Source changed before copy; rerun recovery')
                    for chunk in iter(lambda: src.read(1024 * 1024), b''):
                        digest.update(chunk)
                        dst.write(chunk)
                    after = os.fstat(src.fileno())
                if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
                    raise RuntimeError('Source changed during copy; retained partial evidence, rerun recovery')
                copied = hashlib.sha256(target.read_bytes()).hexdigest()
                if copied != digest.hexdigest():
                    raise RuntimeError('Copy checksum mismatch')
                record.update(status='preserved', archivePath=str(target.relative_to(archive)),
                              sha256=copied, originalMode=oct(stat.S_IMODE(metadata.st_mode)))
            except (OSError, RuntimeError) as error:
                errors.append({'path': str(path), 'error': str(error)})
    manifest = {'version': 1, 'source': str(source), 'date': str(day), 'timezone': timezone,
                'createdAt': datetime.now().astimezone().isoformat(), 'archive': str(archive),
                'policy': 'Regular files only; caches and symlinks skipped. Name or project-marker selection. Copies are private and non-executable; originals untouched.',
                'files': records, 'errors': errors}
    manifest_path = archive / 'manifest.json'
    with manifest_path.open('x') as handle:
        manifest_path.chmod(0o600)
        json.dump(manifest, handle, indent=2)
        handle.write('\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('/tmp'))
    parser.add_argument('--destination', type=Path, default=ROOT / 'artifacts/local')
    parser.add_argument('--date', type=date.fromisoformat, required=True)
    parser.add_argument('--timezone', default='America/Los_Angeles')
    args = parser.parse_args()
    result = recover(args.source, args.destination, args.date, args.timezone)
    saved = [row for row in result['files'] if row['status'] == 'preserved']
    print(json.dumps({'manifest': result['archive'] + '/manifest.json', 'preserved': len(saved),
                      'bytes': sum(row['bytes'] for row in saved), 'errors': result['errors']}, indent=2))
    raise SystemExit(bool(result['errors']))
