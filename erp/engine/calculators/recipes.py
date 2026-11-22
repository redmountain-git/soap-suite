# engine/calculators/recipes.py

import yaml
from pathlib import Path

try:
    from ..config import resolve_path
except ImportError:
    from config import resolve_path


def load_base_recipes(path="data/recipes/base_recipes.yaml"):
    path = Path(resolve_path(path))

    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    return data["base_recipes"]


def get_base_recipe(recipe_id, path=None):
    recipes = load_base_recipes() if path is None else load_base_recipes(path)

    for r in recipes:
        if r["id"] == recipe_id:
            return r

    raise ValueError(f"Base recipe not found: {recipe_id}")


def scale_oils(base_recipe, total_oils_g):
    """
    Convert percentages → grams
    """

    oils_pct = base_recipe["oils"]

    scaled = {}

    for oil, pct in oils_pct.items():
        scaled[oil] = round(total_oils_g * (pct / 100), 1)

    return scaled
