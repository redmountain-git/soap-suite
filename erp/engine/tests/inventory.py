import copy

import pytest

from engine.inventory import inventory_from_receipts
from engine.inventory_domain import (
    apply_receipts_to_inventory,
    denormalize_inventory_from_core,
    normalize_inventory_for_core,
)
from engine.units import UnitConverter


def make_converter():
    units = {
        "units": {
            "g": {"to_g": 1},
            "kg": {"to_g": 1000},
            "ml": {"to_ml": 1},
            "l": {"to_ml": 1000},
            "lb": {"to_g": 453.592},
            "each": {"to_each": 1},
        }
    }
    density = {"density": {"olive_oil": 0.91, "castor_oil": 0.96, "naoh": 2.13}}
    return UnitConverter(units, density)


def units_cfg():
    return {"units": {"kg": {"to_g": 1000}, "g": {"to_g": 1}}}


def test_apply_receipts_to_inventory_applies_single_line():
    converter = make_converter()
    receipts = [
        {
            "id": "R-1",
            "items": [
                {"material": "olive_oil", "quantity": 1, "unit": "kg", "total": 10.0}
            ],
        }
    ]

    result = apply_receipts_to_inventory({}, receipts, [], converter)

    assert result.inventory_state["olive_oil"]["on_hand_g"] == pytest.approx(1000.0)
    assert result.inventory_state["olive_oil"]["cost_per_g"] == pytest.approx(0.01)
    assert result.processed_receipt_ids == ["R-1"]
    assert result.applied_receipt_ids == ["R-1"]


def test_apply_receipts_to_inventory_weighted_average_for_same_material():
    converter = make_converter()
    inventory_state = {"olive_oil": {"on_hand_g": 1000.0, "cost_per_g": 0.01}}
    receipts = [
        {
            "id": "R-2",
            "items": [
                {"material": "olive_oil", "quantity": 500, "unit": "g", "total": 8.0}
            ],
        }
    ]

    result = apply_receipts_to_inventory(inventory_state, receipts, [], converter)
    updated = result.inventory_state["olive_oil"]

    assert updated["on_hand_g"] == pytest.approx(1500.0)
    assert updated["cost_per_g"] == pytest.approx((10.0 + 8.0) / 1500.0)


def test_apply_receipts_to_inventory_skips_already_applied_receipt():
    converter = make_converter()
    receipts = [
        {
            "id": "R-1",
            "items": [
                {"material": "olive_oil", "quantity": 1, "unit": "kg", "total": 10.0}
            ],
        }
    ]

    result = apply_receipts_to_inventory({}, receipts, ["R-1"], converter)

    assert result.inventory_state == {}
    assert result.skipped_receipt_ids == ["R-1"]
    assert result.processed_receipt_ids == []
    assert result.applied_receipt_ids == ["R-1"]


def test_apply_receipts_to_inventory_ignores_non_material_lines():
    converter = make_converter()
    receipts = [
        {
            "id": "R-1",
            "items": [
                {"material": None, "quantity": 1, "unit": "each", "total": 1.2},
                {"quantity": 1, "unit": "each", "total": 0.8},
            ],
        }
    ]

    result = apply_receipts_to_inventory({}, receipts, [], converter)

    assert result.inventory_state == {}
    assert result.processed_receipt_ids == ["R-1"]


def test_apply_receipts_to_inventory_raises_on_invalid_quantity():
    converter = make_converter()
    receipts = [
        {
            "id": "R-3",
            "items": [
                {"material": "olive_oil", "quantity": 0, "unit": "kg", "total": 10.0}
            ],
        }
    ]

    with pytest.raises(ValueError, match="Invalid quantity on R-3"):
        apply_receipts_to_inventory({}, receipts, [], converter)


def test_apply_receipts_to_inventory_raises_on_negative_cost():
    converter = make_converter()
    receipts = [
        {
            "id": "R-4",
            "items": [
                {"material": "olive_oil", "quantity": 1, "unit": "kg", "total": -1.0}
            ],
        }
    ]

    with pytest.raises(ValueError, match="Invalid cost on R-4"):
        apply_receipts_to_inventory({}, receipts, [], converter)


def test_apply_receipts_to_inventory_propagates_unit_errors():
    converter = make_converter()
    receipts = [
        {
            "id": "R-5",
            "items": [
                {"material": "olive_oil", "quantity": 1, "unit": "mystery", "total": 3.0}
            ],
        }
    ]

    with pytest.raises(ValueError, match="Unknown unit"):
        apply_receipts_to_inventory({}, receipts, [], converter)


def test_apply_receipts_to_inventory_handles_mass_and_volume_inputs():
    converter = make_converter()
    receipts = [
        {
            "id": "R-6",
            "items": [
                {"material": "olive_oil", "quantity": 1, "unit": "kg", "total": 12.0},
                {"material": "castor_oil", "quantity": 100, "unit": "ml", "total": 2.0},
            ],
        }
    ]

    result = apply_receipts_to_inventory({}, receipts, [], converter)

    assert result.inventory_state["olive_oil"]["on_hand_g"] == pytest.approx(1000.0)
    assert result.inventory_state["castor_oil"]["on_hand_g"] == pytest.approx(96.0)


