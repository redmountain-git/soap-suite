"""Read-only interchange export for reviewed browser reconstruction."""
from copy import deepcopy


def export_history(ctx):
    constants = {}
    for name in ("units", "density", "sap_values"):
        value = ctx.get(name, {})
        constants[name] = deepcopy(value.get(name, value))
    return {
        "version": 1,
        "constants": constants,
        "inventory": deepcopy(ctx["inventory"]),
        "receipts": deepcopy(ctx["receipts"]["receipts"]),
        "batches": deepcopy(ctx["production"]["batches"]),
        "base_recipes": deepcopy(ctx["recipes_base"]["base_recipes"]),
        "product_recipes": deepcopy(ctx["recipes_product"]["product_recipes"]),
        "bar_sizes": deepcopy(ctx["bar_sizes"]),
        "assets": [],
        "legacy_inventory_meta": deepcopy(ctx.get("inventory_meta", {})),
    }
