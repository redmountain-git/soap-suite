import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Asset, InventoryRecord } from '@rmsc/worker-protocol';
import { WorkspaceService } from '../workspace.service';
import { monthlyAssetCharge } from '@rmsc/domain-core';
import {
  formNumber,
  formString,
  formatNumber,
  inventorySections,
  labelize,
  money,
  today,
} from '../ui-format';

@Component({
  selector: 'rms-stock-page',
  imports: [RouterLink],
  template: `
    @if (view === 'inventory') {
      <section aria-labelledby="stock-heading">
        <section class="panel">
          <div class="panel-heading">
            <h2 id="stock-heading">Inventory</h2>
            <button
              class="secondary"
              title="Run capacity audit"
              (click)="runAudit()"
            >
              Audit
            </button>
            <a routerLink="/finances" fragment="receipt">Record purchase</a>
          </div>

          <div class="table-wrap">
            @for (section of sections(); track section[0]) {
              <h3>{{ section[0] }}</h3>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>On hand</th>
                    <th>Avg cost</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of entries(section[1]); track item[0]) {
                    <tr>
                      <td>{{ label(item[0]) }}</td>
                      <td>
                        {{ number(item[1].on_hand) }} {{ item[1].unit || '' }}
                      </td>
                      <td>
                        {{
                          moneyValue(
                            item[1].avg_cost_per_unit ??
                              item[1].cost_per_unit ??
                              0
                          )
                        }}
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="3">None</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
        </section>
      </section>
    } @else {
      <section aria-labelledby="finance-heading">
        <h2 id="finance-heading">Finances</h2>
        @if (workspace.reports(); as reports) {
          <section class="metric-grid" aria-label="Financial summary">
            <div class="metric">
              <span>Recorded inventory value</span
              ><strong>{{ moneyValue(reports.inventoryValue) }}</strong>
            </div>
            <div class="metric">
              <span>Recorded asset purchases</span
              ><strong>{{ moneyValue(reports.assetSpend) }}</strong>
            </div>
            <div class="metric">
              <span>Monthly asset amortization</span
              ><strong>{{ moneyValue(reports.monthlyAmortization) }}</strong>
            </div>
          </section>
        }
        <section class="panel">
          <div class="panel-heading">
            <h2 id="receipt">Receipt</h2>
            <span class="badge">Manual</span>
          </div>
          <form class="stacked-form" (submit)="recordReceipt($event)">
            <label
              >Vendor<input name="vendor" required value="Demo Supply"
            /></label>
            <label
              >Date<input
                name="date"
                type="date"
                required
                [value]="receiptDate"
            /></label>
            <label
              >Payment
              <select name="paymentMethod">
                <option value="debit_business">Debit business</option>
                <option value="debit_personal">Debit personal</option>
                <option value="cash">Cash</option>
                <option value="credit_business">Credit business</option>
              </select>
            </label>
            <div class="line-grid">
              <label
                >Item<input name="itemName" required value="Olive oil"
              /></label>
              <label
                >Material<input name="material" required value="olive_oil"
              /></label>
              <label
                >Qty<input
                  name="quantity"
                  type="number"
                  min="0.001"
                  step="0.001"
                  value="1"
              /></label>
              <label>Unit<input name="unit" value="kg" /></label>
              <label
                >Cost<input
                  name="total"
                  type="number"
                  min="0"
                  step="0.01"
                  value="6.40"
              /></label>
            </div>
            <button class="primary" type="submit">+ Receipt</button>
          </form>
        </section>
        <section class="panel full-width">
          <div class="panel-heading">
            <h2>Infrastructure</h2>
            <span class="badge">{{ monthlyAmortization() }}</span>
          </div>
          <form class="asset-form" (submit)="recordAsset($event)">
            <label
              >Asset<input name="name" required value="Column mold"
            /></label>
            <label
              >Purchase date<input
                name="purchasedAt"
                type="date"
                required
                [value]="assetDate"
            /></label>
            <label
              >Amount<input
                name="amountUsd"
                type="number"
                min="0"
                step="0.01"
                value="48"
            /></label>
            <label
              >Months<input
                name="usefulLifeMonths"
                type="number"
                min="1"
                step="1"
                value="36"
            /></label>
            <button class="secondary" type="submit">+ Asset</button>
          </form>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Months</th>
                  <th>Monthly</th>
                </tr>
              </thead>
              <tbody>
                @for (asset of assets(); track asset.id) {
                  <tr>
                    <td>{{ asset.name }}</td>
                    <td>{{ asset.purchased_at }}</td>
                    <td>{{ moneyValue(asset.amount_usd) }}</td>
                    <td>{{ asset.useful_life_months }}</td>
                    <td>{{ assetMonthly(asset) }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5">None</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
        <section aria-labelledby="purchases-heading">
          <h2 id="purchases-heading">Recorded receipts</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vendor</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                @for (
                  receipt of workspace.workspace()?.receipts || [];
                  track receipt.id
                ) {
                  <tr>
                    <td>{{ receipt.date }}</td>
                    <td>{{ receipt.vendor }}</td>
                    <td>
                      {{ moneyValue(receipt.total ?? receipt.total_usd) }}
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="3">No receipts</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
        <section aria-labelledby="batch-cost-heading">
          <h2 id="batch-cost-heading">Batch costs</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Status</th>
                  <th>Recorded material cost</th>
                </tr>
              </thead>
              <tbody>
                @for (
                  batch of workspace.workspace()?.batches || [];
                  track batch.id
                ) {
                  <tr>
                    <td>{{ batch.id }}</td>
                    <td>{{ batch.status }}</td>
                    <td>
                      {{
                        batch.costed && batch.total_cost != null
                          ? moneyValue(batch.total_cost)
                          : 'Not costed'
                      }}
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="3">No batches</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      </section>
    }
  `,
})
export class StockPage {
  readonly view = inject(ActivatedRoute).snapshot.data['view'] as
    | 'inventory'
    | 'finances';
  readonly workspace = inject(WorkspaceService);
  readonly receiptDate = today();
  readonly assetDate = today();
  readonly sections = computed(() =>
    inventorySections(this.workspace.workspace()),
  );
  readonly assets = computed(() => this.workspace.workspace()?.assets || []);
  readonly monthlyAmortization = computed(() => {
    const reports = this.workspace.reports();
    return reports ? `${money(reports.monthlyAmortization)} / month` : '';
  });
  readonly label = labelize;
  readonly number = formatNumber;
  readonly moneyValue = money;

  entries(items: Record<string, InventoryRecord>) {
    return Object.entries(items);
  }

  assetMonthly(asset: Asset) {
    return money(monthlyAssetCharge(asset));
  }

  runAudit() {
    void this.workspace.runAudit();
  }

  recordReceipt(event: Event) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    void this.workspace.recordReceipt({
      vendor: formString(data, 'vendor'),
      date: formString(data, 'date'),
      paymentMethod: formString(data, 'paymentMethod'),
      itemName: formString(data, 'itemName'),
      material: formString(data, 'material'),
      quantity: formNumber(data, 'quantity'),
      unit: formString(data, 'unit'),
      total: formNumber(data, 'total'),
      account: 'assets.inventory.raw_materials',
    });
  }

  recordAsset(event: Event) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    void this.workspace.recordAsset({
      name: formString(data, 'name'),
      purchasedAt: formString(data, 'purchasedAt'),
      amountUsd: formNumber(data, 'amountUsd'),
      usefulLifeMonths: formNumber(data, 'usefulLifeMonths'),
    });
  }
}
