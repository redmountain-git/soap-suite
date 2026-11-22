# Data Integrity And Reviewed Reconstruction

Recipe-only imports add new base recipes without replacing a workspace. They
validate the complete candidate, retain a recovery snapshot, reject conflicting
recipe identifiers, and preserve inventory and existing formulation snapshots.
Recipes marked `draft` remain visible but cannot be calculated or planned in
either runtime until their review requirements are resolved.

Both frontends use the same domain transitions, worker commands, IndexedDB
transactions, and version-2 workspace format. The legacy frontend no longer
maintains a separate ERP implementation.

## Timed Production And Multiple Molds

The shared production workbench plans one formulation with multiple mold
allocations. The sum of mold volumes sizes the batch; bar volumes and expected
counts are frozen in its formulation snapshot. Oil and lye readiness are
independent timestamped checkpoints; combining
requires both and establishes the elapsed-time origin. Trace, individual additive
additions, and pour start/end persist as ISO UTC timestamps. Display timers derive
from saved timestamps rather than counting ticks, including after offline reload.
The normal lifecycle cannot bypass the timed pour for these batches.

Additive confirmations can be explicitly recorded as omitted (0 g), without
consuming stock. The pour view names missing confirmations. A separate additive
time correction command requires the previous timestamp and a reason, validates
the new time against the production timeline, and appends a correction audit
entry. It does not change actual weights, consumption costs, or inventory.
Posted batches remain locked.

Pour completion supports an explicit actual finish timestamp, including a past
date. Later corrections require the previous value and a reason. Both the timed
checkpoint and the poured lifecycle date are updated atomically, without changing
consumption or status; corrections cannot cross later lifecycle dates. Manual
backdated entries and corrections retain their entry time in the audit trail.
Zero-gram omissions can be recorded later than the physical pour; actual nonzero
additions must still precede the pour end.

New production plans opt into whole-gram weighing. Precise formulation values
remain unchanged, while rounded oil suggestions are balanced to their rounded
total. Actual fields default to those suggestions. Beginning preparation does not
consume stock for these plans: confirming oil readiness, lye readiness, or an
additive atomically records that group's actual grams, stock consumption, frozen
cost basis, and timestamp. Confirmed weights are immutable; identical retries are
no-ops and conflicting retries fail. Partial weighing cannot complete costing or
finished-goods posting. Older batches retain their original consumption behavior.
Sub-gram recipe requirements are flagged as needing a finer scale, never silently
omitted or rounded upward to a potentially excessive dose.

Yield entry records observed counts by size. Estimated trim is planned filled
volume minus the volume of the recorded bars, using the frozen bar geometry.
It is not measured scrap mass and does not classify cure water loss as waste.
Weighed scrap and shredded material remain optional independent observations.
Mixed-size material costs are allocated by bar volume, including absorbed trim
cost, and finished-goods posting uses the per-size cost basis.

Unstarted plans may be explicitly replaced by one reviewed plan. Replacement is
revision-bound, refuses consumed/started/parent allocations, retains a recovery
snapshot, and writes an audit entry. No automatic conversion or live-stock rebuild
occurs on upgrade. Same-weight additive substitutions are batch-specific and
preserve the reference oil weight; unverified substitute density is disclosed in
the frozen calculation warnings instead of being silently guessed.

## Storage And Recovery

The database remains `red-mountain-soap-suite`, with the `documents/workspace`
key unchanged. Storage version 2 adds recovery, preview, and acknowledged-mutation
stores. A mutation reads, validates, computes, and commits within one read/write
transaction. Independent tabs cannot overwrite each other's read/modify/write
operations. Command acknowledgement happens after transaction completion.

Mutation identifiers are separate from message identifiers. Retrying a mutation
with the same identifier and payload returns the previous outcome; reusing it
with different contents fails. Entity identifiers are UUID-based. Broadcast
notifications refresh other clients without refreshing the originating client.

Version-1 migration preserves the original document in recovery storage and
retains balances. It flags historical applications for review instead of
deducting ingredients or reapplying receipts during upgrade. Recovery snapshots
are also retained before confirmed imports, resets, and reconstruction commits.
They remain local to this browser origin and are not a substitute for exported
backups or an operating-system backup.

Use **Files > Data Review > Review backup** to inspect a replacement. Only
confirmation replaces the workspace. A preview cannot commit after another
mutation changes the workspace. **Recovery snapshots** uses the same review and
confirmation path. Reset also requires confirmation.

## Reconstruction

Export the Python operating records without modifying them:

```powershell
.\.venv\Scripts\python.exe engine\cli.py --data-dir C:/Private/SoapData export-history
```

The command prints JSON to standard output. This export contains private
operating information; do not add its output to the public demo dataset.

In either frontend's Files view, choose a history JSON source or use the current
workspace. Enter the opening date and explicitly confirm quantities and unit
costs before the first event on that date. Zero is an explicit opening balance,
not an automatically inferred value. Add any substantiated dated adjustments
with a quantity change, value change, and reason.

Preview reconstruction before confirming. The preview compares old and proposed
quantities and values, and lists blockers and ordering assumptions. Events before
the opening date are represented by the confirmed opening balances, not replayed.
Same-day events run in this order: receipts, adjustments, consumption, finished
goods; ties use the identifier. Missing historical consumption, cure/yield data,
costs, or negative balances must be corrected in the history source or supported
by explicit adjustments. No balancing entries are invented. A blocked or stale
preview cannot replace live data. Successful commits retain source inputs and an
audit entry along with the pre-commit recovery snapshot.
Reconstruction preserves the current asset register; a history source supplies
stock-related recipes, receipts and batches. Use reviewed backup import when
replacing non-stock records as well.

## Calculation And Cost Rules

Calculation version 3 scales a complete formulation using the sum of individual
ingredient volumes. It includes configured additives and lye purity, validates
fragrance limits, and makes total mass equal ingredient mass. This additive-volume
model is an estimate, not a measured manufacturing yield or measured mixture
density. `oilRatio`/`oil_ratio` is accepted for compatibility but no longer controls
sizing; the returned calculation includes a deprecation warning. Recipe defaults
apply when fragrance percentage is not explicitly supplied.

New planned batches save their inputs and recipe/formulation snapshot. Prepping
consumes stock once and freezes its cost basis. Children inherit parent allocation
and consume only their own extra materials. Cut yield is observed input, never
copied from expected yield. Posting requires a cured leaf batch, positive actual
yield, and complete costs. Posting and its lifecycle action share one operation.

Receipt amounts normalize `total` and `amount_usd`; conflicting aliases or totals
fail validation. Separate tax is additive unless an explicit tax line already
exists. Tax and non-inventory expenses are retained, not capitalized into material
inventory. Volume-based stock requires known density; unknown units are errors.

Monthly amortization uses the requested report date, zero residual value, and
purchase-month-inclusive straight-line allocation for the configured number of
months. It is a management estimate, not a tax depreciation schedule.

## Verification

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
npm ci
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe engine\cli.py validate
npx playwright install chromium
npm run check
```

The integrity browser suite runs against both production builds, using isolated
browser contexts and local-only data. It covers production, concurrent tabs,
backup preview/recovery, reconstruction blockers, offline reload, and mobile
layout. Screenshots and failure traces go under `output/playwright/integrity`.
