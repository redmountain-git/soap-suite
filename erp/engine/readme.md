# Red Mountain Soap Co - Engine Onboarding

This folder contains the ERP engine for inventory, recipe planning, accounting, and batch costing.

## Run Context

Run commands from the `engine/` directory:

- `python cli.py <command>`

Engine paths are configured in `config.yaml`.

## Command Reference

- `python cli.py validate`
  - Validates core YAML files against JSON schemas.
- `python cli.py inventory`
  - Applies new receipts to inventory and records applied receipt IDs in `inventory_meta`.
- `python cli.py apply-prep <prep_ref>`
  - Resolves a prep YAML by path, filename, or batch ID, deducts parent raw materials from `data/inventory.yaml`, and upserts a root batch into `data/production.yaml`.
  - Marks the batch `prepped`, appends a `prepped` event, and updates the prep file with the applied inventory state.
  - Workflow is idempotent once the prep has been applied.
- `python cli.py record-batch-event <batch_id> <poured|unmolded|cut|cure_started|cure_completed|shredded> [--at YYYY-MM-DD] [--notes TEXT]`
  - Records lifecycle events, updates milestone dates, and keeps `status` aligned with the latest event.
  - Shredded lots that are re-poured should become child batches instead of reusing the same batch record.
- `python cli.py create-child-batch <parent_batch_id> <oil_weight_g> [--recipe-id ID] [--batch-id ID] [--notes TEXT] [--at YYYY-MM-DD]`
  - Creates a child batch linked to its parent with `parent_batch_id`.
  - Enforces that immediate child `oil_weight_g` allocations do not exceed the parent batch.
- `python cli.py record-child-materials <batch_id> --material NAME=GRAMS [--material NAME=GRAMS ...] [--at YYYY-MM-DD] [--notes TEXT]`
  - Deducts child-only additives and fragrance from inventory and records them in `extra_material_usage_g`.
  - On first use, marks the child batch `prepped`.
- `python cli.py record-cut-yield <batch_id> --size SIZE=COUNT [--size SIZE=COUNT ...] [--scrap-g N] [--shredded-g N] [--at YYYY-MM-DD] [--notes TEXT]`
  - Records actual cut yield for leaf batches using the global size catalog in `data/bar_sizes.yaml`.
  - Writes `yield_actual`, updates `bars_actual`, and appends a `cut` event if the batch has not already been marked cut.
- `python cli.py post-finished-goods <batch_id> [--at YYYY-MM-DD]`
  - Posts cured leaf-batch yield into `inventory.finished_goods` using idempotent post IDs stored in `inventory_meta`.
  - Uses `avg_cost_per_unit` as the canonical finished-goods costing field while preserving legacy `cost_per_unit` when present.
- `python cli.py calculate_batch <volume_in3> <recipe_id> [--prep] [--with-cost] [--superfat N] [--oil-ratio N] [--lye-ratio N] [--liquid TYPE] [--fragrance-pct N] [--output-dir PATH]`
  - Computes a planned batch from a base (`BSR-*`) or product (`PR-*`) recipe ID.
  - `--prep` writes a prep YAML file to `paths.batch_prep` in `config.yaml` (default: `batches` at project root).
  - `--output-dir` optionally overrides the prep output directory for one run.
  - `--fragrance-pct` defaults to `4.0` and is included in material, volume, capacity, and costing calculations.
  - Fragrance density falls back to `0.90 g/ml` if the fragrance material is not in `data/constants/density.yaml`.
  - Batch output includes `fragrance_g`, `fragrance_ml`, and `fragrance_oz`.
  - `--with-cost` adds a `costing` block using current inventory pricing with `cost_per_oz` and `cost_per_100g` (`materials_required` scope: oils + hydroxide + liquid + fragrance when applicable).
  - Missing inventory cost data is called out in batch notes.
- `python cli.py cost [--recompute]`
  - Costs production batches and writes `total_cost` / `cost_per_bar` into production data.
  - `--recompute` recalculates batches already marked `costed: true`.
- `python cli.py account`
  - Converts receipts into accounting transactions.
- `python cli.py list-recipes`
  - Prints available base recipes.
- `python cli.py mold-volume <length_in> <width_in> <height_in>`
  - Computes cuboid mold volume in cubic inches.
- `python cli.py batch-volume <batch_id> <total_oils_g> [--superfat N] [--lye-ratio N] [--liquid TYPE] [--fragrance-pct N]`
  - Computes estimated batter volume for a batch recipe using a target oils mass.
  - Includes fragrance mass/volume using `--fragrance-pct` (default `4.0`).
