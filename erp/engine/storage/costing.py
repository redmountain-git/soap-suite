# engine/storage/costs.py

import yaml
from pathlib import Path

try:
    from ..config import cfg, resolve_path
except ImportError:
    from config import cfg, resolve_path


def _cost_file():
    cost_path = cfg["paths"].get("costing")
    if not cost_path:
        raise ValueError("Missing config path: paths.costing")
    return Path(resolve_path(cost_path))


def load_costs():
    cost_file = _cost_file()

    if not cost_file.exists():
        return []

    with open(cost_file, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)["costs"]


def get_cost(cost_id):

    costs = load_costs()

    for b in costs:
        if b["id"] == cost_id:
            return b

    raise ValueError(f"cost not found: {cost_id}")
