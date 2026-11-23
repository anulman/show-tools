import hashlib
import importlib.util
import io
import json
import multiprocessing
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("stage_release", Path(__file__).resolve().parents[1] / "stage-session-release.py")
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)
SOURCE = "6e423dfe52bd87a58b2c9856e19068e12b5a8ff2"
NAME = "show-tools-session-release-" + SOURCE[:7]
LEAF = "session-" + SOURCE[:7]
ELF = b"\x7fELF\x02\x01" + bytes(12) + b"\x3e\x00"


def package(source=SOURCE, omit=None, schema=2, runtime=ELF):
    files = {path: b"fixture" for path in stage.REQUIRED}
    entries = []
    for identity in ("dance-yrself-clean", "drunk-girls", "i-can-change", "tribulations", "daft-punk", "all-i-want", "you-wanted-a-hit"):
        path = "songs/" + identity
        data = {"manifest.json": json.dumps({"id": identity}).encode(), "song.pfp": b"fixture packet", "effects.json": b"[]", "source.musicxml": b"<score-partwise/>"}
        hashes = {name: hashlib.sha256(value).hexdigest() for name, value in data.items()}
        package_identity = {"format": "show-tools-installed-song-v1", "files": [[name, hashes[name]] for name in ("manifest.json", "song.pfp", "effects.json")]}
        entries.append({"id": identity, "path": path, "title": identity, "files": hashes, "packageDigest": hashlib.sha256(json.dumps(package_identity, separators=(",", ":")).encode()).hexdigest()})
        files.update({"catalog/" + path + "/" + name: value for name, value in data.items()})
    files["catalog/catalog.json"] = json.dumps({"schemaVersion": 1, "initialSongId": "dance-yrself-clean", "entries": entries}).encode()
    files["licenses/NOTICE"] = b"fixture license"
    files["native/native_alsa_host"] = ELF
    files["runtime/node"] = runtime
    files["native/source-revision.txt"] = SOURCE.encode()
    sources = sorted(path.removeprefix("provenance/source/") for path in files if path.startswith("provenance/source/"))
    files["provenance/source.json"] = json.dumps({"schemaVersion": 1, "source": {"revision": source, "tree": "a" * 40}, "reviewed": {"revision": source, "tree": "a" * 40}, "native": {"revision": SOURCE}, "runtime": {"nodeExecutableSha256": hashlib.sha256(runtime).hexdigest()}, "nativeSourcesEquivalent": True, "files": sources}).encode()
    if omit:
        del files[omit]
    records = [{"path": path, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for path, data in sorted(files.items())]
    manifest = {"schemaVersion": schema, "sourceRevision": source, "nativeRevision": SOURCE, "platform": "linux-x64", "nodeVersion": "22.23.4", "files": records,
                "totalFileBytes": sum(len(data) for data in files.values())}
    files["release.json"] = json.dumps(manifest).encode()
    files["SHA256SUMS"] = "".join(hashlib.sha256(data).hexdigest() + "  " + path + "\n" for path, data in sorted(files.items())).encode()
    return files


def reseal(files):
    manifest = json.loads(files.pop("release.json"))
    files.pop("SHA256SUMS", None)
    records = [{"path": path, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for path, data in sorted(files.items())]
    manifest.update(files=records, totalFileBytes=sum(len(data) for data in files.values()))
    files["release.json"] = json.dumps(manifest).encode()
    files["SHA256SUMS"] = "".join(hashlib.sha256(data).hexdigest() + "  " + path + "\n" for path, data in sorted(files.items())).encode()
    return files


def peripheral_package():
    files = package()
    files.update({path: b"fixture" for path in stage.PERIPHERAL_REQUIRED})
    files["native/peripheral/peripheral-host"] = ELF
    files["native/peripheral/source-revision.txt"] = SOURCE.encode()
    files["native/peripheral/compiler.txt"] = b"Fixture compiler"
    files["native/peripheral/build.json"] = json.dumps({"schemaVersion": 1, "sourceRevision": SOURCE, "target": "x86_64-linux-musl",
        "compiler": "Fixture compiler", "flags": ["-std=c++17", "-static", "-O2", "-DNDEBUG"],
        "sourceFiles": {path: hashlib.sha256(files["provenance/source/" + path]).hexdigest() for path in stage.PERIPHERAL_INPUTS}}).encode()
    files["native/peripheral/SHA256SUMS"] = "".join(hashlib.sha256(files["native/peripheral/" + path]).hexdigest() + "  " + path + "\n" for path in sorted(stage.PERIPHERAL_ARTIFACT_FILES)).encode()
    provenance = json.loads(files["provenance/source.json"])
    provenance.update(peripheral={"revision": SOURCE}, peripheralSourcesEquivalent=True,
        files=sorted(path.removeprefix("provenance/source/") for path in files if path.startswith("provenance/source/")))
    files["provenance/source.json"] = json.dumps(provenance).encode()
    manifest = json.loads(files["release.json"])
    manifest["peripheralRevision"] = SOURCE
    files["release.json"] = json.dumps(manifest).encode()
    return reseal(files)


def archive(files=None, extra=()):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as tar:
        root = tarfile.TarInfo(NAME)
        root.type = tarfile.DIRTYPE
        root.mode = 0o755
        tar.addfile(root)
        for path, data in (files if files is not None else package()).items():
            member = tarfile.TarInfo(NAME + "/" + path)
            member.size = len(data)
            member.mode = 0o755 if path in {"runtime/node", "native/native_alsa_host", "bin/show-tools-session", "native/peripheral/peripheral-host", "bin/show-tools-peripheral"} else 0o644
            tar.addfile(member, io.BytesIO(data))
        for member in extra:
            tar.addfile(member)
    return output.getvalue()


def promote_worker(extracted, target, barrier, results):
    try:
        barrier.wait(5)
        results.put(stage.promote(Path(extracted), Path(target), SOURCE))
    except RuntimeError as error:
        results.put(str(error))


class StagingTests(unittest.TestCase):
    def test_compiler_dependencies_match_both_peripheral_source_manifests(self):
        root = Path(__file__).resolve().parents[2]
        sources = sorted(path for path in stage.PERIPHERAL_INPUTS if path.endswith('.cpp'))
        command = ['c++', '-std=c++17', '-static', '-O2', '-DNDEBUG',
                   '-Ilib/peripherals/include', '-Ilib/peripherals/host', '-Ilib/performance/include', '-MM']
        if sys.platform != 'linux':
            command.append('-MG')
        dependencies = subprocess.check_output(command + sources, cwd=root, text=True, timeout=30)
        project = set(re.findall(r'lib/(?:peripherals|performance)/[A-Za-z0-9_./-]+', dependencies.replace('\\\n', ' ')))
        self.assertEqual(project, stage.PERIPHERAL_INPUTS,
                         'Peripheral stage provenance omits compiled project dependencies')
        artifact = (root / 'scripts/peripheral-artifact.ts').read_text().split('export const PERIPHERAL_LICENSES')[0]
        declared = set(re.findall(r"'([^']+\.(?:h|cpp))'", artifact))
        self.assertEqual(project, declared,
                         'Peripheral artifact provenance omits compiled project dependencies')

    def setUp(self):
        pin = patch.object(stage, "NODE_SHA256", hashlib.sha256(ELF).hexdigest())
        pin.start()
        self.addCleanup(pin.stop)

    def execute(self, data, expected_hash=None, expected_source=SOURCE, twice=False, expanded=None):
        with tempfile.TemporaryDirectory(prefix="stage-test-") as directory:
            root = Path(directory).resolve()
            archive_path = root / "input.tar.gz"
            archive_path.write_bytes(data)
            digest = expected_hash or hashlib.sha256(data).hexdigest()
            with patch.object(stage, "MAX_EXPANDED", expanded or stage.MAX_EXPANDED):
                try:
                    result = stage.stage(archive_path, digest, len(data), expected_source, root)
                except Exception:
                    self.assertFalse((root / "releases" / LEAF).exists())
                    staging = root / "staging"
                    if staging.exists():
                        for attempt in staging.iterdir():
                            self.assertEqual(attempt.stat().st_mode & 0o777, 0o700)
                    raise
                target = root / "releases" / LEAF
                self.assertTrue((target / "release.json").is_file())
                self.assertEqual(target.stat().st_mode & 0o777, 0o700)
                self.assertEqual(result["status"], "staged-only")
                self.assertFalse(result["executablesStarted"])
                self.assertEqual(list((root / "staging").iterdir()), [])
                if twice:
                    before = (target / "release.json").stat().st_mtime_ns
                    repeated = stage.stage(archive_path, digest, len(data), expected_source, root)
                    self.assertEqual(repeated["status"], "already-staged")
                    self.assertEqual((target / "release.json").stat().st_mtime_ns, before)
                    self.assertEqual(list((root / "staging").iterdir()), [])

    def test_valid_staging_and_idempotent_retry(self):
        self.execute(archive(), twice=True)

    def test_all_bench_helpers_are_required_and_match_reviewed_source(self):
        for name in ("raw_keys.py", "publish_marker.py", "raw_motion.py"):
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                self.execute(archive(package(omit="bench/" + name)))
            files = package()
            files["bench/" + name] = b"changed helper"
            with self.subTest(changed=name), self.assertRaisesRegex(RuntimeError, "reviewed source"):
                self.execute(archive(reseal(files)))

    def test_catalog_identity_path_digest_and_exact_members_fail_closed(self):
        for mutation in ("duplicate", "escape", "missing-effects", "bad-digest", "extra"):
            files = package()
            catalog = json.loads(files["catalog/catalog.json"])
            if mutation == "duplicate":
                catalog["entries"][1] = catalog["entries"][0]
            elif mutation == "escape":
                catalog["entries"][0]["path"] = "../outside"
            elif mutation == "missing-effects":
                del files["catalog/songs/drunk-girls/effects.json"]
            elif mutation == "bad-digest":
                catalog["entries"][0]["packageDigest"] = "0" * 64
            else:
                files["catalog/extra"] = b"unexpected"
            files["catalog/catalog.json"] = json.dumps(catalog).encode()
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                self.execute(archive(reseal(files)))

    def test_peripheral_staging_is_data_only_and_idempotent(self):
        self.execute(archive(peripheral_package()), twice=True)

    def test_partial_peripheral_or_foreign_executable_is_rejected(self):
        for path in ["bin/show-tools-peripheral", "native/peripheral/peripheral-host"]:
            with self.subTest(path=path):
                files = peripheral_package()
                del files[path]
                with self.assertRaisesRegex(RuntimeError, "Required peripheral release layout"):
                    self.execute(archive(reseal(files)))
        files = peripheral_package()
        files["native/peripheral/peripheral-host"] = bytes(20)
        with self.assertRaisesRegex(RuntimeError, "Linux x86-64 executable"):
            self.execute(archive(reseal(files)))

    def test_peripheral_provenance_and_inner_checksums_are_verified(self):
        for scenario, message in [("revision", "Peripheral build provenance"), ("manifest-revision", "Peripheral source provenance"),
                                  ("inputs", "Peripheral compiled source input"), ("input-map-header", "Peripheral compiled source input"),
                                  ("input-hash", "Peripheral compiled source input"),
                                  ("checksum", "Peripheral artifact checksum")]:
            with self.subTest(scenario=scenario):
                files = peripheral_package()
                build = json.loads(files["native/peripheral/build.json"])
                if scenario == "revision":
                    build["sourceRevision"] = "0" * 40
                elif scenario == "manifest-revision":
                    manifest = json.loads(files["release.json"])
                    manifest["peripheralRevision"] = "0" * 40
                    files["release.json"] = json.dumps(manifest).encode()
                elif scenario == "inputs":
                    build["sourceFiles"].pop(next(iter(build["sourceFiles"])))
                elif scenario == "input-map-header":
                    build["sourceFiles"].pop("lib/peripherals/host/linux_input_map.h")
                elif scenario == "input-hash":
                    build["sourceFiles"][next(iter(build["sourceFiles"]))] = "0" * 64
                else:
                    files["native/peripheral/SHA256SUMS"] = files["native/peripheral/SHA256SUMS"].replace(b"  peripheral-host", b"  wrong-name")
                files["native/peripheral/build.json"] = json.dumps(build).encode()
                with self.assertRaisesRegex(RuntimeError, message):
                    self.execute(archive(reseal(files)))

    def test_source_and_schema_rejected_before_promotion(self):
        for files in [package(source="0" * 40), package(schema=1)]:
            with self.subTest(), self.assertRaisesRegex(RuntimeError, "schema or expected source"):
                self.execute(archive(files))

    def test_required_layout(self):
        with self.assertRaisesRegex(RuntimeError, "Required release layout"):
            self.execute(archive(package(omit="gateway/prepare.mjs")))

    def test_unsafe_and_noncanonical_paths(self):
        for name in [NAME + "/../escaped", "/escaped", NAME + "/./alias", NAME + "//alias", NAME + "//"]:
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                self.execute(archive(extra=[tarfile.TarInfo(name)]))

    def test_links_special_files_and_duplicates(self):
        link = tarfile.TarInfo(NAME + "/link")
        link.type, link.linkname = tarfile.SYMTYPE, "/etc/passwd"
        fifo = tarfile.TarInfo(NAME + "/fifo")
        fifo.type = tarfile.FIFOTYPE
        duplicate = tarfile.TarInfo(NAME + "/runtime/node")
        for member in (link, fifo, duplicate):
            with self.subTest(), self.assertRaises(RuntimeError):
                self.execute(archive(extra=[member]))

    def test_file_directory_conflict(self):
        for path in ("catalog", "catalog/catalog.json/child"):
            with self.subTest(path=path), self.assertRaisesRegex(RuntimeError, "file/directory conflict"):
                self.execute(archive(extra=[tarfile.TarInfo(NAME + "/" + path)]))

    def test_digest_mismatch(self):
        with self.assertRaisesRegex(RuntimeError, "SHA256 mismatch"):
            self.execute(archive(), "0" * 64)

    def test_metadata_bounds(self):
        files = package()
        files["release.json"] = b" " * (stage.MAX_JSON + 1)
        with self.assertRaisesRegex(RuntimeError, "oversized metadata"):
            self.execute(archive(files))
        files = package()
        files["SHA256SUMS"] = b" " * (stage.MAX_CHECKSUMS + 1)
        with self.assertRaisesRegex(RuntimeError, "oversized metadata"):
            self.execute(archive(files))

    def test_expanded_and_member_bounds(self):
        with self.assertRaisesRegex(RuntimeError, "Expanded archive exceeds"):
            self.execute(archive(), expanded=1024)
        members = [tarfile.TarInfo(NAME + f"/empty{i}") for i in range(stage.MAX_MEMBERS)]
        with self.assertRaisesRegex(RuntimeError, "member count"):
            self.execute(archive(extra=members))

    def test_checksum_canonical_and_unlisted_files(self):
        files = package()
        files["SHA256SUMS"] += hashlib.sha256(b"fixture").hexdigest().encode() + b"  gateway/./server.mjs\n"
        with self.assertRaisesRegex(RuntimeError, "Noncanonical"):
            self.execute(archive(files))
        with self.assertRaisesRegex(RuntimeError, "unlisted or missing"):
            self.execute(archive(extra=[tarfile.TarInfo(NAME + "/unlisted")]))

    def test_member_hash_and_checksum_set(self):
        files = package()
        files["gateway/server.mjs"] = b"tampered"
        with self.assertRaisesRegex(RuntimeError, "mismatch"):
            self.execute(archive(files))
        files = package()
        files["SHA256SUMS"] += files["SHA256SUMS"].splitlines(keepends=True)[0]
        with self.assertRaisesRegex(RuntimeError, "Duplicate checksum"):
            self.execute(archive(files))

    def test_pax_path_sparse_and_mode_overrides(self):
        for metadata in ({"path": NAME + "/../escaped"}, {"GNU.sparse.map": "0,1"}):
            member = tarfile.TarInfo(NAME + "/extra")
            member.pax_headers = metadata
            with self.subTest(metadata=metadata), self.assertRaises(RuntimeError):
                self.execute(archive(extra=[member]))
        member = tarfile.TarInfo(NAME + "/setuid")
        member.mode = 0o4755
        with self.assertRaisesRegex(RuntimeError, "Unsafe archive"):
            self.execute(archive(extra=[member]))

    def test_source_packet_required_and_executables_not_executed(self):
        with self.assertRaisesRegex(RuntimeError, "Required release layout"):
            self.execute(archive(package(omit="provenance/source/lib/remote-performance/controller.ts")))
        files = package()
        files["runtime/node"] = b"#!/bin/sh\ntouch SHOULD_NEVER_EXIST\n"
        with self.assertRaisesRegex(RuntimeError, "Linux x86-64"):
            self.execute(archive(files))

    def test_pinned_node_hash_rejects_rehashed_replacement(self):
        with self.assertRaisesRegex(RuntimeError, "Pinned Node executable mismatch"):
            self.execute(archive(package(runtime=ELF + b"replacement")))

    def test_rejects_changed_existing_release_without_overwriting(self):
        with tempfile.TemporaryDirectory(prefix="stage-test-") as directory:
            root = Path(directory).resolve()
            data = archive()
            source = root / "input.tar.gz"
            source.write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            stage.stage(source, digest, len(data), SOURCE, root)
            installed = root / "releases" / LEAF / "gateway/server.mjs"
            installed.write_bytes(b"changed")
            with self.assertRaisesRegex(RuntimeError, "mismatch"):
                stage.stage(source, digest, len(data), SOURCE, root)
            self.assertEqual(installed.read_bytes(), b"changed")

    def test_rejects_alias_or_public_target_root(self):
        with tempfile.TemporaryDirectory(prefix="stage-test-") as directory:
            root = Path(directory).resolve()
            alias = root / "alias"
            alias.symlink_to(root)
            data = archive()
            source = root / "input.tar.gz"
            source.write_bytes(data)
            for target in (alias, Path("relative")):
                with self.subTest(target=str(target)), self.assertRaisesRegex(RuntimeError, "canonical absolute"):
                    stage.stage(source, hashlib.sha256(data).hexdigest(), len(data), SOURCE, target)
            root.chmod(0o755)
            with self.assertRaisesRegex(RuntimeError, "private caller-owned"):
                stage.stage(source, hashlib.sha256(data).hexdigest(), len(data), SOURCE, root)

    def test_rejects_special_and_symlink_archive_without_opening(self):
        with tempfile.TemporaryDirectory(prefix="stage-test-") as directory:
            root = Path(directory).resolve()
            special = root / "archive.fifo"
            os.mkfifo(special)
            alias = root / "archive.symlink"
            alias.symlink_to(special)
            for path in (special, alias):
                with self.subTest(path=str(path)), self.assertRaisesRegex(RuntimeError, "regular file without symlinks"):
                    stage.stage(path, "a" * 64, 1, SOURCE, root)

    def test_rejects_symlink_release_target_and_lock(self):
        for name in (LEAF, ".stage.lock"):
            with self.subTest(name=name), tempfile.TemporaryDirectory(prefix="stage-test-") as directory:
                root = Path(directory).resolve()
                (root / "releases").mkdir(mode=0o700)
                (root / "releases" / name).symlink_to(root)
                data = archive()
                source = root / "input.tar.gz"
                source.write_bytes(data)
                with self.assertRaises(RuntimeError):
                    stage.stage(source, hashlib.sha256(data).hexdigest(), len(data), SOURCE, root)
                self.assertTrue((root / "releases" / name).is_symlink())

    def test_concurrent_identical_promotion(self):
        with tempfile.TemporaryDirectory(prefix="promotion-test-") as directory:
            root = Path(directory).resolve()
            releases = root / "releases"
            releases.mkdir(mode=0o700)
            candidates = []
            data = archive()
            for index in range(2):
                candidate = root / f"candidate{index}"
                candidate.mkdir(mode=0o700)
                tar_path = candidate / "release.tar"
                archive_path = candidate / "release.tar.gz"
                archive_path.write_bytes(data)
                stage.expand_archive(archive_path, tar_path)
                candidates.append(stage.extract_archive(tar_path, candidate, NAME))
            context = multiprocessing.get_context("fork")
            barrier, results = context.Barrier(2), context.Queue()
            target = releases / LEAF
            processes = [context.Process(target=promote_worker, args=(str(candidate), str(target), barrier, results)) for candidate in candidates]
            for process in processes:
                process.start()
            for process in processes:
                process.join(5)
                self.assertFalse(process.is_alive())
                self.assertEqual(process.exitcode, 0)
            self.assertEqual(sorted(results.get(timeout=1) for _ in processes), ["already-staged", "staged-only"])
            stage.validate_release(target, SOURCE)
            self.assertEqual(sum(candidate.exists() for candidate in candidates), 1)

    def test_anchored_writer_suite(self):
        result = subprocess.run([sys.executable, "-I", str(Path(__file__).with_name("stage-session-release-anchored.test.py"))],
                                capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_fixed_admission_runner_suite(self):
        path = Path(__file__).with_name('stage-session-release-admission.test.py')
        result = subprocess.run([sys.executable, '-I', '-B', str(path)], capture_output=True, text=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
