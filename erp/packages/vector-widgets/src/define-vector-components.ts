import { ConstraintFeedbackList } from './constraint-feedback-list';
import { OilSearchList } from './oil-search-list';
import { VectorAmountList } from './vector-amount-list';
import { VectorChoiceControl } from './vector-choice-control';
import { defineElement } from './vector-component-support';
import { VectorConstraintControl } from './vector-constraint-control';
import { VectorConstraintRail } from './vector-constraint-rail';
import { VectorIngredientList } from './vector-ingredient-list';
import { VectorInspector } from './vector-inspector';
import { VectorItemList } from './vector-item-list';
import { VectorPieChart } from './vector-pie-chart';
import { VectorQuantityInput } from './vector-quantity-input';
import { VectorRadarChart } from './vector-radar-chart';
import { VectorScalarRail } from './vector-scalar-rail';
import { VectorSummaryMeter } from './vector-summary-meter';
import { VectorUnitToggle } from './vector-unit-toggle';
import { VectorValueSlider } from './vector-value-slider';

export function defineVectorComponents() {
  defineElement('vector-pie-chart', VectorPieChart);
  defineElement('vector-radar-chart', VectorRadarChart);
  defineElement('vector-constraint-control', VectorConstraintControl);
  defineElement('vector-constraint-rail', VectorConstraintRail);
  defineElement('vector-scalar-rail', VectorScalarRail);
  defineElement('vector-value-slider', VectorValueSlider);
  defineElement('vector-quantity-input', VectorQuantityInput);
  defineElement('vector-unit-toggle', VectorUnitToggle);
  defineElement('vector-item-list', VectorItemList);
  defineElement('vector-ingredient-list', VectorIngredientList);
  defineElement('vector-amount-list', VectorAmountList);
  defineElement('vector-choice-control', VectorChoiceControl);
  defineElement('vector-summary-meter', VectorSummaryMeter);
  defineElement('oil-search-list', OilSearchList);
  defineElement('vector-inspector', VectorInspector);
  defineElement('constraint-feedback-list', ConstraintFeedbackList);
}
