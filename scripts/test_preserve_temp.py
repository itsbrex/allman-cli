import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from datetime import date, datetime
from zoneinfo import ZoneInfo

spec = importlib.util.spec_from_file_location('preserve_temp', Path(__file__).with_name('preserve-temp.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RecoveryTests(unittest.TestCase):
    def test_private_verified_non_destructive_recovery(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'source'
            source.mkdir()
            for name, body in [('allman-report.json', '{"saved":true}'),
                               ('patch.py', '# github/allman-cli'), ('unrelated.json', '{}')]:
                path = source / name
                path.write_text(body)
                instant = datetime(2026, 9, 23, 23, 59, tzinfo=ZoneInfo('America/Los_Angeles')).timestamp()
                os.utime(path, (instant, instant))
            (source / 'allman-link').symlink_to(source / 'allman-report.json')
            (source / 'allman-other-day.json').write_text('{}')
            os.utime(source / 'allman-other-day.json', (0, 0))
            for _ in range(2):
                report = module.recover(source, root / 'dest', date(2026, 9, 23), 'America/Los_Angeles')
                self.assertEqual(report['errors'], [])
                saved = [r for r in report['files'] if r['status'] == 'preserved']
                self.assertEqual(len(saved), 2)
                for row in saved:
                    target = Path(report['archive']) / row['archivePath']
                    self.assertEqual(target.read_bytes(), Path(row['source']).read_bytes())
                    self.assertEqual(target.stat().st_mode & 0o777, 0o600)
                self.assertEqual(json.loads((Path(report['archive']) / 'manifest.json').read_text()), report)
            self.assertEqual(len(list((root / 'dest').iterdir())), 2)
            self.assertTrue((source / 'allman-report.json').exists())
            self.assertTrue((source / 'allman-link').is_symlink())

    def test_rejects_recursive_destination(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):
                module.recover(Path(temp), Path(temp) / 'nested', date(2026, 9, 23), 'UTC')


if __name__ == '__main__':
    unittest.main()
