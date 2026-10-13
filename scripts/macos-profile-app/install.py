#!/usr/bin/env python3
"""Build a local account launcher without modifying the installed BrowserOS neo."""
import argparse
import datetime
import json
import signal
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

SOURCE = Path(__file__).resolve().parent
REPO = SOURCE.parents[1]
HOME_DIR = Path.home()
DESTINATION = Path('/Applications/BrowserOS JP.app')
BUNDLE_ID = 'com.allman.browser.jp'


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def main():
    global DESTINATION, BUNDLE_ID
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', choices=['jp', 'brian'], default='jp')
    parser.add_argument('--update', action='store_true', help='Replace this owned launcher, preserving a private backup.')
    args = parser.parse_args()
    name = 'BrowserOS Brian' if args.profile == 'brian' else 'BrowserOS JP'
    DESTINATION = Path('/Applications') / (name + '.app')
    BUNDLE_ID = 'com.allman.browser.' + args.profile
    previous_config = {}
    if DESTINATION.exists():
        previous = plistlib.loads((DESTINATION / 'Contents/Info.plist').read_bytes())
        if previous.get('CFBundleIdentifier') != BUNDLE_ID or not args.update:
            raise SystemExit(f'{DESTINATION} exists; --update only replaces an owned launcher.')
        previous_config = json.loads((DESTINATION / 'Contents/Resources/launcher.json').read_text())
    launcher = SOURCE / 'open_brian.py' if args.profile == 'brian' else HOME_DIR / '.config/allman/jp/open-browser.py'
    if not launcher.is_file():
        raise SystemExit(f'Missing configured account launcher: {launcher}')
    runtime_path = ':'.join([str(HOME_DIR / '.local/share/mise/shims'),
                             str(HOME_DIR / '.local/bin'), '/opt/homebrew/bin',
                             '/usr/bin', '/bin', '/usr/sbin', '/sbin'])
    # Verify Finder's non-interactive environment can resolve the project runtime.
    run('/usr/bin/env', f'PATH={runtime_path}', 'bun', '--version')
    with tempfile.TemporaryDirectory(prefix='allman-jp-app-') as temporary:
        root = Path(temporary)
        app = root / DESTINATION.name
        contents = app / 'Contents'
        executable = contents / 'MacOS/JPLauncher'
        resources = contents / 'Resources'
        executable.parent.mkdir(parents=True)
        resources.mkdir()
        info = {
            'CFBundleIdentifier': BUNDLE_ID, 'CFBundleName': name,
            'CFBundleDisplayName': name, 'CFBundleExecutable': 'JPLauncher',
            'CFBundlePackageType': 'APPL', 'CFBundleVersion': '1',
            'CFBundleShortVersionString': '1.0', 'CFBundleIconFile': 'JP.icns',
            'NSPrincipalClass': 'NSApplication', 'NSHighResolutionCapable': True,
            'LSUIElement': True,
            'LSMinimumSystemVersion': '13.0',
            'LSApplicationCategoryType': 'public.app-category.utilities',
        }
        (contents / 'Info.plist').write_bytes(plistlib.dumps(info))
        config = {**previous_config, 'name': name, 'profile': args.profile, 'launcher': str(launcher),
                  'repository': str(REPO), 'runtimePath': runtime_path,
                  'logDirectory': str(HOME_DIR / '.config/allman' / args.profile / 'logs'),
                  'companionEndpoint': 'http://127.0.0.1:9222' if args.profile == 'brian' else 'http://127.0.0.1:9223',
                  'companionProfileDirectory': str(HOME_DIR / 'Library/Application Support/BrowserClaw'),
                  'browserApplication': '/Applications/BrowserOS neo.app'}
        config['engineApplication'] = str(HOME_DIR / '.config/allman/jp/BrowserOS JP.app')
        config['sessionRegistry'] = str(HOME_DIR / '.config/allman/session-control.json')
        config['companionLauncher'] = str(HOME_DIR / '.config/allman/jp/open-browser.py') if args.profile == 'brian' else str(SOURCE / 'open_brian.py')
        registry = json.loads(Path(config['sessionRegistry']).read_text())
        selected = next(p for p in registry['profiles'] if p['name'] == args.profile)
        config['account'] = selected['account']
        (resources / 'launcher.json').write_text(json.dumps(config, indent=2) + '\n')
        run('xcrun', 'swiftc', '-swift-version', '5', '-O', '-framework', 'AppKit',
            SOURCE / 'main.swift', '-o', executable)
        run('xcrun', 'clang', '-O2', SOURCE / 'bridge.c', '-o', resources / 'JPBridge')
        icon_tool = root / 'make-icon'
        run('xcrun', 'swiftc', '-swift-version', '5', '-framework', 'AppKit', SOURCE / 'icon.swift', '-o', icon_tool)
        iconset = root / 'JP.iconset'
        run(icon_tool, iconset, args.profile)
        run('/usr/bin/iconutil', '-c', 'icns', iconset, '-o', resources / 'JP.icns')
        run('/usr/bin/plutil', '-lint', contents / 'Info.plist')
        run('/usr/bin/codesign', '--force', '--sign', '-', app)
        run(executable, '--self-test')
        # Stage and verify on the destination filesystem before replacing the app.
        with tempfile.TemporaryDirectory(prefix='.allman-app-', dir=DESTINATION.parent) as staging:
            staged = Path(staging) / DESTINATION.name
            shutil.copytree(app, staged)
            run('/usr/bin/codesign', '--verify', '--deep', '--strict', staged)
            backup = None
            if DESTINATION.exists():
                executable_path = str(DESTINATION / 'Contents/MacOS/JPLauncher')
                for line in subprocess.check_output(['/bin/ps', '-axo', 'pid=,command='], text=True).splitlines():
                    parts = line.strip().split(None, 1)
                    if len(parts) == 2 and parts[1] == executable_path:
                        os.kill(int(parts[0]), signal.SIGTERM)
                backup = HOME_DIR / '.config/allman' / args.profile / 'app-backups' / datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f') / DESTINATION.name
                backup.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                DESTINATION.rename(backup)
            try:
                staged.rename(DESTINATION)
            except Exception:
                if backup is not None:
                    backup.rename(DESTINATION)
                raise
        print(f'Installed {DESTINATION}')


if __name__ == '__main__':
    os.chdir(REPO)
    main()
