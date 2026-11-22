import yaml
from pathlib import Path
from shutil import copytree
from tempfile import mkdtemp

ENGINE_ROOT = Path(__file__).parent
ROOT = ENGINE_ROOT.parent
DEMO_ROOT = ROOT / "demo-data"
_data_root = DEMO_ROOT
_demo = True


def resolve_path(path):
    path_obj = Path(path)
    if path_obj.is_absolute():
        return path_obj
    parts = path_obj.parts
    if parts and parts[0] == "batches":
        return _data_root / path_obj
    if parts and parts[0] == "data" and parts[1:2] != ("constants",):
        return _data_root.joinpath(*(parts[2:] if _demo and parts[1:2] == ("recipes",) else parts[1:]))
    return ROOT / path_obj

def load_config():
    with open(resolve_path("engine/config.yaml"), "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

cfg = load_config()


def configure_dataset(private_dir=None, *, writable=False):
    global _data_root, _demo
    if private_dir is not None:
        path = Path(private_dir)
        if not path.is_absolute() or not path.is_dir():
            raise ValueError("--data-dir must be an existing absolute directory")
        path = path.resolve()
        if path == DEMO_ROOT.resolve() or path.is_relative_to(DEMO_ROOT.resolve()):
            raise ValueError("--data-dir cannot target the shipped demo fixtures")
        required = (
            "inventory.yaml", "inventory_meta.yaml", "production.yaml",
            "bar_sizes.yaml", "receipts.yaml", "transactions.yaml",
            "recipes/base_recipes.yaml", "recipes/product_recipes.yaml",
        )
        missing = [name for name in required if not (path / name).is_file()]
        if missing:
            raise ValueError("--data-dir is missing: " + ", ".join(missing))
        _data_root, _demo = path, False
    elif writable:
        _data_root = Path(mkdtemp(prefix="soap-suite-demo-"))
        copytree(DEMO_ROOT, _data_root, dirs_exist_ok=True)
        _demo = True
    else:
        _data_root, _demo = DEMO_ROOT, True
    return _data_root
