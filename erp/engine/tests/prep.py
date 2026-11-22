import copy
import shutil
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

import pytest
import yaml

from engine import prep as prep_module
from engine.inventory_domain import (
    consume_materials_from_inventory,
    denormalize_inventory_from_core,
    normalize_inventory_for_core,
)


def _units_cfg():
    return {"units": {"kg": {"to_g": 1000}, "g": {"to_g": 1}}}


def _inventory_doc():
    return {
        "raw_materials": {
            "olive_oil": {"unit": "kg", "on_hand": 1.0, "avg_cost_per_unit": 6.0},
            "coconut_oil": {"unit": "g", "on_hand": 500.0, "avg_cost_per_unit": 0.005},
            "naoh": {"unit": "g", "on_hand": 300.0, "avg_cost_per_unit": 0.02},
            "distilled_water": {
                "unit": "g",
                "on_hand": 1000.0,
                "avg_cost_per_unit": 0.001,
            },
        },
        "additives": {
            "fragrance_oil": {"unit": "g", "on_hand": 100.0, "avg_cost_per_unit": 0.03},
        },
        "finished_goods": {},
    }


def _prep_doc():
    return {
        "id": "B-20260319-001",
        "date": "2026-03-19",
        "recipe_id": "PR-001",
        "base_recipe_id": "BSR-001",
        "product_recipe_id": "PR-001",
        "mold": {"volume_in3": 75.0, "volume_ml": 1229.0},
        "settings": {
            "superfat_pct": 5,
            "oil_ratio": 0.68,
            "liquid_type": "distilled_water",
            "lye_ratio": 2.3,
            "fragrance_pct": 4.0,
        },
        "targets": {
            "total_mass_g": 1020.7,
            "total_oils_g": 680.0,
        },
        "oils": {
            "olive_oil": 476.0,
            "coconut_oil": 204.0,
        },
        "lye": {"type": "NAOH", "amount_g": 95.0},
        "liquid": {"type": "distilled_water", "amount_g": 218.5},
        "fragrance": {"type": "fragrance_oil", "amount_g": 27.2},
        "status": "planned",
    }


@contextmanager
def _workspace_tempdir():
    repo_root = Path(__file__).resolve().parents[2]
    base_dir = repo_root / "tmp_test_runs"
    base_dir.mkdir(exist_ok=True)
    target = base_dir / f"prep-{uuid4().hex}"
    target.mkdir()
    try:
        yield target
    finally:
        shutil.rmtree(target, ignore_errors=True)


def test_extract_materials_required_g_reconstructs_legacy_prep_shape():
    result = prep_module.extract_materials_required_g(_prep_doc())

    assert result == {
        "olive_oil": 476.0,
        "coconut_oil": 204.0,
        "naoh": 95.0,
        "distilled_water": 218.5,
        "fragrance_oil": 27.2,
    }


def test_extract_materials_required_g_prefers_explicit_materials_block():
    prep_doc = _prep_doc()
    prep_doc["materials_required_g"] = {"olive_oil": 400, "naoh": 80}

    result = prep_module.extract_materials_required_g(prep_doc)

    assert result == {"olive_oil": 400.0, "naoh": 80.0}


def test_extract_parent_materials_required_g_omits_child_additives():
    result = prep_module.extract_parent_materials_required_g(_prep_doc())

    assert result == {
        "olive_oil": 476.0,
        "coconut_oil": 204.0,
        "naoh": 95.0,
        "distilled_water": 218.5,
    }


def test_consume_materials_from_inventory_deducts_without_changing_cost():
    inventory_state = normalize_inventory_for_core(_inventory_doc(), units_cfg=_units_cfg())

    result = consume_materials_from_inventory(
        inventory_state,
        {"olive_oil": 250.0, "naoh": 50.0},
    )
    updated = denormalize_inventory_from_core(
        result.inventory_state,
        _inventory_doc(),
        units_cfg=_units_cfg(),
    )

    assert updated["raw_materials"]["olive_oil"]["on_hand"] == pytest.approx(0.75)
    assert updated["raw_materials"]["olive_oil"]["avg_cost_per_unit"] == pytest.approx(6.0)
    assert updated["raw_materials"]["naoh"]["on_hand"] == pytest.approx(250.0)
    assert result.consumed_materials_g == {"olive_oil": 250.0, "naoh": 50.0}


