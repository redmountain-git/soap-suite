import math


def _number(value, label, minimum=0):
    result = float(value)
    if not math.isfinite(result) or result < minimum:
        raise ValueError(f"{label} must be finite and >= {minimum}")
    return result


def _validate_formulation(oils_pct, superfat_pct, lye_ratio, purity_percent):
    for oil, pct in oils_pct.items():
        _number(pct, f"Oil percentage {oil}")
    if abs(sum(oils_pct.values()) - 100) > 1e-6:
        raise ValueError("Oil percentages must sum to 100")
    if not 0 <= _number(superfat_pct, "Superfat") < 100:
        raise ValueError("Superfat must be less than 100")
    if _number(lye_ratio, "Liquid ratio") <= 0 or not 0 < _number(purity_percent, "Purity") <= 100:
        raise ValueError("Liquid ratio and purity must be positive; purity must be <= 100")


try:
    from .storage.batches import get_batch
    from .storage.recipes import (
        load_base_recipes,
        load_product_recipes,
        resolve_base_recipe_for_id,
    )
    from .constants import densities as DENSITY_CFG, units as UNIT_CFG, sap_values as SAP_CFG
except ImportError:
    from storage.batches import get_batch
    from storage.recipes import (
        load_base_recipes,
        load_product_recipes,
        resolve_base_recipe_for_id,
    )
    from constants import densities as DENSITY_CFG, units as UNIT_CFG, sap_values as SAP_CFG


def cuboid_volume_in3(length_in, width_in, height_in):
    return float(length_in) * float(width_in) * float(height_in)


def _unwrap_constants(units_cfg, density_cfg, sap_cfg):
    units_map = units_cfg.get("units", units_cfg)
    density_map = density_cfg.get("density", density_cfg)
    sap_source = sap_cfg.get("sap_values", sap_cfg)
    return units_map, density_map, sap_source


def _resolve_sap_map(sap_source, lye_type="naoh"):
    if isinstance(sap_source.get("sap_values"), dict):
        sap_source = sap_source["sap_values"]

    key = str(lye_type).lower()

    if isinstance(sap_source.get(key), dict):
        return sap_source[key]

    return sap_source


def _fragrance_material_from_product(product_recipe):
    if not product_recipe:
        return "fragrance_oil"

    fragrance = product_recipe.get("fragrance", {})
    fragrance_type = fragrance.get("type")
    if not fragrance_type or fragrance_type == "none":
        return "fragrance_oil"

    material = str(fragrance_type)
    if material.endswith("_optional"):
        material = material.replace("_optional", "")
    return material


def _effective_fragrance(product_recipe, total_oils_g, fragrance_pct=4.0):
    pct = float(fragrance_pct or 0.0)
    if pct <= 0:
        return None

    material = _fragrance_material_from_product(product_recipe)
    amount_g = float(total_oils_g) * (pct / 100.0)
    return {
        "material": material,
        "percent_of_oils": pct,
        "amount_g": amount_g,
    }


def _recipe_fragrance_percent(product_recipe, requested):
    if requested is not None:
        return _number(requested, "Fragrance percentage")
    fragrance = (product_recipe or {}).get("fragrance", {})
    return 0 if fragrance.get("type") == "none" else float(fragrance.get("default_percent", 0))


def _get_density(density_map, material):
    key = str(material).lower()

    if material in density_map:
        return _number(density_map[material], f"Density {material}", 1e-12)

    if key in density_map:
        return _number(density_map[key], f"Density {material}", 1e-12)

    raise ValueError(f"No density for {material}")


