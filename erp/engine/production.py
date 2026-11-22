from copy import deepcopy

try:
    from .costing_domain import cost_material_requirements
    from .config import cfg
    from .inventory_domain import (
        consume_materials_from_inventory,
        denormalize_inventory_from_core,
        normalize_inventory_for_core,
    )
    from .loader import save_yaml
    from .production_domain import (
        append_event,
        ensure_iso_date,
        ensure_leaf_batch,
        generate_child_batch_id,
        get_batch,
        normalize_inventory_meta,
        normalize_production_document,
        normalize_batch_record,
        validate_child_allocation,
    )
    from .storage.recipes import resolve_base_recipe_for_id
except ImportError:
    from costing_domain import cost_material_requirements
    from config import cfg
    from inventory_domain import (
        consume_materials_from_inventory,
        denormalize_inventory_from_core,
        normalize_inventory_for_core,
    )
    from loader import save_yaml
    from production_domain import (
        append_event,
        ensure_iso_date,
        ensure_leaf_batch,
        generate_child_batch_id,
        get_batch,
        normalize_inventory_meta,
        normalize_production_document,
        normalize_batch_record,
        validate_child_allocation,
    )
    from storage.recipes import resolve_base_recipe_for_id


def _save_production(ctx, production_doc):
    normalized = normalize_production_document(production_doc)
    ctx["production"] = normalized
    save_yaml(cfg["paths"]["production"], normalized)
    return normalized


def _save_inventory(ctx, inventory_doc):
    ctx["inventory"] = inventory_doc
    save_yaml(cfg["paths"]["inventory"], inventory_doc)
    return inventory_doc


def _save_inventory_meta(ctx, inventory_meta_doc):
    normalized = normalize_inventory_meta(inventory_meta_doc)
    ctx["inventory_meta"] = normalized
    save_yaml(cfg["paths"]["inventory_meta"], normalized)
    return normalized


def _merge_usage(existing_usage, new_usage):
    merged = {
        str(material): float(grams)
        for material, grams in (existing_usage or {}).items()
    }

    for material, grams in (new_usage or {}).items():
        merged[str(material)] = merged.get(str(material), 0.0) + float(grams)

    return merged


def _notes_with(existing_notes, notes):
    if not notes:
        return existing_notes
    if not existing_notes:
        return notes
    return f"{existing_notes}\n{notes}"


def _resolved_recipe_refs(recipe_id, base_recipes, product_recipes):
    base_recipe, product_recipe = resolve_base_recipe_for_id(
        recipe_id,
        base_recipes=base_recipes,
        product_recipes=product_recipes,
    )
    return {
        "recipe_id": product_recipe["id"] if product_recipe else base_recipe["id"],
        "base_recipe_id": base_recipe["id"],
        "product_recipe_id": product_recipe["id"] if product_recipe else None,
    }


def record_batch_event(ctx, batch_id, event_type, *, at=None, notes=None):
    allowed_event_types = {
        "poured",
        "unmolded",
        "cut",
        "cure_started",
        "cure_completed",
        "shredded",
    }
    if event_type not in allowed_event_types:
        raise ValueError(f"Unsupported lifecycle event: {event_type}")

    production_doc = normalize_production_document(ctx.get("production"))
    batches = production_doc["batches"]
    batch = get_batch(batches, batch_id)

    if batch.get("status") == "shredded" and event_type == "poured":
        raise ValueError(
            "Create a child batch for French-milled re-pours instead of pouring the same batch again"
        )

    append_event(batch, event_type, at=at, notes=notes)
    _save_production(ctx, production_doc)

    return {
        "batch_id": batch_id,
        "status": batch["status"],
        "event_type": event_type,
        "event_at": batch["events"][-1]["at"],
    }


