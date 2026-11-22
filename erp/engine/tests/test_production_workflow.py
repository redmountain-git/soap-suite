import pytest

from engine import production as production_module
from engine.production_domain import normalize_production_document


def _units_cfg():
    return {"units": {"kg": {"to_g": 1000}, "g": {"to_g": 1}}}


def _inventory_doc():
    return {
        "raw_materials": {
            "olive_oil": {"unit": "kg", "on_hand": 10.0, "avg_cost_per_unit": 6.0},
            "coconut_oil": {"unit": "kg", "on_hand": 10.0, "avg_cost_per_unit": 5.0},
            "naoh": {"unit": "kg", "on_hand": 2.0, "avg_cost_per_unit": 4.0},
            "distilled_water": {"unit": "kg", "on_hand": 5.0, "avg_cost_per_unit": 1.0},
        },
        "additives": {
            "fragrance_oil": {"unit": "g", "on_hand": 100.0, "avg_cost_per_unit": 0.03},
            "activated_charcoal": {
                "unit": "g",
                "on_hand": 50.0,
                "avg_cost_per_unit": 0.02,
            },
        },
        "finished_goods": {},
    }


def _base_ctx():
    return {
        "inventory": _inventory_doc(),
        "inventory_meta": {
            "applied_receipts": [],
            "applied_finished_goods_posts": [],
        },
        "production": {"batches": []},
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
            "product_recipes": [
                {"id": "PR-001", "base_recipe_id": "BSR-001"},
                {"id": "PR-ALT", "base_recipe_id": "BSR-001"},
            ]
        },
        "units": _units_cfg(),
        "bar_sizes": {
            "bar_0_75_oz": {"display_name": "0.75 oz", "active": True},
            "bar_1_0_oz": {"display_name": "1.0 oz", "active": True},
            "bar_5_2_oz": {"display_name": "5.2 oz", "active": True},
            "bar_6_oz": {"display_name": "6 oz", "active": True},
            "bar_8_oz": {"display_name": "8 oz", "active": True},
        },
    }


def _root_batch(**overrides):
    batch = {
        "id": "B-ROOT",
        "date": "2026-03-20",
        "recipe_id": "BSR-001",
        "base_recipe_id": "BSR-001",
        "product_recipe_id": None,
        "oil_weight_g": 1000.0,
        "status": "prepped",
        "bars_expected": 10,
        "inventory_deducted": True,
        "inventory_deducted_at": "2026-03-20",
        "prepped_at": "2026-03-20",
        "events": [{"type": "prepped", "at": "2026-03-20"}],
    }
    batch.update(overrides)
    return batch


def _child_batch(**overrides):
    batch = {
        "id": "B-ROOT-C01",
        "parent_batch_id": "B-ROOT",
        "date": "2026-03-21",
        "recipe_id": "PR-001",
        "base_recipe_id": "BSR-001",
        "product_recipe_id": "PR-001",
        "oil_weight_g": 400.0,
        "status": "planned",
        "bars_expected": 4,
        "events": [],
        "extra_material_usage_g": {},
    }
    batch.update(overrides)
    return batch


def test_normalize_production_document_backfills_legacy_batches():
    normalized = normalize_production_document(
        {
            "batches": [
                {
                    "id": "B-1",
                    "date": "2026-03-01",
                    "base_recipe_id": "BSR-001",
                    "oil_weight_g": 1000,
                    "bars_expected": 12,
                    "status": "poured",
                }
            ]
        }
    )

    batch = normalized["batches"][0]
    assert batch["recipe_id"] == "BSR-001"
    assert batch["parent_batch_id"] is None
    assert batch["events"] == []
    assert batch["inventory_deducted"] is False
    assert batch["extra_material_usage_g"] == {}
    assert batch["prepped_at"] is None
    assert batch["posted_to_inventory_at"] is None