- `python cli.py max-capacity (--recipe-id <id> | --batch-id <id>) [--superfat N] [--lye-ratio N] [--liquid TYPE] [--fragrance-pct N]`
  - `--recipe-id`: computes the maximum batch size possible from ingredients on hand for that recipe.
  - `--batch-id`: computes how many full batches of that batch definition can be produced from ingredients on hand.
  - Capacity calculations include fragrance requirements (default `4.0%` of oils unless overridden).
  - Includes a `costing` block based on current inventory unit costs, with missing-cost materials explicitly listed.
- `python cli.py capacity-audit <batch_id> [<batch_id> ...] [--fragrance-pct N]`
  - Audits combined material consumption for one or more batch IDs (duplicates allowed), and reports shortages/purchase requirements.
  - Includes audit-level costing for required materials and purchase recommendations, with missing-cost materials explicitly listed.

## Workflow: Inventory Update

1. Add receipt(s) to `data/receipts.yaml`.
2. Run: `python cli.py inventory`.
3. Verify updates in:
   - `data/inventory.yaml`
   - `data/inventory_meta.yaml` (`applied_receipts`)
4. Commit data changes.

Notes:
- Workflow is idempotent for receipts with IDs already listed in `applied_receipts`.
- Non-material receipt lines (for example tax) are ignored by inventory calculations.

## Workflow: Recipe to Batch

1. Define/adjust base recipes in `data/recipes/base_recipes.yaml`.
2. Define/adjust product recipes in `data/recipes/product_recipes.yaml` (optional if using base recipe directly).
3. Run calculator:
   - `python cli.py calculate_batch <volume_in3> <recipe_id>`
4. To generate prep file:
   - `python cli.py calculate_batch <volume_in3> <recipe_id> --prep`
5. To deduct parent raw ingredients and register the root batch in production:
   - `python cli.py apply-prep <batch_id>`
6. To split a root batch into scented or customized child lots:
   - `python cli.py create-child-batch <parent_batch_id> <oil_weight_g>`
7. To deduct fragrance and other child-only materials:
   - `python cli.py record-child-materials <batch_id> --material fragrance_oil=25`
8. To move a batch through the lifecycle:
   - `python cli.py record-batch-event <batch_id> poured`
   - `python cli.py record-batch-event <batch_id> cure_completed`
9. To record actual cut yield:
   - `python cli.py record-cut-yield <batch_id> --size bar_5_2_oz=8 --size bar_6_oz=2`
10. To post finished goods into inventory:
   - `python cli.py post-finished-goods <batch_id>`

Notes:
- `recipe_id` accepts either:
  - `BSR-*` (base recipe)
  - `PR-*` (product recipe resolved to its base recipe)
- If `--superfat` or `--liquid` are omitted, base recipe defaults are used.
- `apply-prep` is the parent raw-material inventory mutation step; `--prep` alone does not deduct stock.
- Child batches are full production records, not nested subrecords.
- French-milled re-pours should be modeled as new child batches created from shredded source lots.

## Workflow: Volume Utilities

1. Mold dimensions to volume:
   - `python cli.py mold-volume <length_in> <width_in> <height_in>`
2. Batch ID + oils mass to estimated batch volume:
   - `python cli.py batch-volume <batch_id> <total_oils_g>`
3. Optional overrides:
   - `--superfat`
   - `--lye-ratio`
   - `--liquid`

## Workflow: Capacity Planning

1. Max batch size by recipe from current inventory:
   - `python cli.py max-capacity --recipe-id BSR-DEMO-001`
2. Max number of batches for a planned batch ID:
   - `python cli.py max-capacity --batch-id B-2026-001`
3. Audit a production plan (duplicates supported):
   - `python cli.py capacity-audit B-2026-001 B-2026-001 B-2026-002`
4. Review:
   - `total_required_g`
   - `shortages`
   - `purchase_recommendations_g`
   - `costing`

## Workflow: Costing

1. Ensure inventory has been updated (`python cli.py inventory`).
2. Ensure production batches exist in `data/production.yaml` and include:
   - `base_recipe_id`
   - `oil_weight_g`
   - `bars_expected` or `bars_actual` for leaf-batch `cost_per_bar`
3. Run: `python cli.py cost`.
4. Verify updates in `data/production.yaml`:
   - `material_usage_g`
   - `material_costs`
   - `total_cost`
   - `cost_per_bar` for leaf batches with yield or planned bar counts
   - `costed`

Current costing scope:
- `materials_required` with lineage-aware allocation for child batches.
- Parent batches can retain `total_cost` without a `cost_per_bar` when they are later split into children.
- Re-run all batches explicitly with: `python cli.py cost --recompute`.

## Engineering Philosophy

Data first. Code second.

Core calculations are implemented as pure data functions where possible, with adapters handling file I/O/orchestration.

Batch sizing domain logic lives in `batch_sizing.py` (mold volume, recipe scaling, and batch-volume calculations).
