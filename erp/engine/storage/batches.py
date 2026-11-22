# engine/storage/batches.py

import yaml
from pathlib import Path

try:
    from ..config import cfg, resolve_path
except ImportError:
    from config import cfg, resolve_path


def load_batches():
    path = Path(resolve_path(cfg["paths"]["production"]))
    if not path.exists():
        return []

    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f)["batches"]


def get_batch(batch_id):

    batches = load_batches()

    for b in batches:
        if b["id"] == batch_id:
            return b

    raise ValueError(f"Batch not found: {batch_id}")
