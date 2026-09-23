#!/usr/bin/env python3
"""Build the local JP launcher without copying or modifying BrowserOS neo."""
import json
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
    if DESTINATION.exists():
        raise SystemExit(f'{DESTINATION} already exists; refusing to replace it without review.')
    launcher = HOME_DIR / '.config/allman/jp/open-browser.py'
    if not launcher.is_file():
        raise SystemExit(f'Missing configured JP launcher: {launcher}')
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
            'CFBundleIdentifier': BUNDLE_ID, 'CFBundleName': 'BrowserOS JP',
            'CFBundleDisplayName': 'BrowserOS JP', 'CFBundleExecutable': 'JPLauncher',
            'CFBundlePackageType': 'APPL', 'CFBundleVersion': '1',
            'CFBundleShortVersionString': '1.0', 'CFBundleIconFile': 'JP.icns',
            'NSPrincipalClass': 'NSApplication', 'NSHighResolutionCapable': True,
            'LSMinimumSystemVersion': '13.0',
            'LSApplicationCategoryType': 'public.app-category.utilities',
        }
        (contents / 'Info.plist').write_bytes(plistlib.dumps(info))
        config = {'name': 'BrowserOS JP', 'profile': 'jp', 'launcher': str(launcher),
                  'repository': str(REPO), 'runtimePath': runtime_path,
                  'logDirectory': str(HOME_DIR / '.config/allman/jp/logs'),
                  'companionEndpoint': 'http://127.0.0.1:9222',
                  'companionProfileDirectory': str(HOME_DIR / 'Library/Application Support/BrowserClaw'),
                  'browserApplication': '/Applications/BrowserOS neo.app'}
        (resources / 'launcher.json').write_text(json.dumps(config, indent=2) + '\n')
        run('xcrun', 'swiftc', '-swift-version', '5', '-O', '-framework', 'AppKit',
            SOURCE / 'main.swift', '-o', executable)
        icon_tool = root / 'make-icon'
        run('xcrun', 'swiftc', '-swift-version', '5', '-framework', 'AppKit', SOURCE / 'icon.swift', '-o', icon_tool)
        iconset = root / 'JP.iconset'
        run(icon_tool, iconset)
        run('/usr/bin/iconutil', '-c', 'icns', iconset, '-o', resources / 'JP.icns')
        run('/usr/bin/plutil', '-lint', contents / 'Info.plist')
        run('/usr/bin/codesign', '--force', '--sign', '-', app)
        run(executable, '--self-test')
        # Publish only after compilation, signing and configuration checks pass.
        shutil.copytree(app, DESTINATION)
        run('/usr/bin/codesign', '--verify', '--deep', '--strict', DESTINATION)
        print(f'Installed {DESTINATION}')


if __name__ == '__main__':
    os.chdir(REPO)
    main()
