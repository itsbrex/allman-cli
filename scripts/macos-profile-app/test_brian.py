import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('open_brian', Path(__file__).with_name('open_brian.py'))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

class BrianBindingTests(unittest.TestCase):
    def test_fixed_profile_and_both_port_flags_are_required(self):
        command = f'{launcher.BINARY} --user-data-dir={launcher.PROFILE} --remote-debugging-port=9222 --browseros-cdp-port=9222 --browseros-server-port=9210 --browseros-proxy-port=9010'
        self.assertTrue(launcher.check_binding(command))
        self.assertFalse(launcher.check_binding(command.replace('9222','9223')))
        self.assertFalse(launcher.check_binding(command.replace('9222','92220')))
        self.assertFalse(launcher.check_binding(command.replace(str(launcher.PROFILE),str(launcher.PROFILE)+'-other')))
        for flag in ['--browseros-server-port=9210', '--browseros-proxy-port=9010']:
            self.assertFalse(launcher.check_binding(command.replace(flag, '')))
            self.assertFalse(launcher.check_binding(command.replace(flag, flag + '0')))
        self.assertFalse(launcher.check_binding(command.replace('9210', '9211')))
        self.assertFalse(launcher.check_binding(command.replace('9010', '9012')))
    def test_unconfigured_browser_is_detected_and_helpers_are_excluded(self):
        rows=f'123 {launcher.BINARY}\n124 /Applications/BrowserOS neo.app/Contents/Frameworks/Helper --type=renderer\n'
        self.assertEqual(launcher.parse_owners(rows),[(123,launcher.BINARY)])

    def test_cold_launch_pins_backend_and_proxy_before_verifying_shield(self):
        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(sys, 'argv', ['open_brian.py', '--restore-session', '--json']), \
                patch.object(launcher.Path, 'home', return_value=Path(temporary)), \
                patch.object(launcher.subprocess, 'check_output', side_effect=['', '123\n']), \
                patch.object(launcher.subprocess, 'Popen', return_value=Mock(pid=123)) as start, \
                patch.object(launcher.subprocess, 'run', return_value=Mock(returncode=0)) as verify, \
                patch('socket.socket'), \
                patch.object(launcher.urllib.request, 'urlopen', return_value=io.StringIO('{"webSocketDebuggerUrl":"ws://localhost"}')), \
                patch('sys.stdout', new_callable=io.StringIO) as output:
            launcher.main()
            command = start.call_args.args[0]
            self.assertIn('--browseros-server-port=9210', command)
            self.assertIn('--browseros-proxy-port=9010', command)
            self.assertIn('--restore-last-session', command)
            self.assertTrue(launcher.check_binding(' '.join(command)))
            verify.assert_called_once()
            self.assertTrue(json.loads(output.getvalue())['shieldVerified'])

if __name__ == '__main__':
    unittest.main()
