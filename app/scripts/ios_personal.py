#!/usr/bin/env python3
"""Generate an isolated free-Personal-Team project and run it with Tauri."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import uuid

PROJECT = Path('src-tauri/gen/apple/crosspoint-sync-app.xcodeproj/project.pbxproj')

def read_project(path):
    return json.loads(subprocess.check_output(['plutil', '-convert', 'json', '-o', '-', str(path)]))

def openstep(value, depth=0):
    """Tauri's project editor expects OpenStep, not an XML/JSON plist."""
    pad = '\t' * depth
    if isinstance(value, dict):
        return '{\n' + ''.join(pad + '\t' + json.dumps(k) + ' = ' + openstep(v, depth + 1) + ';\n' for k, v in value.items()) + pad + '}'
    if isinstance(value, list):
        return '(\n' + ''.join(pad + '\t' + openstep(v, depth + 1) + ',\n' for v in value) + pad + ')'
    return json.dumps(str(value))

def selected_team(dest):
    path = dest / PROJECT
    if not path.exists():
        return None
    project = read_project(path)
    objects = project['objects']
    for target_id in objects[project['rootObject']]['targets']:
        target = objects[target_id]
        for cid in objects[target['buildConfigurationList']]['buildConfigurations']:
            team = objects[cid]['buildSettings'].get('DEVELOPMENT_TEAM')
            if team:
                return team
    return None

def prepare(app, dest, team=None):
    team = team or selected_team(dest)
    if team and not re.fullmatch(r'[A-Z0-9]{10}', team):
        raise ValueError('Team ID must contain exactly 10 uppercase letters or digits.')
    state_path = dest / '.personal-build.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    identifier = state.get('identifier') or 'dev.crosspointsync.personal.p' + uuid.uuid4().hex[:12]
    dest.mkdir(parents=True, exist_ok=True)
    # Copy current native sources on every run; skip derived outputs and other platforms.
    native = dest / 'src-tauri'
    if native.exists():
        shutil.rmtree(native)
    shutil.copytree(app / 'src-tauri', native, ignore=shutil.ignore_patterns(
        'target', 'build', 'Externals', 'android', 'schemas', 'xcuserdata', '__pycache__'))
    for name in ['src', 'public', 'node_modules']:
        link = dest / name
        if not link.exists():
            link.symlink_to(app / name, target_is_directory=True)
    for name in ['package.json', 'package-lock.json', 'vite.config.js', 'index.html']:
        shutil.copy2(app / name, dest / name)
    config_path = native / 'tauri.conf.json'
    config = json.loads(config_path.read_text())
    config['identifier'] = identifier
    config['bundle']['iOS']['developmentTeam'] = team
    config['plugins']['deep-link']['mobile'] = []
    config_path.write_text(json.dumps(config, indent=2) + '\n')
    project = read_project(dest / PROJECT)
    objects = project['objects']
    root = objects[project['rootObject']]
    root['targets'] = [tid for tid in root['targets'] if objects[tid]['name'] == 'crosspoint-sync-app_iOS']
    target = objects[root['targets'][0]]
    # No widget build dependency or embedded extension: both would need App Groups.
    target['dependencies'] = []
    target['buildPhases'] = [p for p in target['buildPhases'] if objects[p]['isa'] != 'PBXCopyFilesBuildPhase']
    for cid in objects[target['buildConfigurationList']]['buildConfigurations']:
        settings = objects[cid]['buildSettings']
        settings.update(DEVELOPMENT_TEAM=team or '', PRODUCT_BUNDLE_IDENTIFIER=identifier,
                        CODE_SIGN_STYLE='Automatic', CODE_SIGN_IDENTITY='Apple Development',
                        CODE_SIGN_ENTITLEMENTS='Personal.entitlements')
        settings.pop('PROVISIONING_PROFILE_SPECIFIER', None)
        settings.pop('PROVISIONING_PROFILE', None)
    # Strip capability hints too; the sole target's actual entitlements are empty.
    for attributes in root.get('attributes', {}).get('TargetAttributes', {}).values():
        attributes.pop('SystemCapabilities', None)
        attributes['DevelopmentTeam'] = team or ''
    (dest / PROJECT).write_text('// !$*UTF8*$!\n' + openstep(project) + '\n')
    apple = native / 'gen/apple'
    with (apple / 'Personal.entitlements').open('wb') as output:
        plistlib.dump({}, output)
    # Keep all entitlement files free of paid-team capabilities in the local copy.
    for path in apple.rglob('*.entitlements'):
        with path.open('wb') as output:
            plistlib.dump({}, output)
    with (apple / 'ExportOptions.plist').open('wb') as output:
        plistlib.dump({'method': 'debugging', 'signingStyle': 'automatic', 'teamID': team or ''}, output)
    # project.yml describes official regeneration only; do not regenerate it here.
    (apple / 'project.yml').unlink(missing_ok=True)
    state_path.write_text(json.dumps({'identifier': identifier}, indent=2) + '\n')
    return dest / PROJECT.parent

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'run'])
    parser.add_argument('--team', help='Personal Team ID; otherwise read the team selected in the local Xcode project')
    args = parser.parse_args()
    app = Path(__file__).resolve().parents[1]
    dest = app / '.ios-personal'
    try:
        project = prepare(app, dest, args.team)
    except ValueError as error:
        parser.error(str(error))
    if args.action == 'prepare':
        print(f'Prepared {project}')
        print('Open this project in Xcode; select your name (Personal Team) under Signing & Capabilities.')
        print('Then run npm run ios:personal --prefix app')
        return
    team = selected_team(dest)
    env = os.environ.copy()
    if team:
        env['APPLE_DEVELOPMENT_TEAM'] = team
    else:
        env.pop('APPLE_DEVELOPMENT_TEAM', None)
    # Reuse compiled dependencies, but keep native project/signing changes isolated.
    env['CARGO_TARGET_DIR'] = str(app / 'src-tauri/target')
    # Prepare bundled frontend assets and the Tauri/Xcode build session, then let
    # Xcode sign and Run directly on the phone. No paid-team IPA export or live
    # Vite server is needed; keep this process running while building in Xcode.
    command = ['npm', 'run', 'tauri', '--', 'ios', 'build', '--debug', '--open']
    print('In Xcode, select your Personal Team and your iPhone, then press Run.', flush=True)
    raise SystemExit(subprocess.call(command, cwd=dest, env=env))

if __name__ == '__main__':
    main()
