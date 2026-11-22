from loader import load_all, save_yaml
from config import cfg
from receipt_normalization import normalize_receipt

def post_receipts_to_transactions(ctx):
    for r in ctx["receipts"]["receipts"]:
        r = normalize_receipt(r)
        for item in r["items"]:
            ctx["transactions"].setdefault("transactions", []).append({
                "date": r["date"],
                "description": item["name"],
                "debit": item["account"],
                "credit": "cash",
                "amount": item["total"]
            })

    save_yaml(cfg["paths"]["transactions"], ctx["transactions"])
