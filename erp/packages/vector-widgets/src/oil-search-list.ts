import { VectorItemList } from './vector-item-list';

export class OilSearchList extends VectorItemList {
  declare _listType;
  declare _searchPlaceholder;

  constructor() {
    super();
    this._listType = 'oil';
    this._searchPlaceholder = 'Search oils';
  }
}
