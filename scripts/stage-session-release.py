import argparse
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tarfile
import tempfile

MAX_EXPANDED = 256 * 1024 * 1024
MAX_MEMBERS = 2048
MAX_JSON = 1024 * 1024
MAX_CHECKSUMS = 128 * 1024
CHUNK = 1024 * 1024
NODE_SHA256 = "94efd062ed066c1a0b332e18249859c905e920eeada5df55d24c99b919629a90"
REQUIRED = {
    "native/native_alsa_host", "runtime/node", "gateway/server.mjs",
    "gateway/prepare.mjs", "gateway/session-cli.mjs", "bin/show-tools-session",
    "static/ui/practice/index.html",
    "catalog/catalog.json",
    "provenance/source.json", "provenance/package-lock.json",
    "provenance/source/lib/remote-performance/controller.ts",
    "provenance/source/lib/remote-performance/session-service.ts",
    "provenance/source/lib/remote-performance/session-cli.ts",
    "provenance/source/lib/native-host/service.cpp",
    "provenance/source/lib/native-alsa/alsa_pcm.cpp",
    "native/source-revision.txt", "native/compiler.txt", "native/packages.txt",
    "native/runtime-dependencies.txt", "runtime/NODE-LICENSE",
}
PERIPHERAL_INPUTS = {
    "lib/peripherals/host/linux_host.cpp", "lib/peripherals/host/linux_runtime.cpp",
    "lib/peripherals/host/linux_runtime.h", "lib/peripherals/host/linux_order.h",
    "lib/peripherals/host/linux_input_map.h",
    "lib/peripherals/host/control_stream.cpp", "lib/peripherals/host/control_stream.h",
    "lib/peripherals/src/peripheral_controls.cpp", "lib/peripherals/src/peripheral_lights.cpp",
    "lib/peripherals/src/peripheral_light_delivery.cpp", "lib/peripherals/include/peripheral_controls.h",
    "lib/peripherals/include/peripheral_light_delivery.h", "lib/peripherals/include/peripheral_lights.h",
    "lib/performance/include/performance_light_output.h",
}
PERIPHERAL_ARTIFACT_FILES = {"peripheral-host", "source-revision.txt", "compiler.txt", "build.json",
    "ZIG-LICENSE", "MUSL-COPYRIGHT", "LIBCXX-LICENSE", "LIBCXXABI-LICENSE", "LIBUNWIND-LICENSE"}
PERIPHERAL_REQUIRED = {"native/peripheral/" + path for path in PERIPHERAL_ARTIFACT_FILES | {"SHA256SUMS"}} | {
    "gateway/peripheral-cli.mjs", "provenance/peripheral-cli.mjs.inputs.json", "bin/show-tools-peripheral",
    "provenance/source/scripts/peripheral-cli.ts", "provenance/source/scripts/peripheral-artifact.ts",
    "provenance/source/scripts/build-peripheral-artifact.ts",
} | {"provenance/source/" + path for path in PERIPHERAL_INPUTS}


def validate_peripheral(extracted, manifest, provenance, files):
    build = read_json(extracted / "native/peripheral/build.json")
    revision = small_bytes(extracted / "native/peripheral/source-revision.txt", 128).decode().strip()
    identity = provenance.get("peripheral")
    if not re.fullmatch(r"[a-f0-9]{40}", revision) or revision != manifest.get("peripheralRevision") or not isinstance(identity, dict) or identity.get("revision") != revision or provenance.get("peripheralSourcesEquivalent") is not True:
        raise RuntimeError("Peripheral source provenance mismatch")
    if not isinstance(build, dict) or type(build.get("schemaVersion")) is not int or build["schemaVersion"] != 1 or build.get("sourceRevision") != revision or build.get("target") != "x86_64-linux-musl":
        raise RuntimeError("Peripheral build provenance mismatch")
    if not isinstance(build.get("compiler"), str) or not build["compiler"] or small_bytes(extracted / "native/peripheral/compiler.txt", MAX_JSON).decode().strip() != build["compiler"] or build.get("flags") != ["-std=c++17", "-static", "-O2", "-DNDEBUG"]:
        raise RuntimeError("Peripheral compiler provenance mismatch")
    inputs = build.get("sourceFiles")
    if not isinstance(inputs, dict) or inputs.keys() != PERIPHERAL_INPUTS or any(inputs[path] != files["provenance/source/" + path][1] for path in inputs):
        raise RuntimeError("Peripheral compiled source input mismatch")
    sums = {}
    for line in small_bytes(extracted / "native/peripheral/SHA256SUMS", MAX_CHECKSUMS).decode().splitlines():
        match = re.fullmatch(r"([a-f0-9]{64})  ([A-Za-z0-9_.-]+)", line)
        if not match or match[2] in sums:
            raise RuntimeError("Invalid peripheral checksum list")
        sums[match[2]] = match[1]
    if sums.keys() != PERIPHERAL_ARTIFACT_FILES or any(sums[path] != files["native/peripheral/" + path][1] for path in sums):
        raise RuntimeError("Peripheral artifact checksum mismatch")


