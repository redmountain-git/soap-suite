from copy import deepcopy
from datetime import date


STATUS_VALUES = (
    "planned",
    "prepped",
    "poured",
    "unmolded",
    "cut",
    "curing",
    "cured",
    "shredded",
    "in_inventory",
)

EVENT_TYPES = (
    "prepped",
    "poured",
    "unmolded",
    "cut",
    "cure_started",
    "cure_completed",
    "shredded",
    "child_created",
    "posted_to_inventory",
)

EVENT_STATUS_MAP = {
    "prepped": "prepped",
    "poured": "poured",
    "unmolded": "unmolded",
    "cut": "cut",
    "cure_started": "curing",
    "cure_completed": "cured",
    "shredded": "shredded",
    "posted_to_inventory": "in_inventory",
}

EVENT_MILESTONE_MAP = {
    "prepped": "prepped_at",
    "poured": "poured_at",
    "unmolded": "unmolded_at",
    "cut": "cut_at",
    "cure_started": "cure_started_at",
    "cure_completed": "cure_completed_at",
    "shredded": "shredded_at",
    "posted_to_inventory": "posted_to_inventory_at",
}

MILESTONE_FIELDS = (
    "prepped_at",
    "poured_at",
    "unmolded_at",
    "cut_at",
    "cure_started_at",
    "cure_completed_at",
    "shredded_at",
    "posted_to_inventory_at",
)


def today_iso():
    return date.today().isoformat()


def ensure_iso_date(value):
    if value is None:
        return today_iso()
    return date.fromisoformat(str(value)).isoformat()


def _normalize_event(event):
    normalized = {
        "type": str(event["type"]),
        "at": ensure_iso_date(event["at"]),
    }

    if normalized["type"] not in EVENT_TYPES:
        raise ValueError(f"Unknown production event type: {normalized['type']}")

    notes = event.get("notes")
    if notes:
        normalized["notes"] = str(notes)

    return normalized


def _normalize_yield_actual(yield_actual):
    if yield_actual is None:
        return None

    size_counts = {
        str(size): int(count)
        for size, count in (yield_actual.get("size_counts") or {}).items()
    }

    return {
        "recorded_at": ensure_iso_date(yield_actual.get("recorded_at")),
        "size_counts": size_counts,
        "scrap_g": float(yield_actual.get("scrap_g", 0.0)),
        "shredded_g": float(yield_actual.get("shredded_g", 0.0)),
    }


def normalize_batch_record(batch):
    normalized = deepcopy(batch)

    normalized.setdefault(
        "recipe_id",
        normalized.get("product_recipe_id") or normalized.get("base_recipe_id"),
    )
    normalized.setdefault("base_recipe_id", None)
    normalized.setdefault("product_recipe_id", None)
    normalized.setdefault("parent_batch_id", None)
    normalized.setdefault("status", "planned")
    normalized.setdefault("extra_material_usage_g", {})
    normalized.setdefault("material_usage_g", normalized.get("material_usage_g", {}))
    normalized.setdefault("inventory_deducted", False)
    normalized.setdefault("inventory_deducted_at", None)
    normalized.setdefault("events", [])

    if normalized.get("status") not in STATUS_VALUES:
        raise ValueError(f"Unknown batch status: {normalized.get('status')}")

    if normalized.get("date") is not None:
        normalized["date"] = ensure_iso_date(normalized["date"])

    if normalized.get("inventory_deducted_at") is not None:
        normalized["inventory_deducted_at"] = ensure_iso_date(
            normalized["inventory_deducted_at"]
        )

    for field in MILESTONE_FIELDS:
        if normalized.get(field) is None:
            normalized[field] = None
        else:
            normalized[field] = ensure_iso_date(normalized[field])

    normalized["events"] = [_normalize_event(event) for event in normalized["events"]]

    normalized["extra_material_usage_g"] = {
        str(material): float(grams)
        for material, grams in (normalized.get("extra_material_usage_g") or {}).items()
    }
    normalized["material_usage_g"] = {
        str(material): float(grams)
        for material, grams in (normalized.get("material_usage_g") or {}).items()
    }

    normalized["yield_actual"] = _normalize_yield_actual(normalized.get("yield_actual"))

    if normalized.get("oil_weight_g") is not None:
        normalized["oil_weight_g"] = float(normalized["oil_weight_g"])

    if normalized.get("bars_expected") is not None:
        normalized["bars_expected"] = int(normalized["bars_expected"])

    if normalized.get("bars_actual") is not None:
        normalized["bars_actual"] = int(normalized["bars_actual"])

    return normalized


