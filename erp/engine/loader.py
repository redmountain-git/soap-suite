import yaml

try:
    from .config import cfg, resolve_path
    from .production_domain import normalize_inventory_meta, normalize_production_document
except ImportError:
    from config import cfg, resolve_path
    from production_domain import normalize_inventory_meta, normalize_production_document

class _StringDateSafeLoader(yaml.SafeLoader):
    pass


def _construct_timestamp_as_string(loader, node):
    return loader.construct_scalar(node)


_StringDateSafeLoader.add_constructor(
    "tag:yaml.org,2002:timestamp",
    _construct_timestamp_as_string,
)


def load_yaml(path):
    path_obj = resolve_path(path)

    with open(path_obj, "r", encoding="utf-8") as f:
        return yaml.load(f, Loader=_StringDateSafeLoader) or {}

def save_yaml(path, data):
    path_obj = resolve_path(path)

    with open(path_obj, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False)

def load_all():
    inventory_meta = normalize_inventory_meta(load_yaml(cfg["paths"]["inventory_meta"]))
    production = normalize_production_document(load_yaml(cfg["paths"]["production"]))

    return {
        "recipes_base": load_yaml(cfg["paths"]["recipes"]["base"]),
        "recipes_product": load_yaml(cfg["paths"]["recipes"]["product"]),
        "receipts": load_yaml(cfg["paths"]["receipts"]),
        "inventory": load_yaml(cfg["paths"]["inventory"]),
        "inventory_meta": inventory_meta,
        "production": production,
        "bar_sizes": load_yaml(cfg["paths"]["bar_sizes"]),
        "transactions": load_yaml(cfg["paths"]["transactions"]),
        "density": load_yaml(cfg["paths"]["constants"]["density"]),
        "units": load_yaml(cfg["paths"]["constants"]["units"]),
        "sap_values": load_yaml(cfg["paths"]["constants"]["sap_values"]),
    }
