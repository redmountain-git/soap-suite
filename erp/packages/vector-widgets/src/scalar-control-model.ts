import type {
  MeasurementBasis,
  MeasurementMeasure,
  MeasurementScope,
  MeasurementSystem,
  ScalarVectorItem,
  UnitOption,
} from './vector-types';

export interface ScalarUnitPreferences {
  unitKey: string;
  measurementSystem: MeasurementSystem | '';
  basis: MeasurementBasis | '';
  measurementScope: MeasurementScope | '';
  measurementMeasure: MeasurementMeasure | '';
}

export function unitMatchesPreferences(
  option: UnitOption,
  preferences: ScalarUnitPreferences,
): boolean {
  return (
    (!preferences.measurementSystem ||
      !option.system ||
      option.system === preferences.measurementSystem) &&
    (!preferences.measurementScope ||
      !option.scope ||
      option.scope === preferences.measurementScope) &&
    (!preferences.measurementMeasure ||
      !option.measure ||
      option.measure === preferences.measurementMeasure) &&
    (!preferences.basis || !option.basis || option.basis === preferences.basis)
  );
}

export function resolveUnitOption(
  options: readonly UnitOption[],
  item: ScalarVectorItem | null,
  preferences: ScalarUnitPreferences,
): UnitOption | null {
  return (
    options.find((option) => option.key === preferences.unitKey) ??
    options.find(
      (option) =>
        Boolean(option.system) &&
        option.system === preferences.measurementSystem &&
        unitMatchesPreferences(option, preferences),
    ) ??
    options.find((option) => unitMatchesPreferences(option, preferences)) ??
    options.find(
      (option) =>
        option.key === item?.defaultUnitKey &&
        unitMatchesPreferences(option, preferences),
    ) ??
    options[0] ??
    null
  );
}

export function convertFromCanonical(
  value: number,
  option: UnitOption | null,
  context: unknown,
): number {
  return typeof option?.fromCanonical === 'function'
    ? Number(option.fromCanonical(value, context) ?? 0)
    : value;
}

export function convertToCanonical(
  value: number,
  option: UnitOption | null,
  context: unknown,
): number {
  return typeof option?.toCanonical === 'function'
    ? Number(option.toCanonical(value, context) ?? 0)
    : value;
}