def normalize_production_document(production_doc):
    normalized = deepcopy(production_doc or {})
    normalized.setdefault("batches", [])
    normalized["batches"] = [
        normalize_batch_record(batch) for batch in normalized.get("batches", [])
    ]
    return normalized


def normalize_inventory_meta(meta_doc):
    normalized = deepcopy(meta_doc or {})
    normalized.setdefault("applied_receipts", [])
    normalized.setdefault("applied_finished_goods_posts", [])
    return normalized


def get_batch_index(batches, batch_id):
    for index, batch in enumerate(batches):
        if batch.get("id") == batch_id:
            return index
    raise ValueError(f"Batch not found: {batch_id}")


def get_batch(batches, batch_id):
    return batches[get_batch_index(batches, batch_id)]


def list_child_batches(batches, parent_batch_id):
    return [batch for batch in batches if batch.get("parent_batch_id") == parent_batch_id]


def has_children(batches, batch_id):
    return any(batch.get("parent_batch_id") == batch_id for batch in batches)


def ensure_leaf_batch(batches, batch_id):
    if has_children(batches, batch_id):
        raise ValueError(f"Batch {batch_id} has child batches and is not a leaf batch")


def append_event(batch, event_type, *, at=None, notes=None):
    if event_type not in EVENT_TYPES:
        raise ValueError(f"Unknown production event type: {event_type}")

    event_date = ensure_iso_date(at)
    event = {"type": event_type, "at": event_date}
    if notes:
        event["notes"] = str(notes)

    batch.setdefault("events", []).append(event)

    milestone_field = EVENT_MILESTONE_MAP.get(event_type)
    if milestone_field:
        batch[milestone_field] = event_date

    if event_type in EVENT_STATUS_MAP:
        batch["status"] = EVENT_STATUS_MAP[event_type]

    return event


def generate_child_batch_id(batches, parent_batch_id):
    seq = 1
    while True:
        candidate = f"{parent_batch_id}-C{seq:02d}"
        if not any(batch.get("id") == candidate for batch in batches):
            return candidate
        seq += 1


def validate_child_allocation(batches, parent_batch_id, oil_weight_g, exclude_batch_id=None):
    parent = get_batch(batches, parent_batch_id)
    allocated = 0.0

    for child in list_child_batches(batches, parent_batch_id):
        if exclude_batch_id and child.get("id") == exclude_batch_id:
            continue
        allocated += float(child.get("oil_weight_g", 0.0))

    if allocated + float(oil_weight_g) > float(parent["oil_weight_g"]) + 1e-9:
        raise ValueError(
            f"Child allocation exceeds parent oils for {parent_batch_id}: "
            f"{round(allocated + float(oil_weight_g), 3)} g allocated vs "
            f"{round(float(parent['oil_weight_g']), 3)} g available"
        )


def topological_batches_by_lineage(batches):
    ordered = []
    remaining = {batch["id"]: deepcopy(batch) for batch in batches}
    all_ids = set(remaining)

    while remaining:
        progressed = False

        for batch_id, batch in list(remaining.items()):
            parent_batch_id = batch.get("parent_batch_id")
            if parent_batch_id is not None and parent_batch_id not in all_ids:
                raise ValueError(f"Batch {batch_id} references missing parent {parent_batch_id}")

            if parent_batch_id is None or parent_batch_id not in remaining:
                ordered.append(batch)
                del remaining[batch_id]
                progressed = True

        if not progressed:
            unresolved = ", ".join(sorted(remaining))
            raise ValueError(f"Cycle or missing parent detected in production batches: {unresolved}")

    return ordered
