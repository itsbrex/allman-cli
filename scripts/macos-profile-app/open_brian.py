#!/usr/bin/env python3
"""Start or reuse Brian's saved browser with a fixed, verified CDP binding."""
import argparse
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

REPO = Path(__file__).resolve().parents[2]
BINARY = '/Applications/BrowserOS neo.app/Contents/MacOS/BrowserOS neo'
PROFILE = Path.home() / 'Library/Application Support/BrowserClaw'
ENDPOINT = 'http://127.0.0.1:9222'


def parse_owners(lines):
    return [(int(parts[0]), parts[1]) for line in lines.splitlines()
            if len(parts := line.strip().split(None, 1)) == 2
            and (parts[1] == BINARY or parts[1].startswith(BINARY + ' '))]


def check_binding(command):
    return (bool(re.search(re.escape(f'--user-data-dir={PROFILE}') + r'(?= --|$)', command))
            and bool(re.search(r'--remote-debugging-port=9222(?= |$)', command))
            and bool(re.search(r'--browseros-cdp-port=9222(?= |$)', command))
            and bool(re.search(r'--browseros-server-port=9210(?= |$)', command))
            and bool(re.search(r'--browseros-proxy-port=9010(?= |$)', command)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--restore-session', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    owners = parse_owners(subprocess.check_output(['/bin/ps', '-axo', 'pid=,command='], text=True))
    if len(owners) > 1 or any(not check_binding(command) for _, command in owners):
        raise RuntimeError('Neo is already running without Brian\'s fixed profile/port flags. Quit Neo normally, then open BrowserOS Brian again. No browser was stopped.')
    started = not owners
    if started:
        import socket
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 9222))
        logs = Path.home() / '.config/allman/brian/logs'
        logs.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (logs / 'browser.log').open('a') as output:
            process = subprocess.Popen([BINARY, f'--user-data-dir={PROFILE}',
                '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9222',
                '--browseros-cdp-port=9222', '--browseros-server-port=9210',
                '--browseros-proxy-port=9010', '--enable-features=OnDeviceModelForceCpuBackend',
                '--no-first-run', '--no-default-browser-check',
                *(['--restore-last-session'] if args.restore_session else []), 'chrome://version'],
                stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                start_new_session=True, close_fds=True)
        pid = process.pid
    else:
        pid = owners[0][0]
    deadline = time.monotonic() + 120
    while True:
        try:
            with urllib.request.urlopen(ENDPOINT + '/json/version', timeout=2) as response:
                if not json.load(response).get('webSocketDebuggerUrl'):
                    raise ValueError('CDP response missing browser identity')
            listeners = subprocess.check_output(['/usr/sbin/lsof', '-nP', '-t',
                '-iTCP:9222', '-sTCP:LISTEN'], text=True).split()
            if listeners != [str(pid)]:
                raise RuntimeError('Port 9222 does not belong to Brian\'s verified browser process.')
            break
        except (OSError, ValueError, subprocess.CalledProcessError):
            if time.monotonic() >= deadline:
                raise RuntimeError('Brian browser did not expose CDP within 120 seconds. Inspect brian/logs/browser.log.')
            time.sleep(0.5)
    result = subprocess.run(['bun', str(REPO / 'scripts/macos-profile-app/verify_profile.ts'), 'brian'],
        cwd=REPO, capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'Brian Shield verification failed.')
    receipt = dict(profile='brian', pid=pid, endpoint=ENDPOINT, started=started, shieldVerified=True)
    print(json.dumps(receipt) if args.json else 'Brian browser ready: fixed CDP 9222; Shield verified.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
