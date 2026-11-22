import json
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]


def cli(*args):
    return subprocess.run(
        [sys.executable, str(ROOT / "engine/cli.py"), *map(str, args)],
        cwd=ROOT, capture_output=True, text=True,
    )


def test_cli_default_export_uses_only_demo_records():
    result = cli("export-history")
    assert result.returncode == 0, result.stderr
    document = json.loads(result.stdout)
    assert [row["id"] for row in document["base_recipes"]] == ["BSR-DEMO-001"]
    assert [row["id"] for row in document["receipts"]] == ["R-DEMO-001"]


def test_cli_requires_existing_absolute_complete_private_path(tmp_path):
    for directory in ("relative", tmp_path / "missing", tmp_path):
        result = cli("--data-dir", directory, "list-recipes")
        assert result.returncode == 2
        assert "--data-dir" in result.stderr
        assert "BSR-DEMO" not in result.stdout


def test_cli_uses_only_the_explicit_dataset(tmp_path):
    target = tmp_path / "test-yaml"
    shutil.copytree(ROOT / "demo-data", target)
    (target / "recipes").mkdir()
    for name in ("base_recipes", "product_recipes"):
        (target / f"{name}.yaml").rename(target / "recipes" / f"{name}.yaml")
    receipt_file = target / "receipts.yaml"
    receipt_file.write_text("receipts: []\n", encoding="utf-8")
    result = cli("--data-dir", target, "export-history")
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["receipts"] == []


def test_demo_accounting_leaves_shipped_fixtures_unchanged():
    fixture = ROOT / "demo-data/transactions.yaml"
    original = fixture.read_bytes()
    result = cli("account")
    assert result.returncode == 0, result.stderr
    scratch = Path(result.stdout.splitlines()[0].removeprefix("Demo scratch workspace: "))
    assert scratch != fixture.parent
    assert (scratch / fixture.name).read_bytes() != original
    assert fixture.read_bytes() == original
