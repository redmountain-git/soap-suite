import subprocess
import sys
from pathlib import Path

from engine.capacity_domain import (
    capacity_audit_for_batches,
    max_capacity_for_batch,
    max_capacity_for_recipe,
)


def _units_cfg():
    return {"units": {"kg": {"to_g": 1000}, "g": {"to_g": 1}, "in3": {"to_ml": 16.387}}}


def _density_cfg():
    return {"density": {"olive_oil": 0.91, "coconut_oil": 0.92, "naoh": 2.13, "distilled_water": 1.0}}


def _sap_cfg():
    return {"sap_values": {"naoh": {"olive_oil": 0.134, "coconut_oil": 0.183}}}


def _base_recipes():
    return [
        {
            "id": "BSR-001",
            "oils_pct": {"olive_oil": 70, "coconut_oil": 30},
            "lye": {"type": "NaOH", "default_superfat_pct": 5},
            "liquid": {"default_type": "distilled_water"},
        }
    ]


def test_max_capacity_for_recipe_reports_limiting_material():
    inventory_doc = {
        "raw_materials": {
            "olive_oil": {"unit": "g", "on_hand": 700, "avg_cost_per_unit": 0.01},
            "coconut_oil": {"unit": "g", "on_hand": 200, "avg_cost_per_unit": 0.01},
        },
        "additives": {},
        "finished_goods": {},
    }

    result = max_capacity_for_recipe(
        recipe_ref="BSR-001",
        inventory_doc=inventory_doc,
        units_cfg=_units_cfg(),
        density_cfg=_density_cfg(),
        sap_cfg=_sap_cfg(),
        base_recipes=_base_recipes(),
        product_recipes=[],
    )

    assert result["mode"] == "recipe"
    assert result["base_recipe_id"] == "BSR-001"
    assert result["limiting_material"] == "coconut_oil"
    assert result["max_total_oils_g"] == 666.667
    assert "costing" in result
    assert "known_total_cost" in result["costing"]


def test_max_capacity_for_batch_reports_batch_count():
    inventory_doc = {
        "raw_materials": {
            "olive_oil": {"unit": "g", "on_hand": 1400, "avg_cost_per_unit": 0.01},
            "coconut_oil": {"unit": "g", "on_hand": 600, "avg_cost_per_unit": 0.01},
            "naoh": {"unit": "g", "on_hand": 1000, "avg_cost_per_unit": 0.02},
            "distilled_water": {"unit": "g", "on_hand": 5000, "avg_cost_per_unit": 0.001},
            "fragrance_oil": {"unit": "g", "on_hand": 1000, "avg_cost_per_unit": 0.03},
        },
        "additives": {},
        "finished_goods": {},
    }
    batch = {"id": "B-1", "base_recipe_id": "BSR-001", "oil_weight_g": 1000}

    result = max_capacity_for_batch(
        batch=batch,
        inventory_doc=inventory_doc,
        units_cfg=_units_cfg(),
        density_cfg=_density_cfg(),
        sap_cfg=_sap_cfg(),
        base_recipes=_base_recipes(),
        product_recipes=[],
    )

    assert result["mode"] == "batch"
    assert result["batch_id"] == "B-1"
    assert result["limiting_material"] == "olive_oil"
    assert result["max_batches_exact"] == 2.0
    assert result["max_batches_full"] == 2
    assert "costing" in result
    assert "max_full_run_known_cost" in result["costing"]


def test_capacity_audit_for_batches_supports_duplicates_and_shortages():
    inventory_doc = {
        "raw_materials": {
            "olive_oil": {"unit": "g", "on_hand": 1200, "avg_cost_per_unit": 0.01},
            "coconut_oil": {"unit": "g", "on_hand": 600, "avg_cost_per_unit": 0.01},
        },
        "additives": {},
        "finished_goods": {},
    }
    batches = [{"id": "B-1", "base_recipe_id": "BSR-001", "oil_weight_g": 1000}]

    result = capacity_audit_for_batches(
        batch_ids=["B-1", "B-1"],
        batches=batches,
        inventory_doc=inventory_doc,
        units_cfg=_units_cfg(),
        density_cfg=_density_cfg(),
        sap_cfg=_sap_cfg(),
        base_recipes=_base_recipes(),
        product_recipes=[],
    )

    assert result["batch_counts"]["B-1"] == 2
    assert result["total_required_g"]["olive_oil"] == 1400.0
    assert result["total_required_g"]["coconut_oil"] == 600.0
    assert result["shortages"]["olive_oil"]["short_g"] == 200.0
    assert result["purchase_recommendations_g"]["olive_oil"] == 200.0
    assert "costing" in result
    assert "required_known_cost" in result["costing"]


def test_cli_max_capacity_recipe():
    repo_root = Path(__file__).resolve().parents[2]
    cli_path = repo_root / "engine" / "cli.py"

    result = subprocess.run(
        [sys.executable, str(cli_path), "max-capacity", "--recipe-id", "BSR-DEMO-001"],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert "mode: recipe" in result.stdout
    assert "max_total_oils_g:" in result.stdout
    assert "costing:" in result.stdout


def test_cli_capacity_audit_with_duplicates():
    repo_root = Path(__file__).resolve().parents[2]
    cli_path = repo_root / "engine" / "cli.py"

    result = subprocess.run(
        [sys.executable, str(cli_path), "capacity-audit", "B-DEMO-001", "B-DEMO-001"],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert "batch_counts:" in result.stdout
    assert "B-DEMO-001: 2" in result.stdout
    assert "costing:" in result.stdout