def private_directory(path, create=True):
    if create and not path.exists() and not path.is_symlink():
        path.mkdir(mode=0o700)
    info = path.lstat()
    if path.is_symlink() or not path.is_dir() or info.st_uid != os.getuid() or info.st_mode & 0o7077:
        raise RuntimeError(f"Not a private caller-owned directory: {path}")


def canonical(path):
    if not path or any(part in ("", ".", "..") for part in path.split("/")) or re.search(r"[\x00-\x1f\x7f\\]", path):
        raise RuntimeError("Noncanonical archive or manifest path")
    return path


def small_bytes(path, limit):
    if not path.is_file() or path.stat().st_size > limit:
        raise RuntimeError(f"Missing or oversized metadata: {path.name}")
    with path.open("rb") as source:
        data = source.read(limit + 1)
    if len(data) > limit:
        raise RuntimeError(f"Oversized metadata: {path.name}")
    return data


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RuntimeError("Duplicate JSON key")
        result[key] = value
    return result


def read_json(path):
    return json.loads(small_bytes(path, MAX_JSON), object_pairs_hook=unique_object,
                      parse_constant=lambda value: (_ for _ in ()).throw(RuntimeError("Nonfinite JSON value")))


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def expand_archive(archive_path, tar_path):
    expanded = 0
    with gzip.open(archive_path, "rb") as source, tar_path.open("xb") as output:
        while chunk := source.read(min(CHUNK, MAX_EXPANDED - expanded + 1)):
            expanded += len(chunk)
            if expanded > MAX_EXPANDED:
                raise RuntimeError("Expanded archive exceeds bound, including headers")
            output.write(chunk)
    return expanded


