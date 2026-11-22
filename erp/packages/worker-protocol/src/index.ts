export type BatchStatus =
  | 'planned'
  | 'prepped'
  | 'poured'
  | 'unmolded'
  | 'cut'
  | 'curing'
  | 'cured'
  | 'shredded'
  | 'in_inventory';

export type NumericMap = Readonly<Record<string, number>>;
export type UnknownRecord = Readonly<Record<string, unknown>>;
export type EmptyPayload = Readonly<Record<string, never>>;

export interface UnitConversion {
  readonly to_g?: number;
  readonly to_ml?: number;
  readonly to_each?: number;
}

export interface WorkspaceConstants {
  readonly units: Readonly<Record<string, UnitConversion>>;
  readonly density: NumericMap;
  readonly sap_values: Readonly<Record<string, NumericMap>>;
}

export interface TransitionContext {
  readonly nowIso: string;
  readonly today: string;
  readonly nextId: (prefix: string) => string;
}

export interface InventoryRecord {
  readonly unit?: string;
  readonly on_hand?: number;
  readonly avg_cost_per_unit?: number;
  readonly cost_per_unit?: number;
  readonly [key: string]: unknown;
}

export interface Inventory {
  readonly raw_materials?: Readonly<Record<string, InventoryRecord>>;
  readonly additives?: Readonly<Record<string, InventoryRecord>>;
  readonly finished_goods?: Readonly<Record<string, InventoryRecord>>;
  readonly [section: string]:
    | Readonly<Record<string, InventoryRecord>>
    | undefined;
}