def compute_material_requirements_from_oils(
    total_oils_g,
    base_recipe,
    *,
    sap_source,
    product_recipe=None,
    superfat_pct=None,
    lye_ratio=None,
    liquid_type=None,
    fragrance_pct=None,
):
    if base_recipe.get("status") == "draft":
        issues = " ".join(base_recipe.get("review_required", []))
        raise ValueError(f"Recipe {base_recipe.get('id', '')} is a draft. {issues}")
    fragrance_pct = _recipe_fragrance_percent(product_recipe, fragrance_pct)
    oils_pct = base_recipe["oils_pct"]
    lye_type = base_recipe.get("lye", {}).get("type", "naoh")
    sap_map = _resolve_sap_map(sap_source, lye_type=lye_type)
    effective_superfat = (
        superfat_pct
        if superfat_pct is not None
        else base_recipe.get("lye", {}).get("default_superfat_pct", 5)
    )
    effective_liquid = (
        liquid_type
        if liquid_type is not None
        else base_recipe.get("liquid", {}).get("default_type", "water")
    )
    purity = base_recipe.get("lye", {}).get("purity_percent", 100)
    _validate_formulation(oils_pct, effective_superfat, 2.3 if lye_ratio is None else lye_ratio, purity)
    _number(total_oils_g, "Oil weight", 1e-12)
    fragrance_cfg = (product_recipe or {}).get("fragrance", {})
    if fragrance_cfg.get("max_percent") is not None and float(fragrance_pct) > float(fragrance_cfg["max_percent"]):
        raise ValueError("Fragrance exceeds recipe maximum")
    if fragrance_cfg.get("type") == "none" and float(fragrance_pct) > 0:
        raise ValueError("Recipe is fragrance free")
    _number(fragrance_pct, "Fragrance percentage")

    oils_g = {}
    for oil, pct in oils_pct.items():
        oils_g[oil] = float(total_oils_g) * (float(pct) / 100.0)

    lye_theoretical = 0.0
    for oil, grams in oils_g.items():
        if oil not in sap_map:
            raise ValueError(f"No SAP value for {oil}")
        lye_theoretical += grams * _number(sap_map[oil], f"SAP {oil}", 1e-12)

    lye_g = lye_theoretical * (1 - float(effective_superfat) / 100.0) / (float(purity) / 100)
    if lye_ratio is None:
        water_per_oil = base_recipe.get("liquid", {}).get("default_ratio")
        lye_ratio = float(total_oils_g) * _number(water_per_oil, "Liquid/oil ratio", 1e-12) / lye_g if water_per_oil is not None else 2.3
    liquid_g = lye_g * float(lye_ratio)

    fragrance = _effective_fragrance(product_recipe, total_oils_g, fragrance_pct=fragrance_pct)

    materials_required_g = dict(oils_g)
    materials_required_g[str(lye_type).lower()] = lye_g
    materials_required_g[effective_liquid] = liquid_g
    if fragrance:
        materials_required_g[fragrance["material"]] = fragrance["amount_g"]
    for material, pct in base_recipe.get("additives_pct", {}).items():
        materials_required_g[material] = materials_required_g.get(material, 0) + float(total_oils_g) * _number(pct, f"Additive {material}") / 100

    return {
        "oils_g": oils_g,
        "lye_type": str(lye_type).upper(),
        "lye_g": lye_g,
        "liquid_type": effective_liquid,
        "liquid_g": liquid_g,
        "fragrance": fragrance,
        "materials_required_g": materials_required_g,
        "superfat_pct": effective_superfat,
        "lye_ratio": float(lye_ratio),
    }


