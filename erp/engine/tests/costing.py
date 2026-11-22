import copy

import pytest

from engine.costing import cost_all_batches
from engine.costing_domain import cost_batch_from_data, inventory_cost_per_g_map


def _units_cfg():
    return {"units": {"kg": {"to_g": 1000}, "g": {"to_g": 1}, "oz": {"to_g": 28.3495}}}


def _sap_cfg():
    return {"sap_values": {"naoh": {"olive_oil": 0.134, "coconut_oil": 0.183}}}


def test_inventory_cost_per_g_map_converts_kg_and_g():
    inventory_doc = {
        "raw_materials": {
            "olive_oil": {"unit": "kg", "avg_cost_per_unit": 6.0},
            "coconut_oil": {"unit": "g", "avg_cost_per_unit": 0.005},
        },
        "additives": {},
    }

    result = inventory_cost_per_g_map(inventory_doc, units_cfg=_units_cfg())

    assert result["olive_oil"] == pytest.approx(0.006)
    assert result["coconut_oil"] == pytest.approx(0.005)


def test_cost_batch_from_data_computes_total_and_per_bar():
    inventory_doc = {
        "raw_materials": {
            "olive_oil": {"unit": "kg", "avg_cost_per_unit": 6.0},
            "coconut_oil": {"unit": "kg", "avg_cost_per_unit": 5.0},
        },
        "additives": {},
    }
    batch = {"id": "B-1", "oil_weight_g": 1000, "bars_expected": 10}
    base_recipe = {"oils_pct": {"olive_oil": 70, "coconut_oil": 30}}

    result = cost_batch_from_data(batch, base_recipe, inventory_doc, units_cfg=_units_cfg())

    assert result["usage_g"]["olive_oil"] == pytest.approx(700.0)
    assert result["usage_g"]["coconut_oil"] == pytest.approx(300.0)
    assert result["total_cost"] == pytest.approx(5.7)
    assert result["cost_per_bar"] == pytest.approx(0.57)


def test_cost_batch_from_data_raises_on_missing_inventory_cost():
    inventory_doc = {"raw_materials": {"olive_oil": {"unit": "kg", "avg_cost_per_unit": 6.0}}}
    batch = {"id": "B-1", "oil_weight_g": 1000, "bars_expected": 10}
    base_recipe = {"oils_pct": {"olive_oil": 70, "coconut_oil": 30}}

    with pytest.raises(ValueError, match="Missing inventory cost for material: coconut_oil"):
        cost_batch_from_data(batch, base_recipe, inventory_doc, units_cfg=_units_cfg())


def test_cost_batch_from_data_supports_material_aliases():
    inventory_doc = {
        "raw_materials": {
            "sodium_hydroxide": {"unit": "kg", "avg_cost_per_unit": 4.8},
        },
        "additives": {},
    }
    batch = {"id": "B-1", "oil_weight_g": 1000, "bars_expected": 10}
    base_recipe = {"oils_pct": {"naoh": 100}}

    result = cost_batch_from_data(
        batch,
        base_recipe,
        inventory_doc,
        material_aliases={"naoh": "sodium_hydroxide"},
        units_cfg=_units_cfg(),
    )

    assert result["total_cost"] == pytest.approx(4.8)


def test_cost_all_batches_updates_and_persists(monkeypatch):
    from engine import costing as costing_module

    writes = []
    monkeypatch.setattr(
        costing_module, "save_yaml", lambda path, data: writes.append((path, copy.deepcopy(data)))
    )

    ctx = {
        "recipes_base": {
            "base_recipes": [
                {
                    "id": "BSR-001",
                    "oils_pct": {"olive_oil": 70, "coconut_oil": 30},
                }
            ]
        },
        "inventory": {
            "raw_materials": {
                "olive_oil": {"unit": "kg", "avg_cost_per_unit": 6.0},
                "coconut_oil": {"unit": "kg", "avg_cost_per_unit": 5.0},
            },
            "additives": {},
            "finished_goods": {},
        },
        "production": {
            "batches": [
                {
                    "id": "B-1",
                    "base_recipe_id": "BSR-001",
                    "oil_weight_g": 1000,
                    "bars_expected": 10,
                }
            ]
        },
        "units": _units_cfg(),
        "sap_values": _sap_cfg(),
        "recipes_product": {"product_recipes": []},
    }

    result = cost_all_batches(ctx)

    assert result == {"processed": 1, "skipped": 0}
    batch = ctx["production"]["batches"][0]
    assert batch["costed"] is False
    assert batch["total_cost"] == pytest.approx(5.7)
    assert batch["cost_per_bar"] == pytest.approx(0.57)
    assert batch["costing_scope"] == "materials_required"
    assert "naoh" in batch["missing_material_costs"]
    assert len(writes) == 1
    assert writes[0][0].endswith("data/production.yaml")


