import pytest

from engine.units import UnitConverter


def make_converter(units_map, density_map):
    return UnitConverter({"units": units_map}, {"density": density_map})


def test_to_grams_mass_unit_converts_with_to_g():
    converter = make_converter({"lb": {"to_g": 453.592}}, {})

    grams = converter.to_grams("x", 2, "lb")

    assert grams == pytest.approx(907.184)


def test_to_grams_volume_unit_converts_using_density():
    converter = make_converter({"fl_oz": {"to_ml": 29.5735}}, {"olive_oil": 0.91})

    grams = converter.to_grams("olive_oil", 3, "fl_oz")

    assert grams == pytest.approx(3 * 29.5735 * 0.91)


def test_to_grams_volume_unit_raises_when_density_missing():
    converter = make_converter({"ml": {"to_ml": 1.0}}, {})

    with pytest.raises(ValueError, match="No density for material"):
        converter.to_grams("olive_oil", 5, "ml")


def test_to_grams_count_unit_raises_cannot_convert():
    converter = make_converter({"each": {"to_each": 1}}, {})

    with pytest.raises(ValueError, match="Cannot convert count unit"):
        converter.to_grams("anything", 1, "each")


def test_to_grams_raises_for_unknown_unit():
    converter = make_converter({"lb": {"to_g": 453.592}}, {})

    with pytest.raises(ValueError, match="Unknown unit"):
        converter.to_grams("x", 1, "kg")


def test_to_grams_normalizes_unit_case_and_whitespace():
    converter = make_converter({"lb": {"to_g": 453.592}}, {})

    grams = converter.to_grams("x", 2, "  LB  ")

    assert grams == pytest.approx(907.184)


def test_to_grams_raises_for_unsupported_unit_spec():
    converter = make_converter({"mystery": {"factor": 10}}, {})

    with pytest.raises(ValueError, match="Unsupported unit"):
        converter.to_grams("x", 1, "mystery")
