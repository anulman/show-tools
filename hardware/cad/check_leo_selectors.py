"""Verify absent/invalid optional selectors without changing live selector files."""
import json
from pathlib import Path
import tempfile

import arcade_scene
import additional_controls


def main():
    checks = []
    with tempfile.TemporaryDirectory(prefix='leo-selector-check-') as directory:
        root = Path(directory)
        previous_leo, previous_here = arcade_scene.LEO_CONFIG, additional_controls.HERE
        try:
            arcade_scene.LEO_CONFIG = root / 'arcade.json'
            assert 'leo_ledge_revision' not in arcade_scene.load()[4]
            fixture = root / 'cad'
            (fixture / 'mushroom-mount').mkdir(parents=True)
            (fixture / 'mushroom-mount/scene.py').write_text('baseline = True\n')
            additional_controls.HERE = fixture
            assert additional_controls.module_for('mushroom-mount').baseline is True
            checks.append('Absent selectors retain baseline loading')
            marker = fixture / 'build/mushroom-leo/current.json'
            marker.parent.mkdir(parents=True)
            for kind in ('broken symlink', 'directory'):
                for path in (arcade_scene.LEO_CONFIG, marker):
                    if kind == 'broken symlink':
                        path.symlink_to(root / 'missing-target')
                    else:
                        path.mkdir()
                for load in (arcade_scene.load,
                             lambda: additional_controls.module_for('mushroom-mount')):
                    try:
                        load()
                    except ValueError as error:
                        assert 'selector must be a readable regular file' in str(error)
                    else:
                        raise AssertionError('Invalid '+kind+' selector fell back to baseline')
                for path in (arcade_scene.LEO_CONFIG, marker):
                    if kind == 'broken symlink':
                        path.unlink()
                    else:
                        path.rmdir()
                checks.append('Both consumers reject '+kind+' selectors')
        finally:
            arcade_scene.LEO_CONFIG = previous_leo
            additional_controls.HERE = previous_here
    assert arcade_scene.load()[4]['leo_ledge_revision']['geometry_checks_pass'] is True
    assert additional_controls.load('mushroom-mount')[4]['geometry_checks_pass'] is True
    checks.append('Restored checked Leo selections load')
    print(json.dumps(dict(result='PASS', checks=checks), indent=2))


if __name__ == '__main__':
    main()
