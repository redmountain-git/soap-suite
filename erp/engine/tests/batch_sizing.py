import subprocess
import sys
from pathlib import Path

from engine.batch_sizing import (
    batch_volume_from_batch_id,
    cuboid_volume_in3,
    scale_recipe_for_mold_volume,
)


def _constants_bundle():
    return {
        "units": {"units": {"in3": {"to_ml": 16.387}}},
        "density": {
            "density": {
                "olive_oil": 0.91,
                "coconut_oil": 0.92,
                "naoh": 2.13,
                "distilled_water": 1.0,
                "fragrance_oil": 0.95,
            }
        },
        "sap_values": {
            "sap_values": {
                "naoh": {
                    "olive_oil": 0.134,
                    "coconut_oil": 0.183,
                }
            }
        },
    }


def test_cuboid_volume_in3():
    assert cuboid_volume_in3(10, 5, 3) == 150.0


def test_scale_recipe_for_mold_volume_by_recipe_id():
    base_recipes = [
        {
            "id": "BSR-001",
            "name": "Base A",
            "oils_pct": {"olive_oil": 70, "coconut_oil": 30},
            "lye": {"type": "NaOH", "default_superfat_pct": 6},
            "liquid": {"default_type": "distilled_water"},
        }
    ]
    product_recipes = [{"id": "PR-001", "name": "Product A", "base_recipe_id": "BSR-001", "fragrance": {"type": "fragrance_oil", "default_percent": 4}}]

    data = scale_recipe_for_mold_volume(
        volume_in3=100,
        recipe_id="PR-001",
        base_recipes=base_recipes,
        product_recipes=product_recipes,
        constants_bundle=_constants_bundle(),
        fragrance_pct=4,
    )

    assert data["base_recipe_id"] == "BSR-001"
    assert data["product_recipe_id"] == "PR-001"
    assert data["volume_in3"] == 100
    assert data["total_oils_g"] > 0
    assert data["batter_density"] > 0
    assert data["fragrance_oz"] > 0


def test_batch_volume_from_batch_id_and_total_oils():
    base_recipes = [
        {
            "id": "BSR-001",
            "name": "Base A",
            "oils_pct": {"olive_oil": 70, "coconut_oil": 30},
            "lye": {"type": "NaOH", "default_superfat_pct": 6},
            "liquid": {"default_type": "distilled_water"},
        }
    ]
    batch = {"id": "B-001", "base_recipe_id": "BSR-001"}

    result = batch_volume_from_batch_id(
        batch_id="B-001",
        total_oils_g=1200,
        fragrance_pct=4,
        batch=batch,
        base_recipes=base_recipes,
        product_recipes=[],
        constants_bundle=_constants_bundle(),
    )

    assert result["batch_id"] == "B-001"
    assert result["base_recipe_id"] == "BSR-001"
    assert result["total_oils_g"] == 1200.0
    assert result["volume_in3"] > 0
    assert result["volume_ml"] > 0
    assert result["fragrance_oz"] > 0


def test_cli_mold_volume_command():
    repo_root = Path(__file__).resolve().parents[2]
    cli_path = repo_root / "engine" / "cli.py"

    result = subprocess.run(
        [sys.executable, str(cli_path), "mold-volume", "10", "5", "3"],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert "volume_in3: 150.0" in result.stdout


def test_cli_batch_volume_command():
    repo_root = Path(__file__).resolve().parents[2]
    cli_path = repo_root / "engine" / "cli.py"

    result = subprocess.run(
        [sys.executable, str(cli_path), "batch-volume", "B-DEMO-001", "1200"],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert "batch_id: B-DEMO-001" in result.stdout
    assert "volume_in3:" in result.stdout
