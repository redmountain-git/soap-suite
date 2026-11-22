import yaml
from datetime import date
from pathlib import Path

try:
    from .batch_sizing import calculate_batch_from_data, scale_recipe_for_mold_volume
    from .config import cfg, resolve_path
    from .costing_domain import inventory_cost_per_g_map
    from .unit_factors import mass_unit_to_g_factor
except ImportError:
    from batch_sizing import calculate_batch_from_data, scale_recipe_for_mold_volume
    from config import cfg, resolve_path
    from costing_domain import inventory_cost_per_g_map
    from unit_factors import mass_unit_to_g_factor


def calculate_batch(
    volume_in3,
    recipe_id,
    superfat_pct=None,
    oil_ratio=0.68,
    lye_ratio=None,
    liquid_type=None,
    fragrance_pct=None,
    base_recipes=None,
    product_recipes=None,
    constants_bundle=None,
):
    return scale_recipe_for_mold_volume(
        volume_in3=volume_in3,
        recipe_id=recipe_id,
        superfat_pct=superfat_pct,
        oil_ratio=oil_ratio,
        lye_ratio=lye_ratio,
        liquid_type=liquid_type,
        fragrance_pct=fragrance_pct,
        base_recipes=base_recipes,
        product_recipes=product_recipes,
        constants_bundle=constants_bundle,
    )


def add_cost_metrics(batch_data, inventory_doc, units_cfg, material_aliases=None):
    aliases = material_aliases or {}
    cost_per_g_map = inventory_cost_per_g_map(inventory_doc, units_cfg=units_cfg)
    total_cost = 0.0
    breakdown = {}
    missing = []

    materials = batch_data.get("materials_required_g") or batch_data.get("oils_g", {})

    for material, grams in materials.items():
        inventory_material = aliases.get(material, material)
        if inventory_material not in cost_per_g_map:
            missing.append(material)
            continue

        line_cost = float(grams) * float(cost_per_g_map[inventory_material])
        breakdown[material] = round(line_cost, 4)
        total_cost += line_cost

    total_mass_g = float(batch_data["total_mass_g"])
    if total_mass_g <= 0:
        raise ValueError("Batch total_mass_g must be > 0 for cost metrics")

    g_per_oz = mass_unit_to_g_factor("oz", units_cfg)
    if not g_per_oz:
        raise ValueError("Missing units conversion for 'oz'")

    cost_per_100g = (total_cost / total_mass_g) * 100.0
    cost_per_oz = (total_cost / total_mass_g) * g_per_oz

    batch_data["costing"] = {
        "scope": "materials_required",
        "total_material_cost": round(total_cost, 4),
        "cost_per_100g": round(cost_per_100g, 4),
        "cost_per_oz": round(cost_per_oz, 4),
        "material_costs": breakdown,
        "missing_material_costs": sorted(set(missing)),
    }

    if missing:
        notes = batch_data.setdefault("notes", [])
        for material in sorted(set(missing)):
            notes.append(
                f"Missing inventory cost data for material '{material}' while costing this batch."
            )

    return batch_data


def write_prep_file(batch_data, recipe_id, settings, output_dir=None):
    today = date.today().strftime("%Y%m%d")

    resolved_output_dir = output_dir or cfg["paths"].get("batch_prep", "batches")
    batches_dir = Path(resolve_path(resolved_output_dir))
    batches_dir.mkdir(parents=True, exist_ok=True)

    existing = list(batches_dir.glob(f"B-{today}-*.yaml"))
    seq = len(existing) + 1

    batch_id = f"B-{today}-{seq:03d}"

    data = {
        "id": batch_id,
        "date": date.today().isoformat(),
        "recipe_id": recipe_id,
        "base_recipe_id": batch_data.get("base_recipe_id"),
        "product_recipe_id": batch_data.get("product_recipe_id"),
        "mold": {
            "volume_in3": batch_data["volume_in3"],
            "volume_ml": batch_data["volume_ml"],
        },
        "settings": settings,
        "targets": {
            "total_mass_g": batch_data["total_mass_g"],
            "total_oils_g": batch_data["total_oils_g"],
        },
        "materials_required_g": batch_data.get("materials_required_g", {}),
        "oils": batch_data["oils_g"],
        "lye": {
            "type": batch_data.get("lye_type", "NaOH"),
            "amount_g": batch_data["lye_g"],
        },
        "liquid": {
            "type": batch_data["liquid_type"],
            "amount_g": batch_data["liquid_g"],
        },
        "status": "planned",
        "notes": "\n".join(batch_data.get("notes", [])) if batch_data.get("notes") else "",
    }

    if batch_data.get("fragrance_g", 0) > 0:
        data["fragrance"] = {
            "type": batch_data.get("fragrance_material", "fragrance_oil"),
            "percent_of_oils": batch_data.get("fragrance_pct", 4.0),
            "amount_g": batch_data["fragrance_g"],
            "volume_ml": batch_data.get("fragrance_ml"),
            "amount_oz": batch_data.get("fragrance_oz"),
        }

    if "costing" in batch_data:
        data["costing"] = batch_data["costing"]

    path = batches_dir / f"{batch_id}.yaml"

    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False)

    return path
