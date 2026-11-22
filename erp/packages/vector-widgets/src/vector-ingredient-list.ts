import { VectorItemList } from './vector-item-list';

export class VectorIngredientList extends VectorItemList {
  declare _listType;
  declare _searchPlaceholder;

  constructor() {
    super();
    this._listType = 'ingredient';
    this._searchPlaceholder = 'Search additives';
  }
}