export interface BaseRecipe {
  readonly id: string;
  readonly name: string;
  readonly oils_pct: NumericMap;
  readonly lye?: {
    readonly type?: string;
    readonly default_superfat_pct?: number;
    readonly [key: string]: unknown;
  };
  readonly liquid?: {
    readonly default_type?: string;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

export interface ProductRecipe {
  readonly id: string;
  readonly name: string;
  readonly base_recipe_id: string;
  readonly fragrance?: {
    readonly type?: string;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

export interface BarSize {
  readonly display_name?: string;
  readonly approx_volume_in3?: number;
  readonly active?: boolean;
  readonly [key: string]: unknown;
}

export interface ReceiptLine {
  readonly name: string;
  readonly category?: string;
  readonly material?: string | null;
  readonly quantity?: number;
  readonly unit?: string;
  readonly total?: number;
  readonly amount_usd?: number;
  readonly account: string;
}

export interface Receipt {
  readonly id: string;
  readonly date: string;
  readonly vendor: string;
  readonly payment_method: string;
  readonly total?: number;
  readonly total_usd?: number;
  readonly tax_usd?: number;
  readonly items: ReadonlyArray<ReceiptLine>;
}

export interface Asset {
  readonly id: string;
  readonly name: string;
  readonly purchased_at: string;
  readonly amount_usd: number;
  readonly useful_life_months: number;
}

export interface BatchEvent {
  readonly type: string;
  readonly at: string;
  readonly notes?: string;
}

export interface MoldInput {
  readonly id: string;
  readonly label: string;
  readonly barSize: string;
  readonly volumeIn3: number;
}
export interface MoldAllocation extends MoldInput {
  readonly bar_volume_in3: number;
  readonly bars_expected: number;
}
export type ProductionStep =
  | 'lye_ready'
  | 'oils_ready'
  | 'mixed'
  | 'trace'
  | 'additive'
  | 'pour_started'
  | 'pour_finished';
export type ProductionLog = Readonly<
  Partial<Record<Exclude<ProductionStep, 'additive'>, string>>
> & {
  readonly additives: Readonly<Record<string, string>>;
  readonly pour_finished_estimated?: boolean;
};

export interface CureWeighIn {
  readonly at: string;
  readonly size_counts: NumericMap;
  readonly weight_g_by_size: NumericMap;
}

export interface Batch {
  readonly cure_weigh_ins?: ReadonlyArray<CureWeighIn>;
  readonly weighing?: {
    readonly resolution_g: 1;
    readonly suggested_g: NumericMap;
    readonly actual_g: NumericMap;
  };
  readonly id: string;
  readonly parent_batch_id?: string | null;
  readonly formulation?: BatchCalculation;
  readonly production?: ProductionLog;
  readonly reconciliation_required?: boolean;
  readonly inventory_deducted?: boolean;
  readonly inventory_deducted_at?: string | null;
  readonly prepped_at?: string;
  readonly cut_at?: string;
  readonly cure_completed_at?: string;
  readonly posted_to_inventory_at?: string;
  readonly costed?: boolean;
  readonly consumption_costs?: NumericMap;
  readonly consumption_fingerprint?: string;
  readonly missing_material_costs?: ReadonlyArray<string>;
  readonly date?: string;
  readonly recipe_id?: string;
  readonly base_recipe_id?: string;
  readonly product_recipe_id?: string | null;
  readonly oil_weight_g?: number;
  readonly total_mass_g?: number;
  readonly volume_in3?: number;
  readonly fragrance_pct?: number;
  readonly status: BatchStatus;
  readonly bars_expected?: number;
  readonly bars_actual?: number;
  readonly material_usage_g?: NumericMap;
  readonly extra_material_usage_g?: NumericMap;
  readonly total_cost?: number;
  readonly cost_per_bar?: number | null;
  readonly cost_per_bar_by_size?: NumericMap;
  readonly yield_actual?: {
    readonly recorded_at?: string;
    readonly size_counts?: NumericMap;
    readonly weight_g_by_size?: NumericMap;
    readonly scrap_g?: number;
    readonly shredded_g?: number;
    readonly estimated_trim_in3?: number;
    readonly estimated_trim_pct?: number;
  } | null;
  readonly events?: ReadonlyArray<BatchEvent>;
  readonly [key: string]: unknown;
}

export interface Workspace {
  readonly version: string | number;
  readonly revision?: number;
  readonly integrity?: IntegrityMetadata;
  readonly reconstruction?: ReconstructionInput;
  readonly updatedAt?: string;
  readonly constants?: {
    readonly units?: Readonly<Record<string, UnitConversion>>;
    readonly density?: NumericMap;
    readonly sap_values?: Readonly<Record<string, NumericMap>> | NumericMap;
  };
  readonly inventory: Inventory;
  readonly receipts?: ReadonlyArray<Receipt>;
  readonly assets?: ReadonlyArray<Asset>;
  readonly batches?: ReadonlyArray<Batch>;
  readonly base_recipes?: ReadonlyArray<BaseRecipe>;
  readonly product_recipes?: ReadonlyArray<ProductRecipe>;
  readonly bar_sizes?: Readonly<Record<string, BarSize>>;
  readonly [key: string]: unknown;
}

export interface Reports {
  readonly inventoryValue: number;
  readonly assetSpend: number;
  readonly monthlyAmortization: number;
  readonly batchCount: number;
  readonly activeBatches: number;
  readonly gramsOnHand: NumericMap;
}

export interface DecoratedWorkspace {
  readonly workspace: Workspace;
  readonly reports: Reports;
}

export interface BatchCalculation {
  readonly molds?: ReadonlyArray<MoldAllocation>;
  readonly calculation_version?: number;
  readonly inputs?: BatchCalculationInput;
  readonly warnings?: ReadonlyArray<string>;
  readonly recipe_snapshot?: BaseRecipe;
  readonly recipe_id: string;
  readonly base_recipe_id: string;
  readonly product_recipe_id: string | null;
  readonly product_recipe_name?: string | null;
  readonly base_recipe_name?: string;
  readonly volume_in3: number;
  readonly volume_ml?: number;
  readonly batter_density?: number;
  readonly total_mass_g: number;
  readonly total_oils_g: number;
  readonly oils_g?: NumericMap;
  readonly lye_type?: string;
  readonly lye_g?: number;
  readonly liquid_type?: string;
  readonly liquid_g?: number;
  readonly fragrance: {
    readonly material: string;
    readonly percent_of_oils: number;
    readonly amount_g: number;
    readonly volume_ml?: number;
    readonly amount_oz?: number;
  };
  readonly fragrance_pct?: number;
  readonly materials_required_g: NumericMap;
  readonly costing: {
    readonly scope?: string;
    readonly total_material_cost: number;
    readonly material_costs: NumericMap;
    readonly missing_material_costs: ReadonlyArray<string>;
  };
  readonly bar_size?: string | null;
  readonly bars_expected?: number | null;
}

export interface BatchCalculationInput {
  readonly weighingResolutionG?: 1;
  readonly additiveSubstitutions?: Readonly<Record<string, string>>;
  readonly molds?: ReadonlyArray<MoldInput>;
  readonly recipeId: string;
  readonly volumeIn3: number;
  readonly barSize?: string;
  readonly fragrancePct?: number;
  readonly oilRatio?: number;
  readonly lyeRatio?: number;
  readonly superfatPct?: number;
  readonly liquidType?: string;
}

export interface ReceiptInput {
  readonly vendor: string;
  readonly date: string;
  readonly paymentMethod: string;
  readonly itemName: string;
  readonly material: string;
  readonly quantity: number;
  readonly unit: string;
  readonly total: number;
  readonly account?: string;
  readonly category?: string;
  readonly taxUsd?: number;
}

export interface AssetInput {
  readonly name: string;
  readonly purchasedAt?: string;
  readonly amountUsd: number;
  readonly usefulLifeMonths: number;
}

export interface CapacityAudit {
  readonly recipe_id: string;
  readonly materials_required_g: NumericMap;
  readonly shortages: Readonly<
    Record<
      string,
      {
        readonly required_g: number;
        readonly on_hand_g: number;
        readonly short_g: number;
      }
    >
  >;
  readonly can_make: boolean;
}

export interface WorkerCommandMap {
  readonly addBaseRecipe: {
    readonly payload: { readonly raw: string };
    readonly result: DecoratedWorkspace;
  };
  readonly correctPourEndTimestamp: {
    readonly payload: {
      readonly batchId: string;
      readonly expectedAt: string;
      readonly at: string;
      readonly reason: string;
      readonly estimated?: boolean;
    };
    readonly result: DecoratedWorkspace;
  };
  readonly correctAdditiveTimestamp: {
    readonly payload: {
      readonly batchId: string;
      readonly material: string;
      readonly expectedAt: string;
      readonly at: string;
      readonly reason: string;
    };
    readonly result: DecoratedWorkspace;
  };
  readonly correctAdditiveOmission: {
    readonly payload: {
      readonly batchId: string;
      readonly material: string;
      readonly expectedAt: string;
      readonly expectedWeightG: number;
      readonly reason: string;
    };
    readonly result: DecoratedWorkspace;
  };
  readonly enableBatchWeighing: {
    readonly payload: { readonly batchId: string };
    readonly result: DecoratedWorkspace;
  };
  readonly recordProductionStep: {
    readonly payload: {
      readonly batchId: string;
      readonly step: ProductionStep;
      readonly material?: string;
      readonly at?: string;
      readonly actualWeightsG?: NumericMap;
      readonly estimated?: boolean;
    };
    readonly result: DecoratedWorkspace;
  };
  readonly previewImport: {
    readonly payload: { readonly raw: string };
    readonly result: ReplacementPreview;
  };
  readonly commitImport: {
    readonly payload: { readonly token: string };
    readonly result: DecoratedWorkspace;
  };
  readonly previewReconstruction: {
    readonly payload: ReconstructionInput;
    readonly result: ReplacementPreview;
  };
  readonly commitReconstruction: {
    readonly payload: { readonly token: string };
    readonly result: DecoratedWorkspace;
  };
  readonly listRecovery: {
    readonly payload: EmptyPayload;
    readonly result: ReadonlyArray<RecoverySummary>;
  };
  readonly previewRecovery: {
    readonly payload: { readonly recoveryId: string };
    readonly result: ReplacementPreview;
  };
  readonly seedWorkspace: {
    readonly payload: EmptyPayload;
    readonly result: DecoratedWorkspace;
  };
  readonly getWorkspace: {
    readonly payload: EmptyPayload;
    readonly result: DecoratedWorkspace;
  };
  readonly resetDemo: {
    readonly payload: { readonly confirmed: boolean };
    readonly result: DecoratedWorkspace;
  };
  readonly calculateBatch: {
    readonly payload: BatchCalculationInput;
    readonly result: BatchCalculation;
  };
  readonly savePlannedBatch: {
    readonly payload: {
      readonly replaceBatchIds?: ReadonlyArray<string>;
      readonly expectedRevision?: number;
      readonly calculation?: BatchCalculation;
      readonly input?: BatchCalculationInput;
    };
    readonly result: DecoratedWorkspace;
  };
  readonly recordReceipt: {
    readonly payload: ReceiptInput;
    readonly result: DecoratedWorkspace;
  };
  readonly applyReceiptToInventory: {
    readonly payload: { readonly receipt: Receipt };
    readonly result: DecoratedWorkspace;
  };
  readonly recordAsset: {
    readonly payload: AssetInput;
    readonly result: DecoratedWorkspace;
  };
  readonly recordBatchEvent: {
    readonly payload: {
      readonly batchId: string;
      readonly eventType: string;
      readonly at?: string;
      readonly notes?: string;
    };
    readonly result: DecoratedWorkspace;
  };
  readonly recordNextBatchEvent: {
    readonly payload: { readonly batchId: string };
    readonly result: DecoratedWorkspace;
  };
  readonly recordCutYield: {
    readonly payload: {
      readonly batchId: string;
      readonly sizeCounts: NumericMap;
      readonly weightGBySize?: NumericMap;
      readonly scrapG?: number;
      readonly shreddedG?: number;
      readonly at?: string;
    };
    readonly result: DecoratedWorkspace;
  };
  readonly recordCureWeighIn: {
    readonly payload: {
      readonly batchId: string;
      readonly at: string;
      readonly sizeCounts: NumericMap;
      readonly weightGBySize: NumericMap;
    };
    readonly result: DecoratedWorkspace;
  };
  readonly postFinishedGoods: {
    readonly payload: { readonly batchId: string; readonly at?: string };
    readonly result: DecoratedWorkspace;
  };
  readonly runCosting: {
    readonly payload: { readonly batchId?: string };
    readonly result: DecoratedWorkspace;
  };
  readonly runCapacityAudit: {
    readonly payload: Partial<BatchCalculationInput>;
    readonly result: CapacityAudit;
  };
  readonly exportBackup: {
    readonly payload: EmptyPayload;
    readonly result: string;
  };
  readonly importBackup: {
    readonly payload: { readonly raw: string };
    readonly result: DecoratedWorkspace;
  };
}

export type WorkerCommandName = keyof WorkerCommandMap;

export function isWorkspaceMutation(command: AnyWorkerRequest['command']) {
  return [
    'savePlannedBatch',
    'addBaseRecipe',
    'recordReceipt',
    'applyReceiptToInventory',
    'recordAsset',
    'recordBatchEvent',
    'recordProductionStep',
    'correctAdditiveTimestamp',
    'correctAdditiveOmission',
    'correctPourEndTimestamp',
    'enableBatchWeighing',
    'recordNextBatchEvent',
    'recordCutYield',
    'recordCureWeighIn',
    'postFinishedGoods',
    'runCosting',
    'commitImport',
    'commitReconstruction',
    'resetDemo',
  ].includes(command);
}

export interface WorkerRequest<K extends WorkerCommandName> {
  readonly id: number;
  readonly command: K;
  readonly payload: WorkerCommandMap[K]['payload'];
  readonly mutationId?: string;
  readonly clientId?: string;
}

export interface IntegrityMetadata {
  readonly appliedReceipts: Readonly<Record<string, string>>;
  readonly finishedPosts: Readonly<Record<string, string>>;
  readonly reviewIssues: ReadonlyArray<string>;
  readonly audit: ReadonlyArray<{
    readonly at: string;
    readonly action: string;
  }>;
}

export interface InventoryAdjustment {
  readonly id: string;
  readonly date: string;
  readonly material: string;
  readonly quantity: number;
  readonly unit: string;
  readonly amount_usd: number;
  readonly reason: string;
}

export interface ReconstructionInput {
  readonly openingDate: string;
  readonly openingInventory: Inventory;
  readonly adjustments: ReadonlyArray<InventoryAdjustment>;
  readonly sourceRaw?: string;
}

export interface ReplacementPreview {
  readonly summary: {
    readonly before: Readonly<Record<string, number>>;
    readonly after: Readonly<Record<string, number>>;
  };
  readonly token: string;
  readonly revision: number;
  readonly kind: 'import' | 'reconstruction' | 'recovery';
  readonly issues: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly differences: ReadonlyArray<{
    readonly material: string;
    readonly before: number;
    readonly after: number;
    readonly beforeValue: number;
    readonly afterValue: number;
  }>;
}

export interface RecoverySummary {
  readonly id: string;
  readonly at: string;
  readonly reason: string;
}

export type AnyWorkerRequest = {
  readonly [K in WorkerCommandName]: WorkerRequest<K>;
}[WorkerCommandName];

export type WorkerResponse<K extends WorkerCommandName = WorkerCommandName> =
  K extends WorkerCommandName
    ?
        | {
            readonly id: number;
            readonly ok: true;
            readonly result: WorkerCommandMap[K]['result'];
          }
        | { readonly id: number; readonly ok: false; readonly error: string }
    : never;
