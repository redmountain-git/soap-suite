# engine/calculators/lye.py
from constants import sap_values as SAP_VALUES


def _resolve_sap_map(lye_type="naoh"):
    source = SAP_VALUES.get("sap_values", SAP_VALUES)
    key = str(lye_type).lower()

    if isinstance(source.get(key), dict):
        return source[key]

    return source


def calculate_lye(oils_grams: dict, superfat: float, lye_type: str = "naoh"):
    """
    Calculate NaOH needed (grams)

    superfat = percent (e.g. 5 for 5%)
    """

    sap_map = _resolve_sap_map(lye_type=lye_type)
    total_lye = 0.0

    for oil, grams in oils_grams.items():
        if oil not in sap_map:
            raise ValueError(f"No SAP value for {oil}")

        sap = sap_map[oil]
        total_lye += grams * sap

    discount = 1 - (superfat / 100)

    return round(total_lye * discount, 2)
