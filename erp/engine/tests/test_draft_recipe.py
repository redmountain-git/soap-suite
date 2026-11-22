import pytest

from engine.batch_sizing import compute_material_requirements_from_oils


def test_draft_recipe_cannot_be_calculated():
    draft = {
        "id": "BSR-DEMO-DRAFT",
        "status": "draft",
        "oils_pct": {"olive_oil": 100},
        "liquid": {"default_type": "distilled_water", "default_ratio": 0.3},
        "additives_pct": {"goat_milk_powder": 3},
    }
    with pytest.raises(ValueError, match="draft"):
        compute_material_requirements_from_oils(1000, draft, sap_source={})
