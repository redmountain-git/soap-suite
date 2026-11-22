import pytest
from engine.batch_sizing import calculate_batch_from_data, compute_material_requirements_from_oils
from engine.receipt_normalization import normalize_receipt


def test_independent_complete_formulation_volume():
    # 100 g oil + 10 g alkali + 20 g water + 5 g clay occupies 135 ml.
    result = calculate_batch_from_data(270, {"oil": 100}, {"in3": {"to_ml": 1}}, {"oil": 1, "naoh": 1, "water": 1, "clay": 1}, {"oil": .1}, superfat_pct=0, lye_ratio=2, liquid_type="water", fragrance_pct=0, additives_pct={"clay": 5})
    assert result["total_oils_g"] == pytest.approx(200)
    assert result["total_mass_g"] == pytest.approx(270)


def test_purity_and_additives_are_in_requirements():
    result = compute_material_requirements_from_oils(100, {"oils_pct": {"oil": 100}, "lye": {"purity_percent": 50}, "additives_pct": {"clay": 5}}, sap_source={"naoh": {"oil": .1}}, superfat_pct=0, fragrance_pct=0)
    assert result["materials_required_g"]["naoh"] == 20
    assert result["materials_required_g"]["clay"] == 5


def test_receipt_aliases_and_tax():
    r = normalize_receipt({"total_usd": 11, "tax_usd": 1, "items": [{"name": "Oil", "amount_usd": 10}]})
    assert r["total"] == 11
    assert r["items"][0]["total"] == 10
    with pytest.raises(ValueError, match="Conflicting"):
        normalize_receipt({"items": [{"total": 1, "amount_usd": 2}]})


def test_recipe_water_ratio_and_explicit_override():
    base = {"oils_pct": {"oil": 100}, "liquid": {"default_type": "water", "default_ratio": .33}}
    result = compute_material_requirements_from_oils(100, base, sap_source={"naoh": {"oil": .1}}, fragrance_pct=0)
    assert result["liquid_g"] == pytest.approx(33)
    override = compute_material_requirements_from_oils(100, base, sap_source={"naoh": {"oil": .1}}, fragrance_pct=0, lye_ratio=2)
    assert override["liquid_g"] == pytest.approx(override["lye_g"] * 2)
