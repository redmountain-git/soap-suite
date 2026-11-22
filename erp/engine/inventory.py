try:
    from .loader import save_yaml
    from .config import cfg
    from .units import UnitConverter
    from .inventory_domain import (
        apply_receipts_to_inventory,
        denormalize_inventory_from_core,
        normalize_inventory_for_core,
    )
except ImportError:
    from loader import save_yaml
    from config import cfg
    from units import UnitConverter
    from inventory_domain import (
        apply_receipts_to_inventory,
        denormalize_inventory_from_core,
        normalize_inventory_for_core,
    )


def inventory_from_receipts(ctx):
    inventory_doc = ctx["inventory"]
    receipts = ctx["receipts"]["receipts"]
    applied_ids = ctx.get("inventory_meta", {}).get("applied_receipts", [])
    converter = UnitConverter(ctx["units"], ctx["density"])

    inventory_state = normalize_inventory_for_core(
        inventory_doc,
        units_cfg=ctx["units"],
        density_cfg=ctx.get("density"),
    )

    result = apply_receipts_to_inventory(
        inventory_state=inventory_state,
        receipts=receipts,
        applied_receipt_ids=applied_ids,
        unit_converter=converter,
    )

    updated_inventory = denormalize_inventory_from_core(
        inventory_state=result.inventory_state,
        original_inventory_doc=inventory_doc,
        units_cfg=ctx["units"],
        density_cfg=ctx.get("density"),
    )

    ctx["inventory"] = updated_inventory
    ctx.setdefault("inventory_meta", {})
    ctx["inventory_meta"]["applied_receipts"] = result.applied_receipt_ids

    save_yaml(cfg["paths"]["inventory"], updated_inventory)
    save_yaml(cfg["paths"]["inventory_meta"], ctx["inventory_meta"])