def inspect_headers(tar_path):
    count = 0
    size = tar_path.stat().st_size
    allowed = {tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE,
               tarfile.XHDTYPE, tarfile.XGLTYPE}
    with tar_path.open("rb") as source:
        while True:
            block = source.read(512)
            if not block or block == bytes(512):
                if block and any(source.read(CHUNK)):
                    raise RuntimeError("Unexpected data after tar end")
                while chunk := source.read(CHUNK):
                    if any(chunk):
                        raise RuntimeError("Unexpected data after tar end")
                return
            if len(block) != 512:
                raise RuntimeError("Truncated tar header")
            member = tarfile.TarInfo.frombuf(block, "utf-8", "surrogateescape")
            count += 1
            if count > MAX_MEMBERS or member.size < 0 or member.type not in allowed:
                raise RuntimeError("Unsupported archive type or member count")
            if member.type in {tarfile.XHDTYPE, tarfile.XGLTYPE} and member.size > MAX_JSON:
                raise RuntimeError("Oversized tar metadata")
            if member.isfile() or member.isdir():
                raw_name = block[:100].split(b"\0", 1)[0].decode("utf-8", "surrogateescape")
                canonical(raw_name[:-1] if member.isdir() and raw_name.endswith("/") else raw_name)
            end = source.tell() + ((member.size + 511) // 512) * 512
            if end > size:
                raise RuntimeError("Truncated tar member")
            source.seek(end)


def extract_archive(tar_path, staging, name):
    entries = {}
    total_bytes = 0
    with tarfile.open(tar_path, "r|") as archive:
        for member in archive:
            total_bytes += member.size
            if member.size < 0 or total_bytes > MAX_EXPANDED or member.sparse is not None or any(key.startswith("GNU.sparse") for key in member.pax_headers):
                raise RuntimeError("Sparse or oversized archive member")
            if "path" in member.pax_headers:
                pax_path = member.pax_headers["path"]
                canonical(pax_path[:-1] if member.isdir() and pax_path.endswith("/") else pax_path)
            path = canonical(member.name)
            if path.split("/")[0] != name or not (member.isfile() or member.isdir()) or member.mode & 0o7000:
                raise RuntimeError("Unsafe archive member")
            if path in entries or any(path.startswith(previous + "/") and not directory for previous, directory in entries.items()):
                raise RuntimeError("Duplicate archive member or file/directory conflict")
            if member.isfile() and any(previous.startswith(path + "/") for previous in entries):
                raise RuntimeError("Archive file/directory conflict")
            entries[path] = member.isdir()
            destination = staging / path
            if member.isdir():
                destination.mkdir(mode=0o700, parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                stream = archive.extractfile(member)
                if stream is None:
                    raise RuntimeError("Unreadable archive file")
                received = 0
                with stream, destination.open("xb") as output:
                    while chunk := stream.read(CHUNK):
                        received += len(chunk)
                        if received > member.size:
                            raise RuntimeError("Archive member exceeds declared size")
                        output.write(chunk)
                if received != member.size:
                    raise RuntimeError("Truncated archive file")
                destination.chmod(0o600 | (member.mode & 0o100))
    return staging / name


def inspect_release_tree(extracted):
    private_directory(extracted, create=False)
    files = set()
    for directory, subdirectories, names in os.walk(extracted, followlinks=False):
        for name in subdirectories:
            private_directory(Path(directory) / name, create=False)
        for name in names:
            path = Path(directory) / name
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or info.st_mode & 0o7077:
                raise RuntimeError("Release contains a link, special file, or nonprivate member")
            files.add(str(path.relative_to(extracted)))
    return files



def validate_catalog(extracted, files):
    catalog = read_json(extracted / "catalog/catalog.json")
    if not isinstance(catalog, dict) or set(catalog) != {"schemaVersion", "initialSongId", "entries"} or type(catalog.get("schemaVersion")) is not int or catalog["schemaVersion"] != 1:
        raise RuntimeError("Invalid song catalog schema")
    entries = catalog.get("entries")
    if not isinstance(entries, list) or len(entries) != 3:
        raise RuntimeError("Release requires three song catalog entries")
    ids, required = set(), {"catalog/catalog.json"}
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"id", "path", "title", "packageDigest", "files"}:
            raise RuntimeError("Invalid catalog entry")
        identity = entry.get("id")
        if not isinstance(identity, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", identity) or identity in ids or entry.get("path") != "songs/" + identity or not isinstance(entry.get("title"), str):
            raise RuntimeError("Duplicate song identity or unsafe catalog path")
        ids.add(identity)
        hashes = entry.get("files")
        if not isinstance(hashes, dict) or set(hashes) != {"manifest.json", "song.pfp", "effects.json", "source.musicxml"}:
            raise RuntimeError("Invalid catalog file set")
        for name, digest in hashes.items():
            path = "catalog/" + entry["path"] + "/" + name
            required.add(path)
            if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest) or path not in files or files[path][1] != digest:
                raise RuntimeError("Catalog checksum mismatch")
        package = {"format": "show-tools-installed-song-v1", "files": [[name, hashes[name]] for name in ("manifest.json", "song.pfp", "effects.json")]}
        digest = hashlib.sha256(json.dumps(package, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        if entry["packageDigest"] != digest:
            raise RuntimeError("Catalog package digest mismatch")
        manifest = read_json(extracted / ("catalog/" + entry["path"] + "/manifest.json"))
        effects = read_json(extracted / ("catalog/" + entry["path"] + "/effects.json"))
        if not isinstance(manifest, dict) or manifest.get("id") != identity or not isinstance(effects, list):
            raise RuntimeError("Invalid catalog song JSON identity")
    if ids != {"dance-yrself-clean", "drunk-girls", "tribulations"} or catalog["initialSongId"] not in ids:
        raise RuntimeError("Invalid release song set or initial song")
    if {path for path in files if path.startswith("catalog/")} != required:
        raise RuntimeError("Unexpected catalog members")


def validate_release(extracted, expected_source):
    actual = inspect_release_tree(extracted)
    manifest = read_json(extracted / "release.json")
    if not isinstance(manifest, dict) or type(manifest.get("schemaVersion")) is not int or manifest["schemaVersion"] != 2 or manifest.get("sourceRevision") != expected_source:
        raise RuntimeError("Release schema or expected source mismatch")
    records = manifest.get("files")
    if not isinstance(records, list) or not records or len(records) > MAX_MEMBERS:
        raise RuntimeError("Invalid release file manifest")
    files = {}
    for record in records:
        if not isinstance(record, dict) or not isinstance(record.get("path"), str):
            raise RuntimeError("Invalid release file record")
        path = canonical(record["path"])
        count, digest = record.get("bytes"), record.get("sha256")
        if path in files or path in {"release.json", "SHA256SUMS"} or type(count) is not int or not 0 <= count <= MAX_EXPANDED or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise RuntimeError("Invalid or duplicate release file record")
        files[path] = (count, digest)
    if type(manifest.get("totalFileBytes")) is not int or manifest["totalFileBytes"] != sum(count for count, _ in files.values()):
        raise RuntimeError("Release file byte count mismatch")
    if not REQUIRED <= files.keys() or not (extracted / "licenses").is_dir():
        raise RuntimeError("Required release layout is missing")
    peripheral = "peripheralRevision" in manifest or any(path.startswith("native/peripheral/") or path in {"gateway/peripheral-cli.mjs", "bin/show-tools-peripheral"} for path in files)
    if peripheral and not PERIPHERAL_REQUIRED <= files.keys():
        raise RuntimeError("Required peripheral release layout is missing")
    executables = ["native/native_alsa_host", "runtime/node", "bin/show-tools-session"]
    if peripheral:
        executables += ["native/peripheral/peripheral-host", "bin/show-tools-peripheral"]
    for path in executables:
        if not (extracted / path).stat().st_mode & 0o100:
            raise RuntimeError("Required release executable is not executable")
    if manifest.get("platform") != "linux-x64" or manifest.get("nodeVersion") != "22.23.4":
        raise RuntimeError("Unexpected release platform or Node version")
    for path in ["native/native_alsa_host", "runtime/node"] + (["native/peripheral/peripheral-host"] if peripheral else []):
        with (extracted / path).open("rb") as executable:
            header = executable.read(20)
        if len(header) != 20 or header[:6] != b"\x7fELF\x02\x01" or header[18:20] != b"\x3e\x00":
            raise RuntimeError("Expected a Linux x86-64 executable")
    validate_catalog(extracted, files)
    checksums = {}
    for line in small_bytes(extracted / "SHA256SUMS", MAX_CHECKSUMS).decode("utf-8").splitlines():
        match = re.fullmatch(r"([a-f0-9]{64})  (.+)", line)
        if not match:
            raise RuntimeError("Invalid checksum manifest")
        digest, path = match.groups()
        canonical(path)
        if path in checksums:
            raise RuntimeError("Duplicate checksum path")
        checksums[path] = digest
    if checksums.keys() != files.keys() | {"release.json"}:
        raise RuntimeError("Checksum and release manifests differ")
    if actual != checksums.keys() | {"SHA256SUMS"}:
        raise RuntimeError("Release has unlisted or missing files")
    for path, digest in checksums.items():
        target = extracted / path
        if path in files and (target.stat().st_size, digest) != files[path]:
            raise RuntimeError(f"Release file metadata mismatch: {path}")
        if file_hash(target) != digest:
            raise RuntimeError(f"Release file mismatch: {path}")
    provenance = read_json(extracted / "provenance/source.json")
    if not isinstance(provenance, dict):
        raise RuntimeError("Invalid source review provenance")
    source = provenance.get("source", {})
    reviewed = provenance.get("reviewed", {})
    if provenance.get("schemaVersion") != 1 or source.get("revision") != expected_source or not re.fullmatch(r"[a-f0-9]{40}", source.get("tree", "")) or source.get("tree") != reviewed.get("tree"):
        raise RuntimeError("Source review provenance mismatch")
    if provenance.get("nativeSourcesEquivalent") is not True or provenance.get("native", {}).get("revision") != manifest.get("nativeRevision") or small_bytes(extracted / "native/source-revision.txt", 128).decode().strip() != manifest.get("nativeRevision"):
        raise RuntimeError("Native source provenance mismatch")
    if files["runtime/node"][1] != NODE_SHA256 or provenance.get("runtime", {}).get("nodeExecutableSha256") != NODE_SHA256:
        raise RuntimeError("Pinned Node executable mismatch")
    sources = provenance.get("files")
    if not isinstance(sources, list) or len(sources) != len(set(sources)) or set(sources) != {path.removeprefix("provenance/source/") for path in files if path.startswith("provenance/source/")}:
        raise RuntimeError("Source review file set mismatch")
    if peripheral:
        validate_peripheral(extracted, manifest, provenance, files)
    elif "peripheral" in provenance or "peripheralSourcesEquivalent" in provenance:
        raise RuntimeError("Peripheral provenance has no release component")
    return manifest


def promote(extracted, target, source):
    fd = os.open(target.parent / ".stage.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "r+") as lock:
        info = os.fstat(lock.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or info.st_mode & 0o7077:
            raise RuntimeError("Invalid promotion lock ownership or mode")
        fcntl.flock(lock, fcntl.LOCK_EX)
        if target.is_symlink():
            raise RuntimeError("Refusing a symlink release target")
        if target.exists():
            validate_release(target, source)
            if small_bytes(target / "release.json", MAX_JSON) != small_bytes(extracted / "release.json", MAX_JSON):
                raise RuntimeError("Existing release differs; refusing to overwrite")
            return "already-staged"
        extracted.rename(target)
        return "staged-only"


def copy_reviewed_archive(source, destination, expected_hash, expected_bytes):
    if not stat.S_ISREG(source.lstat().st_mode):
        raise RuntimeError("Archive must be a regular file without symlinks")
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as incoming, destination.open("xb") as output:
        info = os.fstat(incoming.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size != expected_bytes:
            raise RuntimeError("Archive is not a regular file of the reviewed size")
        digest = hashlib.sha256()
        received = 0
        while chunk := incoming.read(min(CHUNK, expected_bytes - received + 1)):
            received += len(chunk)
            if received > expected_bytes:
                raise RuntimeError("Archive exceeded reviewed size")
            digest.update(chunk)
            output.write(chunk)
        if received != expected_bytes or digest.hexdigest() != expected_hash:
            raise RuntimeError("Archive size or reviewed SHA256 mismatch")


def stage(archive, expected_hash, expected_bytes, source, root):
    if not re.fullmatch(r"[a-f0-9]{64}", expected_hash) or not re.fullmatch(r"[a-f0-9]{40}", source):
        raise RuntimeError("Invalid reviewed release identity")
    if type(expected_bytes) is not int or not 0 < expected_bytes < 100 * 1024 * 1024:
        raise RuntimeError("Archive exceeds reviewed bound")
    if not root.is_absolute() or root.resolve(strict=True) != root:
        raise RuntimeError("Target root must be an existing canonical absolute path")
    private_directory(root, create=False)
    os.umask(0o077)
    for child in ("staging", "releases"):
        private_directory(root / child)
    name = "show-tools-session-release-" + source[:7]
    target = root / "releases" / ("session-" + source[:7])
    staging = Path(tempfile.mkdtemp(prefix="session-" + source[:7] + "-", dir=root / "staging"))
    try:
        archive_path = staging / "release.tar.gz"
        copy_reviewed_archive(archive, archive_path, expected_hash, expected_bytes)
        tar_path = staging / "release.tar"
        expand_archive(archive_path, tar_path)
        inspect_headers(tar_path)
        extracted = extract_archive(tar_path, staging, name)
        manifest = validate_release(extracted, source)
        status = promote(extracted, target, source)
        shutil.rmtree(staging)
    except Exception as error:
        raise RuntimeError(f"Staging aborted; private attempt retained at {staging}: {error}") from error
    return {"status": status, "release": str(target), "source": manifest["sourceRevision"],
            "archiveSha256": expected_hash, "archiveBytes": expected_bytes, "executablesStarted": False}


def main():
    parser = argparse.ArgumentParser(description="Verify and stage a reviewed local Show Tools archive. Never executes release code.")
    parser.add_argument("archive", type=Path)
    parser.add_argument("sha256")
    parser.add_argument("bytes", type=int)
    parser.add_argument("source")
    parser.add_argument("target_root", type=Path)
    args = parser.parse_args()
    print(json.dumps(stage(args.archive, args.sha256, args.bytes, args.source, args.target_root)))


if __name__ == "__main__":
    main()
