from collections import Counter
import math

try:
    from .inventory_domain import normalize_inventory_for_core
    from .batch_sizing import batch_volume_from_oils, compute_material_requirements_from_oils
    from .storage.recipes import resolve_base_recipe_for_id
    from .costing_domain import inventory_cost_per_g_map
    from .unit_factors import mass_unit_to_g_factor
except ImportError:
    from inventory_domain import normalize_inventory_for_core
    from batch_sizing import batch_volume_from_oils, compute_material_requirements_from_oils
    from storage.recipes import resolve_base_recipe_for_id
    from costing_domain import inventory_cost_per_g_map
    from unit_factors import mass_unit_to_g_factor


def _unwrap_constants(units_cfg, density_cfg, sap_cfg):
    units_map = units_cfg.get("units", units_cfg)
    density_map = density_cfg.get("density", density_cfg)
    sap_source = sap_cfg.get("sap_values", sap_cfg)
    return units_map, density_map, sap_source


def _resolve_sap_map(sap_source, lye_type="naoh"):
    key = str(lye_type).lower()
    if isinstance(sap_source.get(key), dict):
        return sap_source[key]
    return sap_source


def _resolve_base_recipe_from_ref(recipe_ref, base_recipes, product_recipes):
    base_recipe, product_recipe = resolve_base_recipe_for_id(
        recipe_ref,
        base_recipes=base_recipes,
        product_recipes=product_recipes,
    )
    return base_recipe, product_recipe


def _oil_requirements_g(oils_pct, total_oils_g):
    return {
        material: float(total_oils_g) * (float(pct) / 100.0)
        for material, pct in oils_pct.items()
    }


def _on_hand_g_by_material(inventory_doc, units_cfg, density_cfg=None):
    normalized = normalize_inventory_for_core(inventory_doc, units_cfg=units_cfg, density_cfg=density_cfg)
    return {material: rec["on_hand_g"] for material, rec in normalized.items()}


def _max_total_oils_from_inventory(oils_pct, on_hand_g):
    limits = {}
    for material, pct in oils_pct.items():
        fraction = float(pct) / 100.0
        if fraction <= 0:
            continue
        available = float(on_hand_g.get(material, 0.0))
        limits[material] = available / fraction

    if not limits:
        raise ValueError("Recipe has no oil percentages")

    limiting_material = min(limits, key=limits.get)
    return limits[limiting_material], limiting_material, limits


def _cost_materials(materials_required_g, inventory_doc, units_cfg, density_cfg=None):
    cost_per_g = inventory_cost_per_g_map(inventory_doc, units_cfg=units_cfg, density_cfg=density_cfg)
    total_known_cost = 0.0
    known_costs = {}
    missing = []

    for material, grams in materials_required_g.items():
        if material not in cost_per_g:
            missing.append(material)
            continue

        line_cost = float(grams) * float(cost_per_g[material])
        known_costs[material] = line_cost
        total_known_cost += line_cost

    return {
        "total_known_cost": total_known_cost,
        "known_material_costs": known_costs,
        "missing_material_costs": sorted(set(missing)),
    }


def _cost_metrics(total_known_cost, total_mass_g, units_cfg):
    grams_per_oz = mass_unit_to_g_factor("oz", units_cfg)
    per_100g = None
    per_oz = None

    if total_mass_g and total_mass_g > 0:
        per_100g = (float(total_known_cost) / float(total_mass_g)) * 100.0
        if grams_per_oz:
            per_oz = (float(total_known_cost) / float(total_mass_g)) * float(grams_per_oz)

    return {
        "known_cost_per_100g": round(per_100g, 4) if per_100g is not None else None,
        "known_cost_per_oz": round(per_oz, 4) if per_oz is not None else None,
    }


