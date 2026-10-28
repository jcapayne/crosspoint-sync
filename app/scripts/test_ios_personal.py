import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('ios_personal', Path(__file__).with_name('ios_personal.py'))
personal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(personal)
APP = Path(__file__).resolve().parents[1]
PROJECT = Path('src-tauri/gen/apple/crosspoint-sync-app.xcodeproj/project.pbxproj')

def read_project(path):
    return json.loads(subprocess.check_output(['plutil', '-convert', 'json', '-o', '-', str(path)]))

class PersonalBuildTests(unittest.TestCase):
    def test_prepares_isolated_project_without_restricted_capabilities(self):
        original = (APP / PROJECT).read_bytes()
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp) / 'personal'
            personal.prepare(APP, dest, team='ABCDE12345')
            config = json.loads((dest / 'src-tauri/tauri.conf.json').read_text())
            self.assertNotEqual(config['identifier'], 'com.crosspointreader.sync')
            self.assertEqual(config['bundle']['iOS']['developmentTeam'], 'ABCDE12345')
            self.assertEqual(config['plugins']['deep-link']['mobile'], [])
            project = read_project(dest / PROJECT)
            objects = project['objects']
            targets = [objects[t] for t in objects[project['rootObject']]['targets']]
            self.assertEqual([t['name'] for t in targets], ['crosspoint-sync-app_iOS'])
            self.assertEqual(targets[0]['dependencies'], [])
            self.assertFalse(any(objects[p]['isa'] == 'PBXCopyFilesBuildPhase' for p in targets[0]['buildPhases']))
            for cid in objects[targets[0]['buildConfigurationList']]['buildConfigurations']:
                settings = objects[cid]['buildSettings']
                self.assertEqual(settings['DEVELOPMENT_TEAM'], 'ABCDE12345')
                entitlements = dest / 'src-tauri/gen/apple' / settings['CODE_SIGN_ENTITLEMENTS']
                self.assertEqual(json.loads(subprocess.check_output(['plutil', '-convert', 'json', '-o', '-', str(entitlements)])), {})
            self.assertFalse((dest / 'src-tauri/gen/apple/Externals').exists())
            self.assertEqual((APP / PROJECT).read_bytes(), original)
            # Regeneration preserves bundle identity and the selected signing team.
            personal.prepare(APP, dest)
            again = json.loads((dest / 'src-tauri/tauri.conf.json').read_text())
            self.assertEqual(again['identifier'], config['identifier'])
            self.assertEqual(again['bundle']['iOS']['developmentTeam'], 'ABCDE12345')

    def test_xcode_phase_finds_rustup_without_shell_profile(self):
        project = read_project(APP / PROJECT)
        phase = next(o for o in project['objects'].values()
                     if o.get('isa') == 'PBXShellScriptBuildPhase' and o.get('name') == 'Build Rust Code')
        with tempfile.TemporaryDirectory() as temp:
            cargo_bin = Path(temp) / 'bin'
            cargo_bin.mkdir()
            cargo = cargo_bin / 'cargo'
            cargo.write_text('#!/bin/sh\nprintf "cargo-found\\n"\n')
            cargo.chmod(0o755)
            env = {'PATH': '/usr/bin:/bin', 'HOME': temp, 'CARGO_HOME': temp,
                   'PLATFORM_DISPLAY_NAME': 'iOS', 'SDKROOT': '/sdk',
                   'FRAMEWORK_SEARCH_PATHS': '/frameworks', 'HEADER_SEARCH_PATHS': '/headers',
                   'CONFIGURATION': 'debug', 'ARCHS': 'arm64'}
            result = subprocess.run(['/bin/sh', '-c', phase['shellScript']], env=env,
                                    text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), 'cargo-found')

    def test_rejects_invalid_team_before_writing(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp) / 'personal'
            with self.assertRaises(ValueError):
                personal.prepare(APP, dest, team='not a team')
            self.assertFalse(dest.exists())

if __name__ == '__main__':
    unittest.main()
