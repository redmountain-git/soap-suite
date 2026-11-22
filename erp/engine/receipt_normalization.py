from copy import deepcopy
import math
import re


def normalize_receipt(receipt):
    result = deepcopy(receipt)
    items = result.get("items", [])
    for item in items:
        if item.get("total") is not None and item.get("amount_usd") is not None and abs(item["total"] - item["amount_usd"]) > 1e-6:
            raise ValueError("Conflicting receipt line amounts")
        amount = item.get("total", item.get("amount_usd"))
        if not isinstance(amount, (float, int)) or not math.isfinite(amount) or amount < 0:
            raise ValueError(f"Invalid cost on {result.get('id', 'receipt')}: {amount}")
        item["total"] = amount
        item.pop("amount_usd", None)
        if item.get("material") and (not item.get("unit") or not math.isfinite(float(item.get("quantity", 0))) or float(item.get("quantity", 0)) <= 0):
            raise ValueError(f"Invalid quantity on {result.get('id', 'receipt')}: material quantity and unit are required")
    explicit_tax = any(re.search(r"(^|[._\s])tax(es)?($|[._\s])", " ".join(str(item.get(k, "")) for k in ("category", "account", "name")), re.I) for item in items)
    tax = float(result.get("tax_usd", 0))
    if not math.isfinite(tax) or tax < 0:
        raise ValueError("Invalid receipt tax")
    expected = round(sum(item["total"] for item in items) + (0 if explicit_tax else tax), 2)
    if "total" in result and "total_usd" in result and abs(result["total"] - result["total_usd"]) > 1e-6:
        raise ValueError("Conflicting receipt totals")
    total = result.get("total", result.get("total_usd", expected))
    if not math.isfinite(float(total)) or abs(total - expected) > .011:
        raise ValueError("Receipt total does not match lines and tax")
    result["total"] = expected
    result.pop("total_usd", None)
    return result