def test_cost_all_batches_skips_costed_unless_recompute(monkeypatch):
    from engine import costing as costing_module

    monkeypatch.setattr(costing_module, "save_yaml", lambda *_: None)

    batch = {
        "id": "B-1",
        "base_recipe_id": "BSR-001",
        "oil_weight_g": 1000,
        "bars_expected": 10,
        "costed": True,
        "total_cost": 1.23,
        "cost_per_bar": 0.12,
    }

    ctx = {
        "recipes_base": {
            "base_recipes": [
                {"id": "BSR-001", "oils_pct": {"olive_oil": 100}},
            ]
        },
        "inventory": {
            "raw_materials": {"olive_oil": {"unit": "kg", "avg_cost_per_unit": 6.0}},
            "additives": {},
            "finished_goods": {},
        },
        "production": {"batches": [batch]},
        "units": _units_cfg(),
        "sap_values": _sap_cfg(),
        "recipes_product": {"product_recipes": []},
    }

    skipped_result = cost_all_batches(ctx, recompute=False)
    assert skipped_result == {"processed": 0, "skipped": 1}
    assert ctx["production"]["batches"][0]["total_cost"] == pytest.approx(1.23)

    recompute_result = cost_all_batches(ctx, recompute=True)
    assert recompute_result == {"processed": 1, "skipped": 0}
    assert ctx["production"]["batches"][0]["total_cost"] == pytest.approx(6.0)


def test_cost_all_batches_raises_on_missing_base_recipe(monkeypatch):
    from engine import costing as costing_module

    monkeypatch.setattr(costing_module, "save_yaml", lambda *_: None)

    ctx = {
        "recipes_base": {"base_recipes": []},
        "inventory": {"raw_materials": {}, "additives": {}, "finished_goods": {}},
        "production": {"batches": [{"id": "B-1", "base_recipe_id": "BSR-404", "oil_weight_g": 1, "bars_expected": 1}]},
    }

    with pytest.raises(ValueError, match="Base recipe not found: BSR-404"):
        cost_all_batches(ctx)


def test_cost_all_batches_allocates_parent_cost_to_child_batches(monkeypatch):
    from engine import costing as costing_module

    monkeypatch.setattr(costing_module, "save_yaml", lambda *_: None)

    ctx = {
        "recipes_base": {
            "base_recipes": [
                {
                    "id": "BSR-001",
                    "oils_pct": {"olive_oil": 70, "coconut_oil": 30},
                    "lye": {"type": "NaOH", "default_superfat_pct": 5},
                    "liquid": {"default_type": "distilled_water"},
                }
            ]
        },
        "recipes_product": {
            "product_recipes": [{"id": "PR-001", "base_recipe_id": "BSR-001"}]
        },
        "inventory": {
            "raw_materials": {
                "olive_oil": {"unit": "kg", "avg_cost_per_unit": 6.0},
                "coconut_oil": {"unit": "kg", "avg_cost_per_unit": 5.0},
                "naoh": {"unit": "kg", "avg_cost_per_unit": 4.0},
                "distilled_water": {"unit": "kg", "avg_cost_per_unit": 1.0},
            },
            "additives": {
                "fragrance_oil": {"unit": "g", "avg_cost_per_unit": 0.03},
            },
            "finished_goods": {},
        },
        "production": {
            "batches": [
                {
                    "id": "B-ROOT",
                    "base_recipe_id": "BSR-001",
                    "recipe_id": "BSR-001",
                    "oil_weight_g": 1000,
                    "status": "prepped",
                },
                {
                    "id": "B-ROOT-C01",
                    "parent_batch_id": "B-ROOT",
                    "base_recipe_id": "BSR-001",
                    "recipe_id": "PR-001",
                    "product_recipe_id": "PR-001",
                    "oil_weight_g": 400,
                    "bars_expected": 4,
                    "status": "prepped",
                    "extra_material_usage_g": {"fragrance_oil": 20},
                },
            ]
        },
        "units": _units_cfg(),
        "sap_values": _sap_cfg(),
    }

    result = cost_all_batches(ctx)

    assert result == {"processed": 2, "skipped": 0}

    root = next(batch for batch in ctx["production"]["batches"] if batch["id"] == "B-ROOT")
    child = next(batch for batch in ctx["production"]["batches"] if batch["id"] == "B-ROOT-C01")

    assert root["total_cost"] == pytest.approx(6.59)
    assert "cost_per_bar" not in root
    assert child["allocated_parent_cost"] == pytest.approx(2.636, rel=1e-3)
    assert child["total_cost"] == pytest.approx(3.24)
    assert child["cost_per_bar"] == pytest.approx(0.81)
    assert child["material_usage_g"]["fragrance_oil"] == pytest.approx(20.0)