def calculate_batch_from_data(
    volume_in3,
    oils_pct,
    units_map,
    density_map,
    sap_map,
    superfat_pct=5,
    oil_ratio=0.68,
    lye_ratio=2.3,
    liquid_type="water",
    fragrance_pct=4.0,
    fragrance_material="fragrance_oil",
    additives_pct=None,
    purity_percent=100,
    lye_type="naoh",
):
    _validate_formulation(oils_pct, superfat_pct, lye_ratio, purity_percent)
    _number(volume_in3, "Mold volume", 1e-12)
    _number(fragrance_pct, "Fragrance percentage")
    in3_to_ml = units_map["in3"]["to_ml"]
    oz_to_g = units_map.get("oz", {}).get("to_g", 28.3495)
    volume_ml = volume_in3 * in3_to_ml

    oil_density = 1 / sum((pct / 100.0) / _get_density(density_map, oil) for oil, pct in oils_pct.items())
    total_oils_g = 1.0

    oils = {}
    for oil, pct in oils_pct.items():
        oils[oil] = total_oils_g * (pct / 100.0)

    lye_theoretical = 0.0
    for oil, weight in oils.items():
        if oil not in sap_map:
            raise ValueError(f"No SAP value for {oil}")
        lye_theoretical += weight * _number(sap_map[oil], f"SAP {oil}", 1e-12)

    lye_g = lye_theoretical * (1 - superfat_pct / 100.0) / (float(purity_percent) / 100)
    liquid_density = _get_density(density_map, liquid_type)
    liquid_g = lye_g * lye_ratio
    fragrance_g = total_oils_g * (float(fragrance_pct) / 100.0)
    fragrance_density = _get_density(density_map, fragrance_material) if fragrance_g else 1
    additive_masses = {k: _number(v, f"Additive {k}") / 100 for k, v in (additives_pct or {}).items()}

    oil_mass = sum(oils.values())
    lye_mass = lye_g
    liquid_mass = liquid_g
    fragrance_mass = fragrance_g

    oil_volume = oil_mass / oil_density
    lye_volume = lye_mass / _get_density(density_map, lye_type)
    liquid_volume = liquid_mass / liquid_density
    fragrance_volume = fragrance_mass / fragrance_density

    total_mass = oil_mass + lye_mass + liquid_mass + fragrance_mass + sum(additive_masses.values())
    total_volume_ml = oil_volume + lye_volume + liquid_volume + fragrance_volume + sum(g / _get_density(density_map, k) for k, g in additive_masses.items())

    batter_density = total_mass / total_volume_ml
    true_total_mass = volume_ml * batter_density
    true_oils = volume_ml / total_volume_ml

    oils_final = {}
    for oil, pct in oils_pct.items():
        oils_final[oil] = true_oils * (pct / 100.0)

    lye_theoretical = 0.0
    for oil, weight in oils_final.items():
        lye_theoretical += weight * sap_map[oil]

    lye_final = lye_theoretical * (1 - superfat_pct / 100.0) / (float(purity_percent) / 100)
    liquid_final = lye_final * lye_ratio
    fragrance_final = true_oils * (float(fragrance_pct) / 100.0)
    fragrance_volume_final = fragrance_final / fragrance_density
    fragrance_oz_final = fragrance_final / float(oz_to_g)

    return {
        "volume_in3": round(volume_in3, 2),
        "volume_ml": round(volume_ml, 1),
        "batter_density": round(batter_density, 4),
        "total_mass_g": round(true_total_mass, 4),
        "total_oils_g": round(true_oils, 6),
        "oils_g": {k: round(v, 1) for k, v in oils_final.items()},
        "lye_g": round(lye_final, 1),
        "liquid_g": round(liquid_final, 1),
        "fragrance_pct": float(fragrance_pct),
        "fragrance_material": fragrance_material,
        "fragrance_g": round(fragrance_final, 1),
        "fragrance_ml": round(fragrance_volume_final, 1),
        "fragrance_oz": round(fragrance_oz_final, 3),
        "liquid_type": liquid_type,
        "superfat_pct": superfat_pct,
        "oil_ratio": oil_ratio,
        "calculation_version": 3,
        "warnings": ["oil_ratio is deprecated; complete formulation determines oil fraction"],
    }


