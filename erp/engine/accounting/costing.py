# engine/accounting/costing.py

import yaml

try:
    from ..config import cfg, resolve_path
except ImportError:
    from config import cfg, resolve_path


def load_receipts():
    with open(resolve_path(cfg["paths"]["receipts"]), "r", encoding="utf-8") as f:
        return yaml.safe_load(f)["receipts"]


def get_inventory_costs():
    """
    Returns cost per gram for materials
    """

    receipts = load_receipts()

    totals = {}
    quantities = {}

    for r in receipts:
        for item in r["items"]:

            account = item["account"]

            if not account.startswith("assets.inventory"):
                continue

            name = item["name"]

            cost = item["amount_usd"]
            qty = item.get("quantity_g")

            if not qty:
                continue

            totals[name] = totals.get(name, 0) + cost
            quantities[name] = quantities.get(name, 0) + qty

    costs = {}

    for name in totals:
        costs[name] = round(totals[name] / quantities[name], 4)

    return costs


def cost_batch(batch):
    costs = get_inventory_costs()

    total = 0.0
    breakdown = {}

    for oil, grams in batch["oils_grams"].items():

        if oil not in costs:
            continue

        cost = grams * costs[oil]

        breakdown[oil] = round(cost, 2)
        total += cost

    return round(total, 2), breakdown
