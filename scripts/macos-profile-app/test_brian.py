import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('open_brian', Path(__file__).with_name('open_brian.py'))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

class BrianBindingTests(unittest.TestCase):
    def test_fixed_profile_and_both_port_flags_are_required(self):
        command = f'{launcher.BINARY} --user-data-dir={launcher.PROFILE} --remote-debugging-port=9222 --browseros-cdp-port=9222'
        self.assertTrue(launcher.check_binding(command))
        self.assertFalse(launcher.check_binding(command.replace('9222','9223')))
        self.assertFalse(launcher.check_binding(command.replace('9222','92220')))
        self.assertFalse(launcher.check_binding(command.replace(str(launcher.PROFILE),str(launcher.PROFILE)+'-other')))
    def test_unconfigured_browser_is_detected_and_helpers_are_excluded(self):
        rows=f'123 {launcher.BINARY}\n124 /Applications/BrowserOS neo.app/Contents/Frameworks/Helper --type=renderer\n'
        self.assertEqual(launcher.parse_owners(rows),[(123,launcher.BINARY)])

if __name__ == '__main__':
    unittest.main()
