import jsonschema
import json

try:
    from .config import cfg, resolve_path
    from .loader import load_yaml
except ImportError:
    from config import cfg, resolve_path
    from loader import load_yaml

def validate_yaml(data, schema_path):
    schema = json.loads(resolve_path(schema_path).read_text(encoding="utf-8"))
    jsonschema.validate(data, schema, format_checker=jsonschema.FormatChecker())

def validate_all():
    validate_yaml(load_yaml(cfg["paths"]["receipts"]),
                  cfg["schemas"]["receipts"])
    validate_yaml(load_yaml(cfg["paths"]["inventory"]),
                  cfg["schemas"]["inventory"])
    validate_yaml(load_yaml(cfg["paths"]["production"]),
                  cfg["schemas"]["production"])
    validate_yaml(load_yaml(cfg["paths"]["bar_sizes"]),
                  cfg["schemas"]["bar_sizes"])
    validate_yaml(load_yaml(cfg["paths"]["recipes"]["base"]),
                  cfg["schemas"]["recipes"])
    validate_yaml(load_yaml(cfg["paths"]["recipes"]["product"]),
                  cfg["schemas"]["recipes"])
    validate_yaml(load_yaml(cfg["paths"]["transactions"]),
                  cfg["schemas"]["transactions"])
