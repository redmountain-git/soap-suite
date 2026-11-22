def _unwrap_units(units_cfg):
    if units_cfg is None:
        return {}
    return units_cfg.get("units", units_cfg)


def mass_unit_to_g_factor(unit, units_cfg):
    units_map = _unwrap_units(units_cfg)
    spec = units_map.get(str(unit).lower(), {})
    return spec.get("to_g")


def material_unit_to_g_factor(material, unit, units_cfg, density_cfg=None):
    try:
        from .units import UnitConverter
    except ImportError:
        from units import UnitConverter
    spec = _unwrap_units(units_cfg).get(str(unit).lower(), {})
    if "to_each" in spec or str(unit).lower() == "bar":
        return None
    return UnitConverter(units_cfg or {}, density_cfg or {}).to_grams(material, 1, unit)


def grams_to_unit_quantity(grams, unit, units_cfg):
    factor = mass_unit_to_g_factor(unit, units_cfg)
    if not factor:
        raise ValueError(f"Unit '{unit}' is not a mass unit with to_g factor")
    return grams / factor


def cost_per_g_to_cost_per_unit(cost_per_g, unit, units_cfg):
    factor = mass_unit_to_g_factor(unit, units_cfg)
    if not factor:
        raise ValueError(f"Unit '{unit}' is not a mass unit with to_g factor")
    return cost_per_g * factor
