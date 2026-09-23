import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('prepare_engine', Path(__file__).with_name('prepare_engine.py'))
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


class EngineContractTests(unittest.TestCase):
    def test_branding_preserves_browser_settings_but_does_not_claim_urls_or_self_update(self):
        source = {'CFBundleIdentifier': 'vendor', 'CrProductDirName': 'BrowserClaw',
                  'CFBundleURLTypes': ['https'], 'CFBundleDocumentTypes': ['html'],
                  'SUEnableAutomaticChecks': True, 'CFBundleIconName': 'AppIcon'}
        result = engine.branded_info(source)
        self.assertEqual(result['CFBundleIdentifier'], engine.BUNDLE_ID)
        self.assertEqual(result['CFBundleExecutable'], 'JPBridge')
        self.assertEqual(result['CrProductDirName'], 'BrowserClaw')
        self.assertFalse(result['SUEnableAutomaticChecks'])
        self.assertFalse(result['SUAutomaticallyUpdate'])
        self.assertNotIn('CFBundleURLTypes', result)
        self.assertNotIn('CFBundleDocumentTypes', result)
        self.assertNotIn('CFBundleIconName', result)
        self.assertEqual(source['CFBundleIdentifier'], 'vendor')

    def test_update_detection_includes_source_code_and_local_launch_bridge(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'source'
            resources = Path(root) / 'resources'
            paths = [source / 'Contents/Info.plist', source / 'Contents/MacOS/BrowserOS neo',
                     source / 'Contents/_CodeSignature/CodeResources',
                     resources / 'JP.icns', resources / 'JPBridge']
            for path in paths:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'original')
            original = engine.fingerprint(source, resources)
            self.assertEqual(original, engine.fingerprint(source, resources))
            for path in paths:
                path.write_bytes(b'updated')
                self.assertNotEqual(original, engine.fingerprint(source, resources))
                path.write_bytes(b'original')


if __name__ == '__main__':
    unittest.main()
