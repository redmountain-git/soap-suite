# engine/units.py

import math


class UnitConverter:

    def __init__(self, units_cfg, density_cfg):
        self.units = {k.lower().strip(): v for k, v in units_cfg.get("units", units_cfg).items()}
        self.density = density_cfg.get("density", density_cfg)


    def to_grams(self, material, quantity, unit):

        unit = unit.lower().strip()
        quantity = float(quantity)
        if not math.isfinite(quantity) or quantity < 0:
            raise ValueError("Quantity must be finite and nonnegative")

        if unit not in self.units:
            raise ValueError(f"Unknown unit: {unit}")

        spec = self.units[unit]


        # Mass → grams
        if "to_g" in spec:
            factor = float(spec["to_g"])
            if not math.isfinite(factor) or factor <= 0:
                raise ValueError("Invalid mass conversion factor")
            return quantity * factor


        # Volume → grams (needs density)
        if "to_ml" in spec:

            if material not in self.density:
                raise ValueError(
                    f"No density for material '{material}'"
                )

            ml = quantity * spec["to_ml"]
            density = self.density[material]
            if not math.isfinite(float(density)) or density <= 0 or not math.isfinite(float(spec["to_ml"])) or spec["to_ml"] <= 0:
                raise ValueError("Invalid volume conversion or density")

            return ml * density


        # Count units (each, unit)
        if "to_each" in spec:
            raise ValueError(
                f"Cannot convert count unit '{unit}' to grams"
            )


        raise ValueError(f"Unsupported unit: {unit}")
