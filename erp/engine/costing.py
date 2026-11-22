try:
    from .loader import save_yaml
    from .config import cfg
    from .costing_domain import cost_material_requirements
    from .batch_sizing import compute_material_requirements_from_oils
    from .production_domain import has_children, normalize_production_document, topological_batches_by_lineage
except ImportError:
    from loader import save_yaml
    from config import cfg
    from costing_domain import cost_material_requirements
    from batch_sizing import compute_material_requirements_from_oils
    from production_domain import has_children, normalize_production_document, topological_batches_by_lineage


def _find_base_recipe(ctx, base_recipe_id):
    base_recipes = ctx["recipes_base"]["base_recipes"]

    for recipe in base_recipes:
        if recipe["id"] == base_recipe_id:
            return recipe

    raise ValueError(f"Base recipe not found: {base_recipe_id}")


def _find_product_recipe(ctx, product_recipe_id):
    if not product_recipe_id:
        return None

    product_recipes = ctx.get("recipes_product", {}).get("product_recipes", [])
    for recipe in product_recipes:
        if recipe["id"] == product_recipe_id:
            return recipe

    return None


def _merge_usage(base_usage, extra_usage):
    merged = {
        str(material): float(grams)
        for material, grams in (base_usage or {}).items()
    }

    for material, grams in (extra_usage or {}).items():
        merged[str(material)] = merged.get(str(material), 0.0) + float(grams)

    return merged


def _merge_breakdowns(left, right):
    merged = {
        str(material): float(cost)
        for material, cost in (left or {}).items()
    }

    for material, cost in (right or {}).items():
        merged[str(material)] = merged.get(str(material), 0.0) + float(cost)

    return merged


def cost_all_batches(ctx, recompute=False, material_aliases=None):
    processed = 0
    skipped = 0

    production = normalize_production_document(ctx["production"])
    inventory = ctx["inventory"]
    ordered_batches = topological_batches_by_lineage(production.get("batches", []))
    by_id = {batch["id"]: batch for batch in production.get("batches", [])}

    for ordered_batch in ordered_batches:
        batch = by_id[ordered_batch["id"]]
        if batch.get("costed") and not recompute:
            skipped += 1
            continue

        base_id = batch["base_recipe_id"]
        base_recipe = _find_base_recipe(ctx, base_id)
        extra_usage = batch.get("extra_material_usage_g", {})
        child_batch = batch.get("parent_batch_id") is not None

        if child_batch:
            requirements = compute_material_requirements_from_oils(
                total_oils_g=batch["oil_weight_g"],
                base_recipe=base_recipe,
                sap_source=ctx.get("sap_values", {}),
                product_recipe=None,
                fragrance_pct=0.0,
            )
            parent_batch = by_id[batch["parent_batch_id"]]
            allocation_ratio = float(batch["oil_weight_g"]) / float(parent_batch["oil_weight_g"])
            allocated_parent_cost = float(parent_batch.get("total_cost", 0.0)) * allocation_ratio
            allocated_breakdown = {
                material: float(cost) * allocation_ratio
                for material, cost in (parent_batch.get("material_costs") or {}).items()
            }
            result = cost_material_requirements(
                requirements_g=extra_usage,
                inventory_doc=inventory,
                units_cfg=ctx.get("units"),
                density_cfg=ctx.get("density"),
                material_aliases=material_aliases,
            )
            total_cost = allocated_parent_cost + result["total_cost"]
            breakdown = _merge_breakdowns(allocated_breakdown, result["breakdown"])
            missing_materials = sorted(
                set(parent_batch.get("missing_material_costs", []))
                | set(result["missing_materials"])
            )
            batch["allocated_parent_cost"] = round(allocated_parent_cost, 4)
        else:
            product_recipe = _find_product_recipe(
                ctx,
                batch.get("product_recipe_id"),
            )
            requirements = compute_material_requirements_from_oils(
                total_oils_g=batch["oil_weight_g"],
                base_recipe=base_recipe,
                sap_source=ctx.get("sap_values", {}),
                product_recipe=product_recipe,
                fragrance_pct=None,
            )
            base_result = cost_material_requirements(
                requirements_g=requirements["materials_required_g"],
                inventory_doc=inventory,
                units_cfg=ctx.get("units"),
                density_cfg=ctx.get("density"),
                material_aliases=material_aliases,
            )
            extra_result = cost_material_requirements(
                requirements_g=extra_usage,
                inventory_doc=inventory,
                units_cfg=ctx.get("units"),
                density_cfg=ctx.get("density"),
                material_aliases=material_aliases,
            )
            total_cost = base_result["total_cost"] + extra_result["total_cost"]
            breakdown = _merge_breakdowns(base_result["breakdown"], extra_result["breakdown"])
            missing_materials = sorted(
                set(base_result["missing_materials"]) | set(extra_result["missing_materials"])
            )
            batch.pop("allocated_parent_cost", None)

        frozen = batch.get("consumption_costs")
        if frozen is not None and not child_batch:
            breakdown = deepcopy(frozen)
            total_cost = sum(breakdown.values())
            missing_materials = list(batch.get("consumption_missing_costs", []))
        elif child_batch and "extra_consumption_costs" in batch:
            parent_cost = by_id[batch["parent_batch_id"]]
            ratio = float(batch["oil_weight_g"]) / float(parent_cost["oil_weight_g"])
            allocated = {material: value * ratio for material, value in parent_cost.get("material_costs", {}).items()}
            breakdown = _merge_breakdowns(allocated, batch["extra_consumption_costs"])
            total_cost = sum(breakdown.values())
            missing_materials = sorted(set(parent_cost.get("missing_material_costs", [])) | set(batch.get("extra_consumption_missing_costs", [])))
        total_usage = batch.get("material_usage_g") or _merge_usage(requirements["materials_required_g"], extra_usage)

        batch["material_usage_g"] = {
            name: round(grams, 3)
            for name, grams in total_usage.items()
        }
        batch["material_costs"] = {
            name: round(cost, 3) for name, cost in breakdown.items()
        }
        batch["total_cost"] = round(total_cost, 2)
        batch["costed"] = not missing_materials
        batch["costing_scope"] = "materials_required"
        batch["costing_version"] = 2
        batch["missing_material_costs"] = missing_materials

        if has_children(production.get("batches", []), batch["id"]):
            batch.pop("cost_per_bar", None)
        else:
            bar_count = batch.get("bars_actual") or batch.get("bars_expected")
            if bar_count and bar_count > 0:
                batch["cost_per_bar"] = round(total_cost / float(bar_count), 2)
            else:
                batch.pop("cost_per_bar", None)

        if missing_materials:
            note_line = (
                "Missing inventory cost data for: "
                + ", ".join(missing_materials)
            )
            existing_notes = batch.get("notes", "")
            if note_line not in existing_notes:
                batch["notes"] = f"{existing_notes}\n{note_line}".strip()

        processed += 1

    ctx["production"] = production
    save_yaml(cfg["paths"]["production"], production)

    return {"processed": processed, "skipped": skipped}
