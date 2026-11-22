import yaml
import subprocess
import sys
import shutil
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from engine.batch_generator import (
    add_cost_metrics,
    calculate_batch,
    calculate_batch_from_data,
    write_prep_file,
)


def _constants_bundle():
    return {
        "units": {
            "units": {
                "in3": {"to_ml": 16.387},
            }
        },
        "density": {
            "density": {
                "olive_oil": 0.91,
                "coconut_oil": 0.92,
                "naoh": 2.13,
                "distilled_water": 1.00,
                "fragrance_oil": 0.95,
            }
        },
        "sap_values": {
            "sap_values": {
                "olive_oil": 0.134,
                "coconut_oil": 0.183,
            }
        },
    }


@contextmanager
def _workspace_tempdir():
    repo_root = Path(__file__).resolve().parents[2]
    base_dir = repo_root / "tmp_test_runs"
    base_dir.mkdir(exist_ok=True)
    target = base_dir / f"batch-calc-{uuid4().hex}"
    target.mkdir()
    try:
        yield target
    finally:
        shutil.rmtree(target, ignore_errors=True)


def test_calculate_batch_from_data_returns_expected_shape():
    bundle = _constants_bundle()
    data = calculate_batch_from_data(
        volume_in3=100,
        oils_pct={"olive_oil": 70, "coconut_oil": 30},
        units_map=bundle["units"]["units"],
        density_map=bundle["density"]["density"],
        sap_map=bundle["sap_values"]["sap_values"],
        superfat_pct=5,
        oil_ratio=0.68,
        lye_ratio=2.3,
        liquid_type="distilled_water",
    )

    assert data["volume_in3"] == 100
    assert data["volume_ml"] > 0
    assert data["total_mass_g"] > 0
    assert data["total_oils_g"] > 0
    assert set(data["oils_g"].keys()) == {"olive_oil", "coconut_oil"}
    assert data["liquid_type"] == "distilled_water"
    assert "fragrance_oz" in data


def test_calculate_batch_resolves_product_recipe_to_base_recipe():
    base_recipes = [
        {
            "id": "BSR-001",
            "name": "Base A",
            "oils_pct": {"olive_oil": 70, "coconut_oil": 30},
            "lye": {"default_superfat_pct": 6},
            "liquid": {"default_type": "distilled_water"},
        }
    ]
    product_recipes = [
        {"id": "PR-001", "name": "Product A", "base_recipe_id": "BSR-001"}
    ]

    data = calculate_batch(
        volume_in3=80,
        recipe_id="PR-001",
        base_recipes=base_recipes,
        product_recipes=product_recipes,
        constants_bundle=_constants_bundle(),
    )

    assert data["base_recipe_id"] == "BSR-001"
    assert data["product_recipe_id"] == "PR-001"
    assert data["superfat_pct"] == 6
    assert data["liquid_type"] == "distilled_water"


def test_calculate_batch_supports_direct_base_recipe_id():
    base_recipes = [
        {
            "id": "BSR-002",
            "name": "Base B",
            "oils_pct": {"olive_oil": 60, "coconut_oil": 40},
            "lye": {"default_superfat_pct": 5},
            "liquid": {"default_type": "distilled_water"},
        }
    ]

    data = calculate_batch(
        volume_in3=60,
        recipe_id="BSR-002",
        base_recipes=base_recipes,
        product_recipes=[],
        constants_bundle=_constants_bundle(),
    )

    assert data["base_recipe_id"] == "BSR-002"
    assert data["product_recipe_id"] is None


def test_write_prep_file_writes_yaml():
    with _workspace_tempdir() as tmp_dir:
        tmp_path = Path(tmp_dir)
        batch_data = {
            "volume_in3": 50,
            "volume_ml": 819.4,
            "total_mass_g": 1000.0,
            "total_oils_g": 680.0,
            "materials_required_g": {
                "olive_oil": 476.0,
                "coconut_oil": 204.0,
                "naoh": 95.0,
                "distilled_water": 218.5,
                "fragrance_oil": 27.2,
            },
            "oils_g": {"olive_oil": 476.0, "coconut_oil": 204.0},
            "lye_g": 95.0,
            "liquid_g": 218.5,
            "liquid_type": "distilled_water",
            "fragrance_g": 27.2,
            "fragrance_ml": 30.2,
            "fragrance_oz": 0.96,
            "base_recipe_id": "BSR-001",
            "product_recipe_id": "PR-001",
        }

        path = write_prep_file(
            batch_data=batch_data,
            recipe_id="PR-001",
            settings={"superfat_pct": 6},
            output_dir=str(tmp_path),
        )

        assert path.exists()
        loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
        assert loaded["recipe_id"] == "PR-001"
        assert loaded["base_recipe_id"] == "BSR-001"
        assert loaded["product_recipe_id"] == "PR-001"
        assert loaded["targets"]["total_oils_g"] == 680.0
        assert loaded["materials_required_g"]["naoh"] == 95.0
        assert loaded["fragrance"]["amount_oz"] == 0.96