def test_record_batch_event_updates_status_and_milestone(monkeypatch):
    monkeypatch.setattr(production_module, "save_yaml", lambda *_: None)
    ctx = _base_ctx()
    ctx["production"]["batches"] = [_root_batch()]

    result = production_module.record_batch_event(
        ctx,
        "B-ROOT",
        "cure_started",
        at="2026-03-25",
        notes="rack A",
    )

    batch = ctx["production"]["batches"][0]
    assert result["status"] == "curing"
    assert batch["status"] == "curing"
    assert batch["cure_started_at"] == "2026-03-25"
    assert batch["events"][-1] == {
        "type": "cure_started",
        "at": "2026-03-25",
        "notes": "rack A",
    }


def test_record_batch_event_rejects_repouring_shredded_batch(monkeypatch):
    monkeypatch.setattr(production_module, "save_yaml", lambda *_: None)
    ctx = _base_ctx()
    ctx["production"]["batches"] = [_root_batch(status="shredded", shredded_at="2026-03-24")]

    with pytest.raises(ValueError, match="Create a child batch"):
        production_module.record_batch_event(ctx, "B-ROOT", "poured", at="2026-03-26")


def test_create_child_batch_inherits_recipe_and_records_parent_event(monkeypatch):
    monkeypatch.setattr(production_module, "save_yaml", lambda *_: None)
    ctx = _base_ctx()
    ctx["production"]["batches"] = [_root_batch(recipe_id="PR-001", product_recipe_id="PR-001")]

    child = production_module.create_child_batch(
        ctx,
        "B-ROOT",
        400,
        notes="split for scenting",
        at="2026-03-21",
    )

    assert child["id"] == "B-ROOT-C01"
    assert child["parent_batch_id"] == "B-ROOT"
    assert child["status"] == "planned"
    assert child["recipe_id"] == "PR-001"
    assert child["base_recipe_id"] == "BSR-001"
    assert child["product_recipe_id"] == "PR-001"

    parent = next(batch for batch in ctx["production"]["batches"] if batch["id"] == "B-ROOT")
    assert parent["events"][-1]["type"] == "child_created"
    assert "B-ROOT-C01" in parent["events"][-1]["notes"]


def test_create_child_batch_rejects_over_allocation(monkeypatch):
    monkeypatch.setattr(production_module, "save_yaml", lambda *_: None)
    ctx = _base_ctx()
    ctx["production"]["batches"] = [
        _root_batch(),
        _child_batch(id="B-ROOT-C01", oil_weight_g=700.0),
    ]

    with pytest.raises(ValueError, match="Child allocation exceeds parent oils"):
        production_module.create_child_batch(ctx, "B-ROOT", 400)


def test_record_child_materials_deducts_inventory_and_marks_child_prepped(monkeypatch):
    monkeypatch.setattr(production_module, "save_yaml", lambda *_: None)
    ctx = _base_ctx()
    ctx["production"]["batches"] = [_root_batch(), _child_batch()]

    result = production_module.record_child_materials(
        ctx,
        "B-ROOT-C01",
        {"fragrance_oil": 25.0, "activated_charcoal": 5.0},
        at="2026-03-21",
        notes="custom blend",
    )

    child = next(batch for batch in ctx["production"]["batches"] if batch["id"] == "B-ROOT-C01")
    assert result["status"] == "prepped"
    assert child["status"] == "prepped"
    assert child["prepped_at"] == "2026-03-21"
    assert child["inventory_deducted"] is True
    assert child["inventory_deducted_at"] == "2026-03-21"
    assert child["extra_material_usage_g"] == {
        "fragrance_oil": 25.0,
        "activated_charcoal": 5.0,
    }
    assert child["events"][-1]["type"] == "prepped"
    assert ctx["inventory"]["additives"]["fragrance_oil"]["on_hand"] == pytest.approx(75.0)
    assert ctx["inventory"]["additives"]["activated_charcoal"]["on_hand"] == pytest.approx(
        45.0
    )