def test_consume_materials_from_inventory_raises_on_shortage():
    inventory_state = normalize_inventory_for_core(_inventory_doc(), units_cfg=_units_cfg())

    with pytest.raises(ValueError, match="Insufficient inventory for prep"):
        consume_materials_from_inventory(
            inventory_state,
            {"olive_oil": 1200.0, "naoh": 50.0},
        )


def test_apply_prep_file_updates_inventory_production_and_prep(monkeypatch):
    with _workspace_tempdir() as tmp_dir:
        prep_path = Path(tmp_dir) / "B-20260319-001.yaml"
        prep_path.write_text(yaml.safe_dump(_prep_doc(), sort_keys=False), encoding="utf-8")

        writes = []
        monkeypatch.setattr(
            prep_module,
            "save_yaml",
            lambda path, data: writes.append((path, copy.deepcopy(data))),
        )

        ctx = {
            "units": _units_cfg(),
            "inventory": _inventory_doc(),
            "production": {"batches": []},
        }

        result = prep_module.apply_prep_file(ctx, str(prep_path))

        assert result["status"] == "applied"
        assert ctx["inventory"]["raw_materials"]["olive_oil"]["on_hand"] == pytest.approx(
            0.524
        )
        assert ctx["inventory"]["raw_materials"]["coconut_oil"]["on_hand"] == pytest.approx(
            296.0
        )
        assert ctx["inventory"]["raw_materials"]["naoh"]["on_hand"] == pytest.approx(205.0)
        assert ctx["inventory"]["raw_materials"]["distilled_water"]["on_hand"] == pytest.approx(
            781.5
        )
        assert ctx["inventory"]["additives"]["fragrance_oil"]["on_hand"] == pytest.approx(
            100.0
        )

        production_batch = ctx["production"]["batches"][0]
        assert production_batch["id"] == "B-20260319-001"
        assert production_batch["parent_batch_id"] is None
        assert production_batch["product_recipe_id"] is None
        assert production_batch["status"] == "prepped"
        assert production_batch["prepped_at"] == production_batch["inventory_deducted_at"]
        assert production_batch["events"][-1]["type"] == "prepped"
        assert production_batch["inventory_deducted"] is True
        assert production_batch["oil_weight_g"] == pytest.approx(680.0)
        assert production_batch["material_usage_g"]["naoh"] == pytest.approx(95.0)
        assert "fragrance_oil" not in production_batch["material_usage_g"]

        updated_prep = yaml.safe_load(prep_path.read_text(encoding="utf-8"))
        assert updated_prep["status"] == "prepped"
        assert updated_prep["inventory_deducted"] is True
        assert "fragrance_oil" not in updated_prep["materials_required_g"]

        assert len(writes) == 2
        assert writes[0][0].endswith("data/inventory.yaml")
        assert writes[1][0].endswith("data/production.yaml")


def test_apply_prep_file_skips_when_already_applied(monkeypatch):
    with _workspace_tempdir() as tmp_dir:
        prep_doc = _prep_doc()
        prep_doc["inventory_deducted"] = True
        prep_path = Path(tmp_dir) / "B-20260319-001.yaml"
        prep_path.write_text(yaml.safe_dump(prep_doc, sort_keys=False), encoding="utf-8")

        writes = []
        monkeypatch.setattr(
            prep_module,
            "save_yaml",
            lambda path, data: writes.append((path, copy.deepcopy(data))),
        )

        ctx = {
            "units": _units_cfg(),
            "inventory": _inventory_doc(),
            "production": {"batches": []},
        }

        result = prep_module.apply_prep_file(ctx, str(prep_path))

        assert result["status"] == "skipped"
        assert result["reason"] == "prep already applied"
        assert writes == []