def max_capacity_for_recipe(
    recipe_ref,
    *,
    inventory_doc,
    units_cfg,
    density_cfg,
    sap_cfg,
    base_recipes,
    product_recipes,
    superfat_pct=None,
    lye_ratio=None,
    liquid_type=None,
    fragrance_pct=None,
):
    base_recipe, product_recipe = _resolve_base_recipe_from_ref(
        recipe_ref, base_recipes, product_recipes
    )
    on_hand_g = _on_hand_g_by_material(inventory_doc, units_cfg, density_cfg)
    max_total_oils_g, limiting_material, per_material_limits = _max_total_oils_from_inventory(
        base_recipe["oils_pct"],
        on_hand_g,
    )

    effective_superfat = (
        superfat_pct
        if superfat_pct is not None
        else base_recipe.get("lye", {}).get("default_superfat_pct", 5)
    )
    effective_liquid = (
        liquid_type
        if liquid_type is not None
        else base_recipe.get("liquid", {}).get("default_type", "water")
    )

    units_map, density_map, sap_source = _unwrap_constants(units_cfg, density_cfg, sap_cfg)
    lye_type = base_recipe.get("lye", {}).get("type", "naoh")
    sap_map = _resolve_sap_map(sap_source, lye_type=lye_type)
    requirements = compute_material_requirements_from_oils(
        total_oils_g=max_total_oils_g,
        base_recipe=base_recipe,
        sap_source=sap_source,
        product_recipe=product_recipe,
        superfat_pct=effective_superfat,
        lye_ratio=lye_ratio,
        liquid_type=effective_liquid,
        fragrance_pct=fragrance_pct,
    )

    projected_batch = batch_volume_from_oils(
        total_oils_g=max_total_oils_g,
        oils_pct=base_recipe["oils_pct"],
        density_map=density_map,
        sap_map=sap_map,
        units_map=units_map,
        superfat_pct=effective_superfat,
        lye_ratio=requirements["lye_ratio"],
        liquid_type=effective_liquid,
        fragrance_pct=requirements["fragrance"]["percent_of_oils"] if requirements["fragrance"] else 0,
        fragrance_material=requirements["fragrance"]["material"]
        if requirements["fragrance"]
        else "fragrance_oil",
        additives_pct=base_recipe.get("additives_pct", {}),
        purity_percent=base_recipe.get("lye", {}).get("purity_percent", 100),
        lye_type=str(lye_type).lower(),
    )
    cost = _cost_materials(requirements["materials_required_g"], inventory_doc, units_cfg, density_cfg)
    cost_metrics = _cost_metrics(cost["total_known_cost"], projected_batch["total_mass_g"], units_cfg)

    return {
        "mode": "recipe",
        "recipe_ref": recipe_ref,
        "base_recipe_id": base_recipe["id"],
        "product_recipe_id": product_recipe["id"] if product_recipe else None,
        "max_total_oils_g": round(max_total_oils_g, 3),
        "limiting_material": limiting_material,
        "limits_total_oils_g": {k: round(v, 3) for k, v in per_material_limits.items()},
        "projected_batch": projected_batch,
        "materials_required_g": {
            k: round(v, 3) for k, v in requirements["materials_required_g"].items()
        },
        "costing": {
            "scope": "materials_required",
            "known_total_cost": round(cost["total_known_cost"], 4),
            "known_material_costs": {
                k: round(v, 4) for k, v in cost["known_material_costs"].items()
            },
            "missing_material_costs": cost["missing_material_costs"],
            **cost_metrics,
        },
    }


def max_capacity_for_batch(
    batch,
    *,
    inventory_doc,
    units_cfg,
    density_cfg,
    sap_cfg,
    base_recipes,
    product_recipes,
    superfat_pct=None,
    lye_ratio=None,
    liquid_type=None,
    fragrance_pct=None,
):
    recipe_ref = (
        batch.get("base_recipe_id")
        or batch.get("recipe_id")
        or batch.get("product_recipe_id")
    )
    if not recipe_ref:
        raise ValueError(f"Batch {batch.get('id')} missing recipe identifier")

    base_recipe, product_recipe = _resolve_base_recipe_from_ref(
        recipe_ref, base_recipes, product_recipes
    )
    _, _, sap_source = _unwrap_constants(units_cfg, density_cfg, sap_cfg)
    requirements = compute_material_requirements_from_oils(
        total_oils_g=batch["oil_weight_g"],
        base_recipe=base_recipe,
        sap_source=sap_source,
        product_recipe=product_recipe,
        superfat_pct=superfat_pct,
        lye_ratio=lye_ratio,
        liquid_type=liquid_type,
        fragrance_pct=fragrance_pct,
    )
    per_batch_materials_g = requirements["materials_required_g"]
    on_hand_g = _on_hand_g_by_material(inventory_doc, units_cfg, density_cfg)

    ratios = {}
    for material, grams_needed in per_batch_materials_g.items():
        available = float(on_hand_g.get(material, 0.0))
        ratios[material] = available / float(grams_needed) if grams_needed > 0 else math.inf

    if not ratios:
        raise ValueError("Batch recipe has no oil requirements")

    limiting_material = min(ratios, key=ratios.get)
    exact_batches = ratios[limiting_material]
    max_full_batches = max(0, math.floor(exact_batches))
    run_requirements = {
        k: float(v) * max_full_batches for k, v in per_batch_materials_g.items()
    }
    run_cost = _cost_materials(run_requirements, inventory_doc, units_cfg, density_cfg)

    return {
        "mode": "batch",
        "batch_id": batch.get("id"),
        "base_recipe_id": base_recipe["id"],
        "oil_weight_g": float(batch["oil_weight_g"]),
        "per_batch_materials_g": {k: round(v, 3) for k, v in per_batch_materials_g.items()},
        "limiting_material": limiting_material,
        "max_batches_exact": round(exact_batches, 4),
        "max_batches_full": max_full_batches,
        "costing": {
            "scope": "materials_required",
            "per_batch_known_cost": round(
                run_cost["total_known_cost"] / max_full_batches, 4
            )
            if max_full_batches > 0
            else 0.0,
            "max_full_run_known_cost": round(run_cost["total_known_cost"], 4),
            "missing_material_costs": run_cost["missing_material_costs"],
        },
    }