def test_record_cut_yield_sets_bars_actual_and_cut_event(monkeypatch):
    monkeypatch.setattr(production_module, "save_yaml", lambda *_: None)
    ctx = _base_ctx()
    ctx["production"]["batches"] = [_root_batch()]

    result = production_module.record_cut_yield(
        ctx,
        "B-ROOT",
        {"bar_5_2_oz": 8, "bar_6_oz": 2},
        scrap_g=15.5,
        shredded_g=20.0,
        at="2026-03-24",
        notes="trimmed ends",
    )

    batch = ctx["production"]["batches"][0]
    assert result["bars_actual"] == 10
    assert batch["status"] == "cut"
    assert batch["cut_at"] == "2026-03-24"
    assert batch["bars_actual"] == 10
    assert batch["yield_actual"] == {
        "recorded_at": "2026-03-24",
        "size_counts": {"bar_5_2_oz": 8, "bar_6_oz": 2},
        "scrap_g": 15.5,
        "shredded_g": 20.0,
    }
    assert batch["events"][-1]["type"] == "cut"


def test_record_cut_yield_requires_leaf_batch(monkeypatch):
    monkeypatch.setattr(production_module, "save_yaml", lambda *_: None)
    ctx = _base_ctx()
    ctx["production"]["batches"] = [_root_batch(), _child_batch()]

    with pytest.raises(ValueError, match="is not a leaf batch"):
        production_module.record_cut_yield(ctx, "B-ROOT", {"bar_5_2_oz": 4})


def test_post_finished_goods_updates_inventory_and_is_idempotent(monkeypatch):
    monkeypatch.setattr(production_module, "save_yaml", lambda *_: None)
    ctx = _base_ctx()
    ctx["inventory"]["finished_goods"] = {
        "PR-001.bar_5_2_oz": {"unit": "bar", "on_hand": 10, "cost_per_unit": 1.2}
    }
    ctx["production"]["batches"] = [
        _child_batch(
            status="cured",
            cure_completed_at="2026-03-28",
            cost_per_bar=1.5,
            yield_actual={
                "recorded_at": "2026-03-27",
                "size_counts": {"bar_5_2_oz": 4, "bar_6_oz": 2},
                "scrap_g": 0.0,
                "shredded_g": 0.0,
            },
        )
    ]

    result = production_module.post_finished_goods(ctx, "B-ROOT-C01", at="2026-03-29")

    batch = ctx["production"]["batches"][0]
    assert result["status"] == "in_inventory"
    assert result["post_id"] == "FGP-B-ROOT-C01"
    assert result["posted_items"] == {"PR-001.bar_5_2_oz": 4, "PR-001.bar_6_oz": 2}
    assert batch["status"] == "in_inventory"
    assert batch["posted_to_inventory_at"] == "2026-03-29"
    assert batch["events"][-1]["type"] == "posted_to_inventory"
    assert ctx["inventory_meta"]["applied_finished_goods_posts"] == ["FGP-B-ROOT-C01"]
    assert ctx["inventory"]["finished_goods"]["PR-001.bar_5_2_oz"]["on_hand"] == 14
    assert ctx["inventory"]["finished_goods"]["PR-001.bar_5_2_oz"]["avg_cost_per_unit"] == pytest.approx(
        1.2857
    )
    assert ctx["inventory"]["finished_goods"]["PR-001.bar_5_2_oz"]["cost_per_unit"] == pytest.approx(
        1.2857
    )
    assert ctx["inventory"]["finished_goods"]["PR-001.bar_6_oz"] == {
        "unit": "bar",
        "on_hand": 2,
        "avg_cost_per_unit": 1.5,
    }

    second = production_module.post_finished_goods(ctx, "B-ROOT-C01", at="2026-03-29")
    assert second["status"] == "skipped"
    assert ctx["inventory"]["finished_goods"]["PR-001.bar_5_2_oz"]["on_hand"] == 14
