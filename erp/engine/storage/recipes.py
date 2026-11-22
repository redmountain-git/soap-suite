import yaml
from pathlib import Path

try:
    from ..config import cfg, resolve_path
except ImportError:
    from config import cfg, resolve_path


def _load_recipe_file(path, root_key):
    if not path.exists():
        return []

    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    return data.get(root_key, [])


def load_base_recipes():
    return _load_recipe_file(Path(resolve_path(cfg["paths"]["recipes"]["base"])), "base_recipes")


def load_product_recipes():
    return _load_recipe_file(Path(resolve_path(cfg["paths"]["recipes"]["product"])), "product_recipes")


def load_recipes():
    # Backwards-compatible alias used by current CLI code.
    return load_base_recipes()


def _get_by_id(items, recipe_id, kind):
    for item in items:
        if item.get("id") == recipe_id:
            return item

    raise ValueError(f"{kind} not found: {recipe_id}")


def get_base_recipe(recipe_id, base_recipes=None):
    recipes = base_recipes if base_recipes is not None else load_base_recipes()
    return _get_by_id(recipes, recipe_id, "Base recipe")


def get_product_recipe(recipe_id, product_recipes=None):
    recipes = (
        product_recipes if product_recipes is not None else load_product_recipes()
    )
    return _get_by_id(recipes, recipe_id, "Product recipe")


def get_recipe(recipe_id):
    # Backwards-compatible alias.
    return get_base_recipe(recipe_id)


def resolve_base_recipe_for_id(recipe_id, base_recipes=None, product_recipes=None):
    if recipe_id.startswith("BSR-"):
        base = get_base_recipe(recipe_id, base_recipes=base_recipes)
        return base, None

    if recipe_id.startswith("PR-"):
        product = get_product_recipe(recipe_id, product_recipes=product_recipes)
        base = get_base_recipe(product["base_recipe_id"], base_recipes=base_recipes)
        return base, product

    # Fallback: try base first, then product.
    try:
        base = get_base_recipe(recipe_id, base_recipes=base_recipes)
        return base, None
    except ValueError:
        product = get_product_recipe(recipe_id, product_recipes=product_recipes)
        base = get_base_recipe(product["base_recipe_id"], base_recipes=base_recipes)
        return base, product