def capacity_audit_for_batches(
    batch_ids,
    *,
    batches,
    inventory_doc,
    units_cfg,
    density_cfg,
    sap_cfg,
    base_recipes,
    product_recipes,
    fragrance_pct=None,
):
    by_id = {b["id"]: b for b in batches}
    counts = Counter(batch_ids)
    on_hand_g = _on_hand_g_by_material(inventory_doc, units_cfg, density_cfg)
    _, _, sap_source = _unwrap_constants(units_cfg, density_cfg, sap_cfg)
    total_required = {}
    missing_batches = []

    for batch_id, count in counts.items():
        batch = by_id.get(batch_id)
        if batch is None:
            missing_batches.append(batch_id)
            continue

        recipe_ref = (
            batch.get("base_recipe_id")
            or batch.get("recipe_id")
            or batch.get("product_recipe_id")
        )
        if not recipe_ref:
            raise ValueError(f"Batch {batch_id} missing recipe identifier")

        base_recipe, product_recipe = _resolve_base_recipe_from_ref(
            recipe_ref, base_recipes, product_recipes
        )
        per_batch = compute_material_requirements_from_oils(
            total_oils_g=batch["oil_weight_g"],
            base_recipe=base_recipe,
            sap_source=sap_source,
            product_recipe=product_recipe,
            fragrance_pct=fragrance_pct,
        )["materials_required_g"]
        for material, grams in per_batch.items():
            total_required[material] = total_required.get(material, 0.0) + (
                float(grams) * count
            )

    shortages = {}
    for material, required in total_required.items():
        available = float(on_hand_g.get(material, 0.0))
        short = required - available
        if short > 0:
            shortages[material] = {
                "required_g": round(required, 3),
                "on_hand_g": round(available, 3),
                "short_g": round(short, 3),
            }

    purchase_recommendations = {
        material: details["short_g"] for material, details in shortages.items()
    }
    required_costs = _cost_materials(total_required, inventory_doc, units_cfg, density_cfg)
    purchase_costs = _cost_materials(purchase_recommendations, inventory_doc, units_cfg, density_cfg)

    return {
        "batch_counts": dict(counts),
        "missing_batches": missing_batches,
        "total_required_g": {k: round(v, 3) for k, v in total_required.items()},
        "on_hand_g": {k: round(float(v), 3) for k, v in on_hand_g.items() if k in total_required},
        "shortages": shortages,
        "purchase_recommendations_g": purchase_recommendations,
        "costing": {
            "scope": "materials_required",
            "required_known_cost": round(required_costs["total_known_cost"], 4),
            "required_known_material_costs": {
                k: round(v, 4) for k, v in required_costs["known_material_costs"].items()
            },
            "required_missing_material_costs": required_costs["missing_material_costs"],
            "purchase_known_cost": round(purchase_costs["total_known_cost"], 4),
            "purchase_known_material_costs": {
                k: round(v, 4) for k, v in purchase_costs["known_material_costs"].items()
            },
            "purchase_missing_material_costs": purchase_costs["missing_material_costs"],
        },
    }