def scale_recipe_for_mold_volume(
    volume_in3,
    recipe_id,
    superfat_pct=None,
    oil_ratio=0.68,
    lye_ratio=None,
    liquid_type=None,
    fragrance_pct=None,
    base_recipes=None,
    product_recipes=None,
    constants_bundle=None,
):
    if constants_bundle is None:
        units_cfg, density_cfg, sap_cfg = UNIT_CFG, DENSITY_CFG, SAP_CFG
    else:
        units_cfg = constants_bundle["units"]
        density_cfg = constants_bundle["density"]
        sap_cfg = constants_bundle["sap_values"]

    units_map, density_map, sap_source = _unwrap_constants(
        units_cfg, density_cfg, sap_cfg
    )

    resolved_base_recipes = (
        base_recipes if base_recipes is not None else load_base_recipes()
    )
    resolved_product_recipes = (
        product_recipes if product_recipes is not None else load_product_recipes()
    )

    base_recipe, product_recipe = resolve_base_recipe_for_id(
        recipe_id,
        base_recipes=resolved_base_recipes,
        product_recipes=resolved_product_recipes,
    )

    fragrance_pct = _recipe_fragrance_percent(product_recipe, fragrance_pct)
    requirements = compute_material_requirements_from_oils(
        total_oils_g=1.0,
        base_recipe=base_recipe,
        sap_source=sap_source,
        product_recipe=product_recipe,
        superfat_pct=superfat_pct,
        lye_ratio=lye_ratio,
        liquid_type=liquid_type,
        fragrance_pct=fragrance_pct,
    )
    effective_superfat = requirements["superfat_pct"]
    lye_ratio = requirements["lye_ratio"]
    effective_liquid = requirements["liquid_type"]
    lye_type = requirements["lye_type"]
    sap_map = _resolve_sap_map(sap_source, lye_type=lye_type)

    batch_data = calculate_batch_from_data(
        volume_in3=volume_in3,
        oils_pct=base_recipe["oils_pct"],
        units_map=units_map,
        density_map=density_map,
        sap_map=sap_map,
        superfat_pct=effective_superfat,
        oil_ratio=oil_ratio,
        lye_ratio=lye_ratio,
        liquid_type=effective_liquid,
        fragrance_pct=fragrance_pct,
        fragrance_material=_fragrance_material_from_product(product_recipe),
        additives_pct=base_recipe.get("additives_pct", {}),
        purity_percent=base_recipe.get("lye", {}).get("purity_percent", 100),
        lye_type=str(lye_type).lower(),
    )

    batch_data["base_recipe_id"] = base_recipe["id"]
    batch_data["base_recipe_name"] = base_recipe.get("name")
    batch_data["product_recipe_id"] = product_recipe.get("id") if product_recipe else None
    batch_data["product_recipe_name"] = (
        product_recipe.get("name") if product_recipe else None
    )
    finalized_requirements = compute_material_requirements_from_oils(
        total_oils_g=batch_data["total_oils_g"],
        base_recipe=base_recipe,
        sap_source=sap_source,
        product_recipe=product_recipe,
        superfat_pct=effective_superfat,
        lye_ratio=lye_ratio,
        liquid_type=effective_liquid,
        fragrance_pct=fragrance_pct,
    )

    batch_data["lye_type"] = finalized_requirements["lye_type"]
    batch_data["materials_required_g"] = {
        k: round(v, 4) for k, v in finalized_requirements["materials_required_g"].items()
    }
    if finalized_requirements["fragrance"]:
        batch_data["fragrance"] = {
            "material": finalized_requirements["fragrance"]["material"],
            "percent_of_oils": finalized_requirements["fragrance"]["percent_of_oils"],
            "amount_g": round(finalized_requirements["fragrance"]["amount_g"], 4),
        }

    return batch_data


def batch_volume_from_oils(
    total_oils_g,
    oils_pct,
    density_map,
    sap_map,
    units_map,
    superfat_pct=5,
    lye_ratio=2.3,
    liquid_type="water",
    fragrance_pct=4.0,
    fragrance_material="fragrance_oil",
    additives_pct=None,
    purity_percent=100,
    lye_type="naoh",
):
    _validate_formulation(oils_pct, superfat_pct, lye_ratio, purity_percent)
    _number(total_oils_g, "Oil weight", 1e-12)
    _number(fragrance_pct, "Fragrance percentage")
    oz_to_g = units_map.get("oz", {}).get("to_g", 28.3495)
    oils_g = {}
    for oil, pct in oils_pct.items():
        oils_g[oil] = float(total_oils_g) * (float(pct) / 100.0)

    lye_theoretical = 0.0
    for oil, grams in oils_g.items():
        if oil not in sap_map:
            raise ValueError(f"No SAP value for {oil}")
        lye_theoretical += grams * sap_map[oil]

    lye_g = lye_theoretical * (1 - superfat_pct / 100.0) / (float(purity_percent) / 100)
    liquid_g = lye_g * lye_ratio
    fragrance_g = float(total_oils_g) * (float(fragrance_pct) / 100.0)
    fragrance_density = _get_density(density_map, fragrance_material) if fragrance_g else 1
    additive_masses = {k: float(total_oils_g) * _number(v, f"Additive {k}") / 100 for k, v in (additives_pct or {}).items()}

    oil_volume_ml = 0.0
    for oil, grams in oils_g.items():
        oil_volume_ml += grams / _get_density(density_map, oil)

    lye_volume_ml = lye_g / _get_density(density_map, lye_type)
    liquid_volume_ml = liquid_g / _get_density(density_map, liquid_type)
    fragrance_volume_ml = fragrance_g / fragrance_density
    fragrance_oz = fragrance_g / float(oz_to_g)
    total_volume_ml = oil_volume_ml + lye_volume_ml + liquid_volume_ml + fragrance_volume_ml + sum(g / _get_density(density_map, k) for k, g in additive_masses.items())
    total_mass_g = float(total_oils_g) + lye_g + liquid_g + fragrance_g + sum(additive_masses.values())
    batter_density = total_mass_g / total_volume_ml
    volume_in3 = total_volume_ml / units_map["in3"]["to_ml"]

    return {
        "total_oils_g": round(float(total_oils_g), 1),
        "lye_g": round(lye_g, 1),
        "liquid_g": round(liquid_g, 1),
        "fragrance_pct": float(fragrance_pct),
        "fragrance_material": fragrance_material,
        "fragrance_g": round(fragrance_g, 1),
        "fragrance_ml": round(fragrance_volume_ml, 1),
        "fragrance_oz": round(fragrance_oz, 3),
        "total_mass_g": round(total_mass_g, 1),
        "volume_ml": round(total_volume_ml, 1),
        "volume_in3": round(volume_in3, 2),
        "batter_density": round(batter_density, 4),
        "liquid_type": liquid_type,
    }


