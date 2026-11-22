"""Release boundary tests use invented records in a disposable Git repository."""
import json
import subprocess

import pytest

from tools.export_release_candidate import export, inspect_blob, safe_path


@pytest.mark.parametrize("path", [
    "apps/operations/public/test.sqlite-wal", "app/public/ledger.DB-SHM",
    "packages/local-store/example.sqlite3-journal", "demo-data/book.sqlite",
    "app/public/red-mountain-soap-operations-backup-2099-01-01.json",
    "data/receipts.yaml", "apps/operations/.env.local", "../escape", "C:/escape",
])
def test_unsafe_manifest_entry(path):
    assert not safe_path(path)


@pytest.mark.parametrize("blob", [
    b'\xef\xbb\xbf  {"workspace": {}, "app": "red-mountain-soap-suite"}',
    b'[{"payload":{"workspace":{"inventory":{},"version":2}}}]',
    b'SQLite format 3\0fictional', b'\x37\x7f\x06\x82fixture',
])
def test_disguised_operating_files(blob):
    with pytest.raises(ValueError):
        inspect_blob("app/public/sample.txt", blob)


def test_only_listed_commit_blobs_are_exported_and_invalid_export_creates_nothing(tmp_path):
    repo = tmp_path / "repo"
    tools = repo / "erp/tools"
    tools.mkdir(parents=True)

    def git(*args):
        return subprocess.check_output(
            ["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
             "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", *args], cwd=repo,
        )

    git("init", "-q")
    (tools / "public-files.txt").write_text("example.json\n", encoding="utf-8")
    example = repo / "erp/example.json"
    original = b'{"fictional":true}\n'
    example.write_bytes(original)
    (repo / "erp/renamed.json").write_text('{"private":true}', encoding="utf-8")
    git("add", "erp")
    git("commit", "-qm", "Example")
    checkpoint = git("rev-parse", "HEAD").decode().strip()
    example.write_text(json.dumps({"version": 2, "inventory": {}}), encoding="utf-8")
    git("add", "erp")
    out = tmp_path / "public"
    assert export(repo, out, checkpoint) == (checkpoint, 1)
    assert (out / "erp/example.json").read_bytes() == original
    assert not (out / "erp/renamed.json").exists()
    git("commit", "-qm", "Disguised backup")
    with pytest.raises(ValueError, match="Workspace/backup"):
        export(repo, tmp_path / "rejected")
    assert not (tmp_path / "rejected").exists()
    with pytest.raises(ValueError, match="new directory"):
        export(repo, out)