def create_child_batch(
    ctx,
    parent_batch_id,
    oil_weight_g,
    *,
    recipe_id=None,
    batch_id=None,
    notes=None,
    at=None,
):
    production_doc = normalize_production_document(ctx.get("production"))
    batches = production_doc["batches"]
    parent = get_batch(batches, parent_batch_id)

    requested_oil_weight_g = float(oil_weight_g)
    if requested_oil_weight_g <= 0:
        raise ValueError("Child batch oil_weight_g must be > 0")

    resolved_at = ensure_iso_date(at)
    validate_child_allocation(batches, parent_batch_id, requested_oil_weight_g)

    if recipe_id is None:
        child_recipe_refs = {
            "recipe_id": parent.get("recipe_id") or parent.get("base_recipe_id"),
            "base_recipe_id": parent.get("base_recipe_id"),
            "product_recipe_id": parent.get("product_recipe_id"),
        }
    else:
        child_recipe_refs = _resolved_recipe_refs(
            recipe_id,
            ctx["recipes_base"]["base_recipes"],
            ctx["recipes_product"]["product_recipes"],
        )
        if child_recipe_refs["base_recipe_id"] != parent.get("base_recipe_id"):
            raise ValueError(
                "Child batch recipe must resolve to the same base recipe as its parent"
            )

    child_id = batch_id or generate_child_batch_id(batches, parent_batch_id)
    if any(batch.get("id") == child_id for batch in batches):
        raise ValueError(f"Batch already exists: {child_id}")

    child = normalize_batch_record(
        {
            "id": child_id,
            "parent_batch_id": parent_batch_id,
            "date": resolved_at,
            **child_recipe_refs,
            "oil_weight_g": requested_oil_weight_g,
            "status": "planned",
            "extra_material_usage_g": {},
            "inventory_deducted": False,
        }
    )
    if notes:
        child["notes"] = notes

    batches.append(child)
    child_note = f"Created child batch {child_id}"
    if notes:
        child_note = f"{child_note}: {notes}"
    append_event(parent, "child_created", at=resolved_at, notes=child_note)

    _save_production(ctx, production_doc)
    return deepcopy(child)


def record_child_materials(ctx, batch_id, materials, *, at=None, notes=None):
    production_doc = normalize_production_document(ctx.get("production"))
    batches = production_doc["batches"]
    batch = get_batch(batches, batch_id)

    if not batch.get("parent_batch_id"):
        raise ValueError("Child materials can only be recorded against child batches")

    parsed_materials = {
        str(material): float(grams)
        for material, grams in (materials or {}).items()
        if float(grams) != 0
    }
    if not parsed_materials:
        raise ValueError("No child materials supplied")

    inventory_state = normalize_inventory_for_core(
        ctx["inventory"],
        units_cfg=ctx["units"],
        density_cfg=ctx.get("density"),
    )
    consumption = consume_materials_from_inventory(
        inventory_state=inventory_state,
        materials_required_g=parsed_materials,
    )
    updated_inventory = denormalize_inventory_from_core(
        inventory_state=consumption.inventory_state,
        original_inventory_doc=ctx["inventory"],
        units_cfg=ctx["units"],
        density_cfg=ctx.get("density"),
    )

    resolved_at = ensure_iso_date(at)
    batch["extra_material_usage_g"] = _merge_usage(
        batch.get("extra_material_usage_g"),
        consumption.consumed_materials_g,
    )
    basis = cost_material_requirements(parsed_materials, ctx["inventory"], units_cfg=ctx["units"], density_cfg=ctx.get("density"))
    costs = batch.setdefault("extra_consumption_costs", {})
    for material, value in basis["breakdown"].items():
        costs[material] = costs.get(material, 0) + value
    batch["extra_consumption_missing_costs"] = sorted(set(batch.get("extra_consumption_missing_costs", [])) | set(basis["missing_materials"]))
    batch["inventory_deducted"] = True
    batch["inventory_deducted_at"] = batch.get("inventory_deducted_at") or resolved_at
    if notes:
        batch["notes"] = _notes_with(batch.get("notes"), notes)

    if not batch.get("prepped_at"):
        append_event(batch, "prepped", at=resolved_at, notes=notes)

    _save_inventory(ctx, updated_inventory)
    _save_production(ctx, production_doc)

    return {
        "batch_id": batch_id,
        "status": batch["status"],
        "extra_material_usage_g": deepcopy(batch["extra_material_usage_g"]),
    }