def batch_volume_from_batch_id(
    batch_id,
    total_oils_g,
    *,
    batch=None,
    base_recipes=None,
    product_recipes=None,
    constants_bundle=None,
    superfat_pct=None,
    lye_ratio=None,
    liquid_type=None,
    fragrance_pct=None,
):
    target_batch = batch if batch is not None else get_batch(batch_id)
    recipe_id = (
        target_batch.get("base_recipe_id")
        or target_batch.get("recipe_id")
        or target_batch.get("product_recipe_id")
    )

    if not recipe_id:
        raise ValueError(f"Batch {batch_id} missing recipe identifier")

    if constants_bundle is None:
        units_cfg, density_cfg, sap_cfg = UNIT_CFG, DENSITY_CFG, SAP_CFG
    else:
        units_cfg = constants_bundle["units"]
        density_cfg = constants_bundle["density"]
        sap_cfg = constants_bundle["sap_values"]

    units_map, density_map, sap_source = _unwrap_constants(
        units_cfg, density_cfg, sap_cfg
    )

    resolved_base_recipes = (
        base_recipes if base_recipes is not None else load_base_recipes()
    )
    resolved_product_recipes = (
        product_recipes if product_recipes is not None else load_product_recipes()
    )

    base_recipe, product_recipe = resolve_base_recipe_for_id(
        recipe_id,
        base_recipes=resolved_base_recipes,
        product_recipes=resolved_product_recipes,
    )

    effective_superfat = (
        superfat_pct
        if superfat_pct is not None
        else base_recipe.get("lye", {}).get("default_superfat_pct", 5)
    )
    effective_liquid = (
        liquid_type
        if liquid_type is not None
        else base_recipe.get("liquid", {}).get("default_type", "water")
    )
    lye_type = base_recipe.get("lye", {}).get("type", "naoh")
    sap_map = _resolve_sap_map(sap_source, lye_type=lye_type)

    fragrance_pct = _recipe_fragrance_percent(product_recipe, fragrance_pct)
    if lye_ratio is None:
        lye_ratio = compute_material_requirements_from_oils(1, base_recipe, sap_source=sap_source, product_recipe=product_recipe, superfat_pct=effective_superfat, liquid_type=effective_liquid, fragrance_pct=fragrance_pct)["lye_ratio"]
    result = batch_volume_from_oils(
        total_oils_g=total_oils_g,
        oils_pct=base_recipe["oils_pct"],
        density_map=density_map,
        sap_map=sap_map,
        units_map=units_map,
        superfat_pct=effective_superfat,
        lye_ratio=lye_ratio,
        liquid_type=effective_liquid,
        fragrance_pct=fragrance_pct,
        fragrance_material=_fragrance_material_from_product(product_recipe),
        additives_pct=base_recipe.get("additives_pct", {}),
        purity_percent=base_recipe.get("lye", {}).get("purity_percent", 100),
        lye_type=str(lye_type).lower(),
    )
    result["batch_id"] = batch_id
    result["base_recipe_id"] = base_recipe["id"]
    result["lye_type"] = str(lye_type).upper()
    return result
