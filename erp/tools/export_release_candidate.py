"""Export the reviewed public files from one immutable Git commit, never from the worktree."""
import argparse
import json
import re
import subprocess
from io import BytesIO
from pathlib import Path, PurePosixPath

MANIFEST = "erp/tools/public-files.txt"
CONSTANTS = {"data/constants/density.yaml", "data/constants/sap_values.yaml", "data/constants/units.yaml"}
DENIED_DIRS = {"batches", "backups", "private", "node_modules", "dist", "output", ".git", ".nx", ".angular"}
DATABASE = re.compile(r"\.(?:sqlite3?|db)(?:[-.](?:wal|shm|journal))?(?:\.|$)", re.I)


def git(root, *args, data=None):
    return subprocess.run(["git", *args], cwd=root, input=data, capture_output=True, check=True).stdout


def safe_path(path):
    parts = PurePosixPath(path).parts
    lower = path.lower()
    return bool(parts) and all((
        re.fullmatch(r"[A-Za-z0-9_./-]+", path),
        not path.startswith("/"),
        "/".join(parts) == path,
        ".." not in parts,
        not any(p in DENIED_DIRS or p.startswith(".env") for p in lower.split("/")),
        not DATABASE.search(lower),
        not lower.endswith((".ipynb", ".zip", ".bak", ".pem", ".key", ".styles.generated.ts")),
        "backup-" not in parts[-1].lower(),
        not lower.startswith("data/") or path in CONSTANTS,
    ))


def workspace_document(value):
    if isinstance(value, list):
        return any(map(workspace_document, value))
    if not isinstance(value, dict):
        return False
    return (
        (value.get("app") == "red-mountain-soap-suite" and "workspace" in value)
        or ("version" in value and isinstance(value.get("inventory"), dict))
        or any(map(workspace_document, value.values()))
    )


def inspect_blob(path, blob):
    if blob.startswith((b"SQLite format 3\0", bytes.fromhex("377f0682"), bytes.fromhex("377f0683"))):
        raise ValueError(f"Database content in {path}")
    if path.endswith(".ico") and blob.startswith(b"\0\0\x01\0"):
        return
    # Normal portable backups are UTF-8; catch UTF-16/32 copies as well, regardless of suffix.
    if b"\0" in blob:
        raise ValueError(f"Unexpected binary content in {path}")
    text = blob.decode("utf-8-sig").lstrip()
    if path.endswith(".json") or text.startswith(("{", "[")):
        try:
            document = json.loads(text)
        except ValueError:
            if path.endswith(".json"):
                raise ValueError(f"Invalid JSON in {path}") from None
        else:
            if workspace_document(document):
                raise ValueError(f"Workspace/backup content in {path}")


def export(root, destination, ref="HEAD"):
    root = root.resolve()
    destination = destination.resolve()
    if destination.exists() or destination.is_relative_to(root):
        raise ValueError("Choose a new directory outside the checkout.")
    commit = git(root, "rev-parse", "--verify", "--end-of-options", ref + "^{commit}").decode().strip()
    items = git(root, "show", f"{commit}:{MANIFEST}").decode().splitlines()
    paths = [p for p in items if p and not p.startswith("#")]
    if not paths or len({p.casefold() for p in paths}) != len(paths) or not all(map(safe_path, paths)):
        raise ValueError("Unsafe, empty or duplicate public file list.")
    entries = {}
    for entry in git(root, "ls-tree", "-rz", commit, "--", "erp/").split(b"\0"):
        if entry:
            metadata, name = entry.split(b"\t", 1)
            entries[name.decode().removeprefix("erp/")] = metadata.split()
    ids = []
    for path in paths:
        mode, kind, oid = entries.get(path, (None, None, None))
        if mode not in (b"100644", b"100755") or kind != b"blob":
            raise ValueError(f"Missing or non-regular public file: {path}")
        ids.append(oid)
    # Inspect the exact bytes we will write, and reject the whole export before creating a directory.
    stream = BytesIO(git(root, "cat-file", "--batch", data=b"\n".join(ids) + b"\n"))
    blobs = []
    for path, oid in zip(paths, ids):
        actual, kind, size = stream.readline().split()
        blob = stream.read(int(size))
        if actual != oid or kind != b"blob" or len(blob) != int(size) or stream.read(1) != b"\n":
            raise ValueError("Incomplete Git object stream.")
        inspect_blob(path, blob)
        blobs.append(blob)
    destination.mkdir(parents=True)
    for path, blob in zip(paths, blobs):
        target = destination / "erp" / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(blob)
        if entries[path][0] == b"100755":
            target.chmod(0o755)
    return commit, len(paths)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--ref", default="HEAD", help="Commit or branch (default: HEAD).")
    args = parser.parse_args()
    try:
        commit, count = export(Path(__file__).resolve().parents[2], args.destination, args.ref)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Export refused: {error}\n")
    print(f"Exported {count} reviewed files from {commit} to {args.destination.resolve() / 'erp'}")


if __name__ == "__main__":
    main()
