from copy import deepcopy
from datetime import date
from pathlib import Path

import yaml

try:
    from .costing_domain import cost_material_requirements
    from .config import ROOT, cfg, resolve_path
    from .inventory_domain import (
        consume_materials_from_inventory,
        denormalize_inventory_from_core,
        normalize_inventory_for_core,
    )
    from .loader import save_yaml
    from .production_domain import (
        append_event,
        normalize_batch_record,
        normalize_production_document,
    )
except ImportError:
    from costing_domain import cost_material_requirements
    from config import ROOT, cfg, resolve_path
    from inventory_domain import (
        consume_materials_from_inventory,
        denormalize_inventory_from_core,
        normalize_inventory_for_core,
    )
    from loader import save_yaml
    from production_domain import (
        append_event,
        normalize_batch_record,
        normalize_production_document,
    )


def resolve_prep_path(prep_ref, prep_dir=None):
    raw_ref = Path(str(prep_ref))
    candidates = []

    if raw_ref.is_absolute():
        candidates.append(raw_ref)
    else:
        candidates.append(Path(resolve_path(str(raw_ref))))

        prep_root = Path(resolve_path(prep_dir or cfg["paths"].get("batch_prep", "batches")))
        candidates.append(prep_root / raw_ref)

        if raw_ref.suffix != ".yaml":
            candidates.append(prep_root / f"{raw_ref}.yaml")

    for candidate in candidates:
        if candidate.exists():
            return candidate

    searched = ", ".join(str(path) for path in candidates)
    raise FileNotFoundError(f"Prep file not found for '{prep_ref}'. Checked: {searched}")


def extract_materials_required_g(prep_doc):
    explicit = prep_doc.get("materials_required_g")
    if explicit:
        return {
            str(material): round(float(grams), 4)
            for material, grams in explicit.items()
            if float(grams) != 0
        }

    materials = {}

    for material, grams in prep_doc.get("oils", {}).items():
        amount_g = float(grams)
        if amount_g:
            materials[str(material)] = round(amount_g, 4)

    lye = prep_doc.get("lye") or {}
    lye_amount_g = float(lye.get("amount_g", 0.0))
    if lye_amount_g:
        materials[str(lye.get("type", "naoh")).lower()] = round(lye_amount_g, 4)

    liquid = prep_doc.get("liquid") or {}
    liquid_amount_g = float(liquid.get("amount_g", 0.0))
    if liquid_amount_g:
        materials[str(liquid["type"])] = round(liquid_amount_g, 4)

    fragrance = prep_doc.get("fragrance") or {}
    fragrance_amount_g = float(fragrance.get("amount_g", 0.0))
    if fragrance_amount_g:
        materials[str(fragrance.get("type", "fragrance_oil"))] = round(
            fragrance_amount_g, 4
        )

    return materials


def extract_parent_materials_required_g(prep_doc):
    materials = {}

    for material, grams in prep_doc.get("oils", {}).items():
        amount_g = float(grams)
        if amount_g:
            materials[str(material)] = round(amount_g, 4)

    lye = prep_doc.get("lye") or {}
    lye_amount_g = float(lye.get("amount_g", 0.0))
    if lye_amount_g:
        materials[str(lye.get("type", "naoh")).lower()] = round(lye_amount_g, 4)

    liquid = prep_doc.get("liquid") or {}
    liquid_amount_g = float(liquid.get("amount_g", 0.0))
    if liquid_amount_g:
        materials[str(liquid["type"])] = round(liquid_amount_g, 4)

    return materials


def build_production_batch_entry(
    prep_doc,
    *,
    prep_path=None,
    applied_on=None,
):
    applied_date = applied_on or date.today().isoformat()
    materials_required_g = extract_parent_materials_required_g(prep_doc)

    entry = normalize_batch_record(
        {
            "id": prep_doc["id"],
            "date": prep_doc.get("date", applied_date),
            "parent_batch_id": None,
            "recipe_id": prep_doc.get("base_recipe_id") or prep_doc.get("recipe_id"),
            "base_recipe_id": prep_doc.get("base_recipe_id"),
            "product_recipe_id": None,
            "oil_weight_g": float(prep_doc["targets"]["total_oils_g"]),
            "total_mass_g": float(prep_doc["targets"]["total_mass_g"]),
            "status": "prepped",
            "material_usage_g": materials_required_g,
            "extra_material_usage_g": {},
            "inventory_deducted": True,
            "inventory_deducted_at": applied_date,
        }
    )

    if prep_doc.get("mold"):
        entry["mold"] = deepcopy(prep_doc["mold"])

    if prep_doc.get("settings"):
        entry["settings"] = deepcopy(prep_doc["settings"])

    if prep_doc.get("fragrance"):
        entry["fragrance"] = deepcopy(prep_doc["fragrance"])

    if prep_path is not None:
        prep_path = Path(prep_path)
        try:
            entry["prep_file"] = prep_path.resolve().relative_to(ROOT.resolve()).as_posix()
        except ValueError:
            entry["prep_file"] = str(prep_path)

    notes = prep_doc.get("notes")
    if notes:
        entry["notes"] = notes

    append_event(entry, "prepped", at=applied_date)
    return entry