def test_cost_all_batches_cascades_costs_to_grandchildren(monkeypatch):
    from engine import costing as costing_module

    monkeypatch.setattr(costing_module, "save_yaml", lambda *_: None)

    ctx = {
        "recipes_base": {
            "base_recipes": [
                {
                    "id": "BSR-001",
                    "oils_pct": {"olive_oil": 70, "coconut_oil": 30},
                    "lye": {"type": "NaOH", "default_superfat_pct": 5},
                    "liquid": {"default_type": "distilled_water"},
                }
            ]
        },
        "recipes_product": {"product_recipes": []},
        "inventory": {
            "raw_materials": {
                "olive_oil": {"unit": "kg", "avg_cost_per_unit": 6.0},
                "coconut_oil": {"unit": "kg", "avg_cost_per_unit": 5.0},
                "naoh": {"unit": "kg", "avg_cost_per_unit": 4.0},
                "distilled_water": {"unit": "kg", "avg_cost_per_unit": 1.0},
            },
            "additives": {
                "fragrance_oil": {"unit": "g", "avg_cost_per_unit": 0.03},
                "activated_charcoal": {"unit": "g", "avg_cost_per_unit": 0.02},
            },
            "finished_goods": {},
        },
        "production": {
            "batches": [
                {
                    "id": "B-ROOT",
                    "base_recipe_id": "BSR-001",
                    "recipe_id": "BSR-001",
                    "oil_weight_g": 1000,
                    "status": "prepped",
                },
                {
                    "id": "B-ROOT-C01",
                    "parent_batch_id": "B-ROOT",
                    "base_recipe_id": "BSR-001",
                    "recipe_id": "BSR-001",
                    "oil_weight_g": 500,
                    "status": "prepped",
                    "extra_material_usage_g": {"fragrance_oil": 10},
                },
                {
                    "id": "B-ROOT-C01-C01",
                    "parent_batch_id": "B-ROOT-C01",
                    "base_recipe_id": "BSR-001",
                    "recipe_id": "BSR-001",
                    "oil_weight_g": 200,
                    "bars_actual": 2,
                    "status": "cut",
                    "extra_material_usage_g": {"activated_charcoal": 5},
                },
            ]
        },
        "units": _units_cfg(),
        "sap_values": _sap_cfg(),
    }

    cost_all_batches(ctx)

    root = next(batch for batch in ctx["production"]["batches"] if batch["id"] == "B-ROOT")
    child = next(batch for batch in ctx["production"]["batches"] if batch["id"] == "B-ROOT-C01")
    grandchild = next(
        batch for batch in ctx["production"]["batches"] if batch["id"] == "B-ROOT-C01-C01"
    )

    assert root["total_cost"] == pytest.approx(6.59)
    assert child["total_cost"] == pytest.approx(3.59, rel=1e-3)
    assert "cost_per_bar" not in child
    assert grandchild["allocated_parent_cost"] == pytest.approx(1.436, rel=1e-3)
    assert grandchild["total_cost"] == pytest.approx(1.54, rel=1e-3)
    assert grandchild["cost_per_bar"] == pytest.approx(0.77, rel=1e-3)