def test_add_cost_metrics_includes_cost_per_oz_and_cost_per_100g():
    batch_data = {
        "total_mass_g": 1000.0,
        "materials_required_g": {
            "olive_oil": 700.0,
            "coconut_oil": 300.0,
            "naoh": 100.0,
            "distilled_water": 200.0,
        },
    }
    inventory_doc = {
        "raw_materials": {
            "olive_oil": {"unit": "kg", "avg_cost_per_unit": 6.0},
            "coconut_oil": {"unit": "kg", "avg_cost_per_unit": 5.0},
        },
        "additives": {},
        "finished_goods": {},
    }
    units_cfg = {
        "units": {
            "kg": {"to_g": 1000},
            "g": {"to_g": 1},
            "oz": {"to_g": 28.3495},
        }
    }

    result = add_cost_metrics(batch_data, inventory_doc, units_cfg)
    costing = result["costing"]

    assert costing["scope"] == "materials_required"
    assert costing["total_material_cost"] == 5.7
    assert costing["cost_per_100g"] == 0.57
    assert costing["cost_per_oz"] == 0.1616
    assert sorted(costing["missing_material_costs"]) == ["distilled_water", "naoh"]
    assert "notes" in result


def test_write_prep_file_includes_costing_when_present():
    with _workspace_tempdir() as tmp_dir:
        tmp_path = Path(tmp_dir)
        batch_data = {
            "volume_in3": 50,
            "volume_ml": 819.4,
            "total_mass_g": 1000.0,
            "total_oils_g": 680.0,
            "oils_g": {"olive_oil": 476.0, "coconut_oil": 204.0},
            "lye_g": 95.0,
            "liquid_g": 218.5,
            "liquid_type": "distilled_water",
            "base_recipe_id": "BSR-001",
            "product_recipe_id": "PR-001",
            "costing": {
                "total_material_cost": 5.7,
                "cost_per_100g": 0.57,
                "cost_per_oz": 0.1616,
            },
        }

        path = write_prep_file(
            batch_data=batch_data,
            recipe_id="PR-001",
            settings={"superfat_pct": 6},
            output_dir=str(tmp_path),
        )

        loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
        assert loaded["costing"]["cost_per_100g"] == 0.57
        assert loaded["costing"]["cost_per_oz"] == 0.1616


def test_cli_calculate_batch_prep_writes_batch_file(tmp_path):
    cli_path = Path(__file__).resolve().parents[2] / "engine" / "cli.py"
    result = subprocess.run(
        [
            sys.executable, str(cli_path), "calculate_batch", "75", "PR-DEMO-001",
            "--prep", "--output-dir", str(tmp_path),
        ],
        cwd=tmp_path, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    files = sorted(tmp_path.glob("B-*.yaml"))
    assert len(files) == 1
    data = yaml.safe_load(files[0].read_text(encoding="utf-8"))
    assert data["recipe_id"] == "PR-DEMO-001"
    assert data["base_recipe_id"] == "BSR-DEMO-001"
    assert data["product_recipe_id"] == "PR-DEMO-001"
    assert data["status"] == "planned"
    assert data["mold"]["volume_in3"] == 75.0
    assert "materials_required_g" in data


def test_cli_calculate_batch_with_cost_outputs_metrics():
    repo_root = Path(__file__).resolve().parents[2]
    cli_path = repo_root / "engine" / "cli.py"

    result = subprocess.run(
        [
            sys.executable,
            str(cli_path),
            "calculate_batch",
            "75",
            "BSR-DEMO-001",
            "--with-cost",
        ],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert "cost_per_100g:" in result.stdout
    assert "cost_per_oz:" in result.stdout