def apply_prep_file(ctx, prep_ref, material_aliases=None):
    prep_path = resolve_prep_path(prep_ref)

    with open(prep_path, "r", encoding="utf-8") as handle:
        prep_doc = yaml.safe_load(handle) or {}

    batch_id = prep_doc.get("id")
    if not batch_id:
        raise ValueError(f"Prep file missing batch id: {prep_path}")

    production_doc = normalize_production_document(ctx.setdefault("production", {}))
    production_batches = production_doc.setdefault("batches", [])
    existing_index = next(
        (idx for idx, batch in enumerate(production_batches) if batch.get("id") == batch_id),
        None,
    )
    existing_batch = (
        deepcopy(production_batches[existing_index]) if existing_index is not None else None
    )

    if prep_doc.get("inventory_deducted") or (
        existing_batch and existing_batch.get("inventory_deducted")
    ):
        return {
            "batch_id": batch_id,
            "status": "skipped",
            "reason": "prep already applied",
            "prep_path": str(prep_path),
        }

    materials_required_g = extract_parent_materials_required_g(prep_doc)
    if not materials_required_g:
        raise ValueError(f"Prep file does not define any materials to deduct: {prep_path}")

    inventory_state = normalize_inventory_for_core(
        ctx["inventory"],
        units_cfg=ctx["units"],
        density_cfg=ctx.get("density"),
    )
    consumption = consume_materials_from_inventory(
        inventory_state=inventory_state,
        materials_required_g=materials_required_g,
        material_aliases=material_aliases,
    )

    updated_inventory = denormalize_inventory_from_core(
        inventory_state=consumption.inventory_state,
        original_inventory_doc=ctx["inventory"],
        units_cfg=ctx["units"],
        density_cfg=ctx.get("density"),
    )

    applied_on = date.today().isoformat()
    production_entry = build_production_batch_entry(
        prep_doc,
        prep_path=prep_path,
        applied_on=applied_on,
    )
    cost_basis = cost_material_requirements(materials_required_g, ctx["inventory"], units_cfg=ctx["units"], density_cfg=ctx.get("density"))
    production_entry["consumption_costs"] = cost_basis["breakdown"]
    production_entry["consumption_missing_costs"] = cost_basis["missing_materials"]

    if existing_batch:
        if existing_batch.get("parent_batch_id") is not None:
            raise ValueError(
                f"Prep file batch id {batch_id} already belongs to a child batch record"
            )
        merged_entry = deepcopy(existing_batch)
        existing_events = merged_entry.get("events", [])
        merged_entry.update(production_entry)
        merged_entry["events"] = existing_events or production_entry.get("events", [])
        if not merged_entry.get("prepped_at"):
            append_event(merged_entry, "prepped", at=applied_on)
        production_batches[existing_index] = merged_entry
        production_entry = merged_entry
    else:
        production_batches.append(production_entry)

    ctx["inventory"] = updated_inventory
    save_yaml(cfg["paths"]["inventory"], updated_inventory)

    ctx["production"] = normalize_production_document(production_doc)
    save_yaml(cfg["paths"]["production"], ctx["production"])

    prep_doc["materials_required_g"] = production_entry["material_usage_g"]
    prep_doc["status"] = "prepped"
    prep_doc["inventory_deducted"] = True
    prep_doc["inventory_deducted_at"] = applied_on
    with open(prep_path, "w", encoding="utf-8") as handle:
        yaml.safe_dump(prep_doc, handle, sort_keys=False)

    return {
        "batch_id": batch_id,
        "status": "applied",
        "prep_path": str(prep_path),
        "materials_deducted_g": production_entry["material_usage_g"],
    }
