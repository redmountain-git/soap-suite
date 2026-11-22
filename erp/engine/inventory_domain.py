from dataclasses import dataclass
from copy import deepcopy

try:
    from .receipt_normalization import normalize_receipt
    from .unit_factors import (
        cost_per_g_to_cost_per_unit,
        grams_to_unit_quantity,
        mass_unit_to_g_factor,
        material_unit_to_g_factor,
    )
except ImportError:
    from receipt_normalization import normalize_receipt
    from unit_factors import (
        cost_per_g_to_cost_per_unit,
        grams_to_unit_quantity,
        mass_unit_to_g_factor,
        material_unit_to_g_factor,
    )


@dataclass
class InventoryUpdateResult:
    inventory_state: dict
    applied_receipt_ids: list
    processed_receipt_ids: list
    skipped_receipt_ids: list


@dataclass
class InventoryConsumptionResult:
    inventory_state: dict
    consumed_materials_g: dict


def apply_receipts_to_inventory(
    inventory_state,
    receipts,
    applied_receipt_ids,
    unit_converter,
):
    updated_inventory = deepcopy(inventory_state)
    applied_order = [rid for rid in (applied_receipt_ids or []) if rid is not None]
    applied_set = set(applied_order)
    processed_ids = []
    skipped_ids = []

    for receipt in receipts:
        receipt = normalize_receipt(receipt)
        receipt_id = receipt.get("id")

        if receipt_id in applied_set:
            skipped_ids.append(receipt_id)
            continue

        for item in receipt.get("items", []):
            material = item.get("material")

            # Skip non-material lines like tax.
            if not material:
                continue

            quantity = item["quantity"]
            unit = item["unit"]
            cost = item["total"]

            if quantity <= 0:
                raise ValueError(f"Invalid quantity on {receipt_id}: {quantity}")

            if cost < 0:
                raise ValueError(f"Invalid cost on {receipt_id}: {cost}")

            grams = unit_converter.to_grams(
                material=material,
                quantity=quantity,
                unit=unit,
            )

            slot = updated_inventory.setdefault(
                material,
                {
                    "on_hand_g": 0.0,
                    "cost_per_g": 0.0,
                },
            )

            old_qty = float(slot["on_hand_g"])
            old_cost = float(slot["cost_per_g"])
            new_qty = old_qty + grams
            new_cost = ((old_qty * old_cost) + cost) / new_qty

            slot["on_hand_g"] = new_qty
            slot["cost_per_g"] = new_cost

        if receipt_id is not None and receipt_id not in applied_set:
            applied_set.add(receipt_id)
            applied_order.append(receipt_id)
            processed_ids.append(receipt_id)

    return InventoryUpdateResult(
        inventory_state=updated_inventory,
        applied_receipt_ids=applied_order,
        processed_receipt_ids=processed_ids,
        skipped_receipt_ids=skipped_ids,
    )


def consume_materials_from_inventory(
    inventory_state,
    materials_required_g,
    material_aliases=None,
):
    updated_inventory = deepcopy(inventory_state)
    aliases = material_aliases or {}
    shortages = []
    requested_materials = []

    for material, grams in (materials_required_g or {}).items():
        required_g = float(grams)

        if required_g < 0:
            raise ValueError(f"Invalid required quantity for {material}: {grams}")

        if required_g == 0:
            continue

        inventory_material = aliases.get(material, material)
        slot = updated_inventory.get(inventory_material)
        on_hand_g = float(slot["on_hand_g"]) if slot else 0.0

        if on_hand_g + 1e-9 < required_g:
            shortages.append(
                f"{material} needs {round(required_g, 3)} g, has {round(on_hand_g, 3)} g"
            )
            continue

        requested_materials.append((material, inventory_material, required_g))

    if shortages:
        raise ValueError(
            "Insufficient inventory for prep: " + "; ".join(shortages)
        )

    consumed = {}
    for material, inventory_material, required_g in requested_materials:
        slot = updated_inventory[inventory_material]
        remaining_g = float(slot["on_hand_g"]) - required_g
        slot["on_hand_g"] = 0.0 if abs(remaining_g) < 1e-9 else remaining_g
        consumed[material] = required_g

    return InventoryConsumptionResult(
        inventory_state=updated_inventory,
        consumed_materials_g=consumed,
    )


def normalize_inventory_for_core(inventory_doc, units_cfg=None, density_cfg=None):
    state = {}

    for section_name in ("raw_materials", "additives", "finished_goods"):
        section = inventory_doc.get(section_name, {})

        for material, record in section.items():
            unit = record.get("unit")
            on_hand = float(record.get("on_hand", 0.0))
            factor = material_unit_to_g_factor(material, unit, units_cfg, density_cfg)

            if not factor:
                # Skip non-mass inventory (for example finished goods in bars).
                continue

            on_hand_g = on_hand * factor
            cost_per_unit = float(record.get("avg_cost_per_unit", 0.0))
            cost_per_g = cost_per_unit / factor

            state[material] = {
                "on_hand_g": on_hand_g,
                "cost_per_g": cost_per_g,
            }

    return state


def denormalize_inventory_from_core(inventory_state, original_inventory_doc, units_cfg=None, density_cfg=None):
    updated_doc = deepcopy(original_inventory_doc)
    updated_doc.setdefault("raw_materials", {})
    updated_doc.setdefault("additives", {})
    updated_doc.setdefault("finished_goods", {})

    for material, state in inventory_state.items():
        if material in updated_doc["raw_materials"]:
            section = updated_doc["raw_materials"]
        elif material in updated_doc["additives"]:
            section = updated_doc["additives"]
        elif material in updated_doc["finished_goods"]:
            section = updated_doc["finished_goods"]
        else:
            section = updated_doc["raw_materials"]
            section[material] = {"unit": "g"}

        record = section[material]
        unit = record.get("unit", "g")
        on_hand_g = float(state["on_hand_g"])
        cost_per_g = float(state["cost_per_g"])
        factor = material_unit_to_g_factor(material, unit, units_cfg, density_cfg)

        if not factor:
            record["unit"] = "g"
            record["on_hand"] = on_hand_g
            record["avg_cost_per_unit"] = cost_per_g
            continue

        record["on_hand"] = on_hand_g / factor
        record["avg_cost_per_unit"] = cost_per_g * factor

    return updated_doc
