import yaml

try:
    from .config import cfg, resolve_path
except ImportError:
    from config import cfg, resolve_path




def load_units():
    with open(resolve_path(cfg["paths"]["constants"]["units"]), "r", encoding="utf-8") as f:
        return yaml.safe_load(f)
    
def load_sap_values():
    with open(resolve_path(cfg["paths"]["constants"]["sap_values"]), "r", encoding="utf-8") as f:
        return yaml.safe_load(f)
    
def load_densities():
    with open(resolve_path(cfg["paths"]["constants"]["density"]), "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

units = load_units()
sap_values = load_sap_values()
densities = load_densities()