def test_normalize_and_denormalize_inventory_roundtrip():
    inventory_doc = {
        "raw_materials": {
            "olive_oil": {"unit": "kg", "on_hand": 2.5, "avg_cost_per_unit": 7.0}
        },
        "additives": {
            "colloidal_oatmeal": {"unit": "g", "on_hand": 300, "avg_cost_per_unit": 0.02}
        },
        "finished_goods": {"bar_a": {"unit": "bar", "on_hand": 10, "cost_per_unit": 1.4}},
    }

    normalized = normalize_inventory_for_core(inventory_doc, units_cfg=units_cfg())
    updated_doc = denormalize_inventory_from_core(
        normalized,
        inventory_doc,
        units_cfg=units_cfg(),
    )

    assert normalized["olive_oil"]["on_hand_g"] == pytest.approx(2500.0)
    assert normalized["olive_oil"]["cost_per_g"] == pytest.approx(0.007)
    assert updated_doc["raw_materials"]["olive_oil"]["on_hand"] == pytest.approx(2.5)
    assert (
        updated_doc["raw_materials"]["olive_oil"]["avg_cost_per_unit"] == pytest.approx(7.0)
    )
    assert updated_doc["finished_goods"]["bar_a"]["unit"] == "bar"


def test_inventory_from_receipts_adapter_orchestrates_and_persists(monkeypatch):
    from engine import inventory as inventory_module

    calls = []

    def fake_save_yaml(path, data):
        calls.append((path, copy.deepcopy(data)))

    monkeypatch.setattr(inventory_module, "save_yaml", fake_save_yaml)

    ctx = {
        "units": {
            "units": {
                "g": {"to_g": 1},
                "kg": {"to_g": 1000},
                "ml": {"to_ml": 1},
                "each": {"to_each": 1},
            }
        },
        "density": {"density": {"olive_oil": 0.91}},
        "inventory": {
            "raw_materials": {
                "olive_oil": {
                    "unit": "kg",
                    "on_hand": 1.0,
                    "avg_cost_per_unit": 6.0,
                }
            },
            "additives": {},
            "finished_goods": {},
        },
        "inventory_meta": {"applied_receipts": []},
        "receipts": {
            "receipts": [
                {
                    "id": "R-100",
                    "items": [
                        {
                            "material": "olive_oil",
                            "quantity": 500,
                            "unit": "g",
                            "total": 4.0,
                        },
                        {"material": None, "quantity": 1, "unit": "each", "total": 0.5},
                    ],
                }
            ]
        },
    }

    inventory_from_receipts(ctx)

    updated = ctx["inventory"]["raw_materials"]["olive_oil"]
    assert updated["on_hand"] == pytest.approx(1.5)
    assert updated["avg_cost_per_unit"] == pytest.approx((6.0 + 4.0) / 1.5)
    assert ctx["inventory_meta"]["applied_receipts"] == ["R-100"]
    assert len(calls) == 2
    assert calls[0][0].endswith("data/inventory.yaml")
    assert calls[1][0].endswith("data/inventory_meta.yaml")


def test_inventory_from_receipts_adapter_is_idempotent_with_meta(monkeypatch):
    from engine import inventory as inventory_module

    monkeypatch.setattr(inventory_module, "save_yaml", lambda *_: None)

    ctx = {
        "units": {"units": {"g": {"to_g": 1}, "kg": {"to_g": 1000}}},
        "density": {"density": {}},
        "inventory": {
            "raw_materials": {
                "naoh": {"unit": "kg", "on_hand": 1.0, "avg_cost_per_unit": 10.0}
            },
            "additives": {},
            "finished_goods": {},
        },
        "inventory_meta": {"applied_receipts": ["R-200"]},
        "receipts": {
            "receipts": [
                {
                    "id": "R-200",
                    "items": [{"material": "naoh", "quantity": 1, "unit": "kg", "total": 12.0}],
                }
            ]
        },
    }

    before = copy.deepcopy(ctx["inventory"])
    inventory_from_receipts(ctx)

    assert ctx["inventory"] == before
    assert ctx["inventory_meta"]["applied_receipts"] == ["R-200"]


def test_denormalize_inventory_handles_finished_goods_and_new_material_defaults():
    inventory_doc = {
        "raw_materials": {},
        "additives": {},
        "finished_goods": {
            "fg_mass": {"unit": "g", "on_hand": 5.0, "avg_cost_per_unit": 1.0}
        },
    }

    inventory_state = {
        "fg_mass": {"on_hand_g": 12.0, "cost_per_g": 2.5},
        "new_material": {"on_hand_g": 20.0, "cost_per_g": 0.4},
    }

    updated = denormalize_inventory_from_core(
        inventory_state,
        inventory_doc,
        units_cfg=units_cfg(),
    )

    assert updated["finished_goods"]["fg_mass"]["on_hand"] == pytest.approx(12.0)
    assert updated["finished_goods"]["fg_mass"]["avg_cost_per_unit"] == pytest.approx(2.5)
    assert updated["raw_materials"]["new_material"]["unit"] == "g"
    assert updated["raw_materials"]["new_material"]["on_hand"] == pytest.approx(20.0)
    assert updated["raw_materials"]["new_material"]["avg_cost_per_unit"] == pytest.approx(
        0.4
    )


def test_apply_receipts_without_id_does_not_add_applied_receipt_id():
    converter = make_converter()
    receipts = [
        {
            "items": [
                {"material": "olive_oil", "quantity": 100, "unit": "g", "total": 1.5},
            ],
        }
    ]

    result = apply_receipts_to_inventory({}, receipts, [], converter)

    assert result.inventory_state["olive_oil"]["on_hand_g"] == pytest.approx(100.0)
    assert result.applied_receipt_ids == []
    assert result.processed_receipt_ids == []