def record_cut_yield(
    ctx,
    batch_id,
    size_counts,
    *,
    scrap_g=0.0,
    shredded_g=0.0,
    at=None,
    notes=None,
):
    production_doc = normalize_production_document(ctx.get("production"))
    batches = production_doc["batches"]
    batch = get_batch(batches, batch_id)
    ensure_leaf_batch(batches, batch_id)

    active_sizes = {
        size
        for size, record in (ctx.get("bar_sizes") or {}).items()
        if record.get("active", True)
    }
    if not active_sizes:
        raise ValueError("No active bar sizes configured")

    normalized_counts = {}
    for size, count in (size_counts or {}).items():
        normalized_size = str(size)
        if normalized_size not in active_sizes:
            raise ValueError(f"Unknown or inactive bar size: {normalized_size}")

        normalized_count = int(count)
        if normalized_count < 0:
            raise ValueError(f"Invalid yield count for {normalized_size}: {count}")
        normalized_counts[normalized_size] = normalized_count

    resolved_at = ensure_iso_date(at)
    batch["yield_actual"] = {
        "recorded_at": resolved_at,
        "size_counts": normalized_counts,
        "scrap_g": float(scrap_g),
        "shredded_g": float(shredded_g),
    }
    batch["bars_actual"] = sum(normalized_counts.values())
    if notes:
        batch["notes"] = _notes_with(batch.get("notes"), notes)

    if not batch.get("cut_at"):
        append_event(batch, "cut", at=resolved_at, notes=notes)

    _save_production(ctx, production_doc)

    return {
        "batch_id": batch_id,
        "bars_actual": batch["bars_actual"],
        "yield_actual": deepcopy(batch["yield_actual"]),
    }


def post_finished_goods(ctx, batch_id, *, at=None):
    production_doc = normalize_production_document(ctx.get("production"))
    batches = production_doc["batches"]
    batch = get_batch(batches, batch_id)
    ensure_leaf_batch(batches, batch_id)

    if not batch.get("cure_completed_at"):
        raise ValueError(f"Batch {batch_id} must be cured before posting finished goods")

    yield_actual = batch.get("yield_actual") or {}
    size_counts = yield_actual.get("size_counts") or {}
    if not size_counts:
        raise ValueError(f"Batch {batch_id} is missing cut yield data")

    cost_per_bar = batch.get("cost_per_bar")
    if cost_per_bar is None or batch.get("missing_material_costs"):
        raise ValueError(f"Batch {batch_id} must be costed before posting finished goods")

    inventory_meta_doc = normalize_inventory_meta(ctx.get("inventory_meta"))
    post_id = f"FGP-{batch_id}"
    if post_id in inventory_meta_doc["applied_finished_goods_posts"]:
        return {
            "batch_id": batch_id,
            "status": "skipped",
            "reason": "finished goods already posted",
            "post_id": post_id,
        }

    recipe_key = batch.get("product_recipe_id") or batch.get("base_recipe_id")
    if not recipe_key:
        raise ValueError(f"Batch {batch_id} is missing recipe identifiers for finished goods")

    inventory_doc = deepcopy(ctx["inventory"])
    finished_goods = inventory_doc.setdefault("finished_goods", {})
    posted_items = {}

    for size, count in size_counts.items():
        if int(count) <= 0:
            continue

        item_key = f"{recipe_key}.{size}"
        record = finished_goods.setdefault(item_key, {"unit": "bar", "on_hand": 0})
        on_hand = float(record.get("on_hand", 0.0))
        prior_cost = float(
            record.get("avg_cost_per_unit", record.get("cost_per_unit", 0.0) or 0.0)
        )
        new_on_hand = on_hand + int(count)
        weighted_cost = (
            ((on_hand * prior_cost) + (int(count) * float(cost_per_bar))) / new_on_hand
            if new_on_hand > 0
            else float(cost_per_bar)
        )

        record["unit"] = "bar"
        record["on_hand"] = int(new_on_hand)
        record["avg_cost_per_unit"] = round(weighted_cost, 4)
        if "cost_per_unit" in record:
            record["cost_per_unit"] = round(weighted_cost, 4)

        posted_items[item_key] = int(count)

    if not posted_items:
        raise ValueError(f"Batch {batch_id} has no positive finished goods to post")

    resolved_at = ensure_iso_date(at)
    append_event(batch, "posted_to_inventory", at=resolved_at)
    inventory_meta_doc["applied_finished_goods_posts"].append(post_id)

    _save_inventory(ctx, inventory_doc)
    _save_inventory_meta(ctx, inventory_meta_doc)
    _save_production(ctx, production_doc)

    return {
        "batch_id": batch_id,
        "status": batch["status"],
        "post_id": post_id,
        "posted_items": posted_items,
    }


class ProductionEngine:
    def __init__(self, inventory):
        self.inventory = inventory

    def run_batch(self, batch):
        total_cost = 0.0

        for material, grams in batch["materials"].items():
            item = self.inventory.get(material)
            cost = item.consume(grams)
            total_cost += cost

        return round(total_cost, 2)
