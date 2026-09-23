#!/usr/bin/env python3
"""Refresh JP's branded browser from the installed Neo on cold launches only."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile

BUNDLE_ID = 'com.allman.browser.jp.engine'


def fingerprint(source, resources):
    digest = hashlib.sha256()
    for path in [source / 'Contents/Info.plist',
                 source / 'Contents/MacOS/BrowserOS neo',
                 source / 'Contents/_CodeSignature/CodeResources',
                 resources / 'JP.icns', resources / 'JPBridge', Path(__file__)]:
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def browser_pids(engine):
    executable = str(engine / 'Contents/MacOS/BrowserOS neo')
    lines = subprocess.check_output(['/bin/ps', '-axo', 'pid=,command='], text=True).splitlines()
    return [int(parts[0]) for line in lines
            if len(parts := line.strip().split(None, 1)) == 2
            and (parts[1] == executable or parts[1].startswith(executable + ' '))]


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True, stdout=sys.stderr)


def assert_owned(app):
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    if info.get('CFBundleIdentifier') != BUNDLE_ID:
        raise RuntimeError(f'Refusing to replace an unrecognized browser bundle: {app}')


def branded_info(info):
    result = dict(info)
    result.update(CFBundleIdentifier=BUNDLE_ID, CFBundleName='BrowserOS JP',
                  CFBundleDisplayName='BrowserOS JP', CFBundleExecutable='JPBridge',
                  CFBundleIconFile='JP.icns', SUEnableAutomaticChecks=False,
                  SUAutomaticallyUpdate=False, SUAllowsAutomaticUpdates=False)
    for key in ['CFBundleURLTypes', 'CFBundleDocumentTypes', 'LSUIElement', 'CFBundleIconName']:
        result.pop(key, None)
    return result


def prepare(app):
    resources = app / 'Contents/Resources'
    config = json.loads((resources / 'launcher.json').read_text())
    source = Path(config['browserApplication'])
    engine = Path(config['engineApplication'])
    if source.resolve() == engine.resolve():
        raise RuntimeError('Source browser and branded browser must be separate.')
    engine.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = engine.parent / 'engine-source.json'
    lock = engine.parent / '.engine-build.lock'
    with lock.open('a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        current = fingerprint(source, resources)
        if engine.exists():
            assert_owned(engine)
            if stamp.exists() and json.loads(stamp.read_text()).get('fingerprint') == current:
                run('/usr/bin/codesign', '--verify', '--deep', '--strict', engine)
                return engine / 'Contents/MacOS/BrowserOS neo'
            if browser_pids(engine):
                raise RuntimeError('JP is running. Quit it normally before refreshing its browser build.')
        # Verify source code before cloning; metadata is normalized only on our copy.
        run('/usr/bin/codesign', '--verify', '--deep', source)
        with tempfile.TemporaryDirectory(prefix='.engine-stage-', dir=engine.parent) as temporary:
            staged = Path(temporary) / 'BrowserOS JP.app'
            run('/bin/cp', '-cR', source, staged)
            for attribute in ['com.apple.FinderInfo', 'com.apple.ResourceFork']:
                subprocess.run(['/usr/bin/xattr', '-rd', attribute, str(staged)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            contents = staged / 'Contents'
            info = plistlib.loads((contents / 'Info.plist').read_bytes())
            (contents / 'Info.plist').write_bytes(plistlib.dumps(branded_info(info)))
            shutil.copyfile(resources / 'JP.icns', contents / 'Resources/JP.icns')
            shutil.copyfile(resources / 'JPBridge', contents / 'MacOS/JPBridge')
            (contents / 'MacOS/JPBridge').chmod(0o755)
            # Re-sign only our copied browser entry point and outer bundle.
            # Vendor frameworks and the installed source are never modified.
            run('/usr/bin/codesign', '--force', '--sign', '-', '--preserve-metadata=entitlements',
                contents / 'MacOS/BrowserOS neo')
            run('/usr/bin/codesign', '--force', '--sign', '-', staged)
            run('/usr/bin/codesign', '--verify', '--deep', '--strict', staged)
            if fingerprint(source, resources) != current or browser_pids(engine):
                raise RuntimeError('Browser installation or process changed during refresh; retry.')
            previous = engine.parent / '.engine-previous.app'
            if previous.exists():
                assert_owned(previous)
                shutil.rmtree(previous)
            if engine.exists():
                engine.rename(previous)
            try:
                staged.rename(engine)
            except Exception:
                if previous.exists() and not engine.exists():
                    previous.rename(engine)
                raise
            replacement = stamp.with_suffix('.tmp')
            replacement.write_text(json.dumps({'fingerprint': current,
                'source': str(source), 'version': info.get('CFBundleShortVersionString')}) + '\n')
            replacement.replace(stamp)
        return engine / 'Contents/MacOS/BrowserOS neo'


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, default=Path('/Applications/BrowserOS JP.app'))
    args = parser.parse_args()
    try:
        print(prepare(args.app))
    except Exception as error:
        print(f'JP browser preparation failed: {error}', file=sys.stderr)
        raise SystemExit(1)
