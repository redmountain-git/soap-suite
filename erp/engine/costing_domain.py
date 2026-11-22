from copy import deepcopy

try:
    from .unit_factors import material_unit_to_g_factor
except ImportError:
    from unit_factors import material_unit_to_g_factor

def inventory_cost_per_g_map(inventory_doc, units_cfg=None, density_cfg=None):
    cost_map = {}

    for section_name in ("raw_materials", "additives"):
        section = inventory_doc.get(section_name, {})

        for material, record in section.items():
            unit = record.get("unit")
            avg_cost = record.get("avg_cost_per_unit")

            if avg_cost is None:
                continue

            avg_cost = float(avg_cost)
            factor = material_unit_to_g_factor(material, unit, units_cfg, density_cfg)
            if factor:
                cost_map[material] = avg_cost / factor

    return cost_map


def expand_batch_oil_usage_g(batch, base_recipe):
    oil_weight_g = float(batch["oil_weight_g"])
    oils_pct = base_recipe["oils_pct"]

    usage = {}

    for oil, pct in oils_pct.items():
        usage[oil] = oil_weight_g * (float(pct) / 100.0)

    return usage


def cost_batch_from_data(
    batch,
    base_recipe,
    inventory_doc,
    material_aliases=None,
    units_cfg=None,
    strict=True,
    density_cfg=None,
):
    aliases = material_aliases or {}
    usage_g = expand_batch_oil_usage_g(batch, base_recipe)
    cost_per_g = inventory_cost_per_g_map(inventory_doc, units_cfg=units_cfg, density_cfg=density_cfg)

    breakdown = {}
    total_cost = 0.0

    for material, grams in usage_g.items():
        inventory_material = aliases.get(material, material)

        if inventory_material not in cost_per_g:
            if strict:
                raise ValueError(f"Missing inventory cost for material: {material}")
            continue

        line_cost = grams * cost_per_g[inventory_material]
        breakdown[material] = line_cost
        total_cost += line_cost

    bar_count = batch.get("bars_actual") or batch.get("bars_expected")

    if not bar_count or bar_count <= 0:
        raise ValueError(f"Invalid bar count for batch {batch.get('id')}: {bar_count}")

    return {
        "usage_g": deepcopy(usage_g),
        "breakdown": breakdown,
        "total_cost": total_cost,
        "cost_per_bar": total_cost / float(bar_count),
        "bar_count": bar_count,
    }


def cost_material_requirements(
    requirements_g,
    inventory_doc,
    *,
    units_cfg=None,
    material_aliases=None,
    density_cfg=None,
):
    aliases = material_aliases or {}
    cost_per_g = inventory_cost_per_g_map(inventory_doc, units_cfg=units_cfg, density_cfg=density_cfg)

    total_cost = 0.0
    breakdown = {}
    missing = []

    for material, grams in requirements_g.items():
        inventory_material = aliases.get(material, material)
        if inventory_material not in cost_per_g:
            missing.append(material)
            continue

        line_cost = float(grams) * float(cost_per_g[inventory_material])
        breakdown[material] = line_cost
        total_cost += line_cost

    return {
        "total_cost": total_cost,
        "breakdown": breakdown,
        "missing_materials": sorted(set(missing)),
    }
