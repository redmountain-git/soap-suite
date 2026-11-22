import argparse
import json
import yaml
from pathlib import Path
from config import ROOT, configure_dataset
from loader import load_all
from storage.recipes import load_recipes
from batch_generator import add_cost_metrics, calculate_batch, write_prep_file
from batch_sizing import cuboid_volume_in3, batch_volume_from_batch_id
from capacity_domain import (
    capacity_audit_for_batches,
    max_capacity_for_batch,
    max_capacity_for_recipe,
)
from inventory import inventory_from_receipts
from prep import apply_prep_file
from production import (
    create_child_batch,
    post_finished_goods,
    record_batch_event,
    record_child_materials,
    record_cut_yield,
)
import validate as validate
import costing as costing
import accounting as accounting


LIFECYCLE_EVENT_TYPES = (
    "poured",
    "unmolded",
    "cut",
    "cure_started",
    "cure_completed",
    "shredded",
)


def _print_yaml(data):
    print(yaml.safe_dump(data, sort_keys=False).strip())


def _parse_key_value_entries(entries, *, label, value_parser):
    parsed = {}

    for entry in entries or []:
        if "=" not in entry:
            raise ValueError(f"Invalid {label} entry '{entry}'. Use NAME=VALUE.")

        key, raw_value = entry.split("=", 1)
        key = key.strip()
        raw_value = raw_value.strip()

        if not key:
            raise ValueError(f"Invalid {label} entry '{entry}'. Missing name.")

        value = value_parser(raw_value)
        parsed[key] = parsed.get(key, 0) + value

    return parsed


parser = argparse.ArgumentParser()
parser.add_argument("--data-dir", help="Absolute path to an explicit private YAML dataset")
sub = parser.add_subparsers(dest="cmd")

sub.add_parser("validate")
sub.add_parser("export-history", help="Read-only JSON export for reviewed reconstruction")
cost = sub.add_parser("cost")
cost.add_argument(
    "--recompute",
    action="store_true",
    help="Recompute costing for batches already marked costed",
)
sub.add_parser("inventory")
apply_prep = sub.add_parser("apply-prep")
apply_prep.add_argument("prep_ref")
record_event = sub.add_parser("record-batch-event")
record_event.add_argument("batch_id")
record_event.add_argument("event_type", choices=LIFECYCLE_EVENT_TYPES)
record_event.add_argument("--at", default=None)
record_event.add_argument("--notes", default=None)
create_child = sub.add_parser("create-child-batch")
create_child.add_argument("parent_batch_id")
create_child.add_argument("oil_weight_g", type=float)
create_child.add_argument("--recipe-id", default=None)
create_child.add_argument("--batch-id", default=None)
create_child.add_argument("--notes", default=None)
create_child.add_argument("--at", default=None)
record_child = sub.add_parser("record-child-materials")
record_child.add_argument("batch_id")
record_child.add_argument(
    "--material",
    action="append",
    required=True,
    default=[],
    help="Material usage as NAME=GRAMS; repeat for multiple materials",
)
record_child.add_argument("--at", default=None)
record_child.add_argument("--notes", default=None)
record_yield = sub.add_parser("record-cut-yield")
record_yield.add_argument("batch_id")
record_yield.add_argument(
    "--size",
    action="append",
    required=True,
    default=[],
    help="Yield as SIZE=COUNT; repeat for multiple sizes",
)
record_yield.add_argument("--scrap-g", type=float, default=0.0)
record_yield.add_argument("--shredded-g", type=float, default=0.0)
record_yield.add_argument("--at", default=None)
record_yield.add_argument("--notes", default=None)
post_fg = sub.add_parser("post-finished-goods")
post_fg.add_argument("batch_id")
post_fg.add_argument("--at", default=None)
sub.add_parser("account")
sub.add_parser("list-recipes")
mold = sub.add_parser("mold-volume")
mold.add_argument("length_in", type=float)
mold.add_argument("width_in", type=float)
mold.add_argument("height_in", type=float)

batch_volume = sub.add_parser("batch-volume")
batch_volume.add_argument("batch_id")
batch_volume.add_argument("total_oils_g", type=float)
batch_volume.add_argument("--superfat", type=float, default=None)
batch_volume.add_argument("--lye-ratio", type=float, default=None)
batch_volume.add_argument("--liquid", default=None)
batch_volume.add_argument("--fragrance-pct", type=float, default=None)

max_capacity = sub.add_parser("max-capacity")
max_group = max_capacity.add_mutually_exclusive_group(required=True)
max_group.add_argument("--recipe-id", default=None)
max_group.add_argument("--batch-id", default=None)
max_capacity.add_argument("--superfat", type=float, default=None)
max_capacity.add_argument("--lye-ratio", type=float, default=None)
max_capacity.add_argument("--liquid", default=None)
max_capacity.add_argument("--fragrance-pct", type=float, default=None)

capacity_audit = sub.add_parser("capacity-audit")
capacity_audit.add_argument("batch_ids", nargs="+")
capacity_audit.add_argument("--fragrance-pct", type=float, default=None)

calc = sub.add_parser("calculate_batch")
calc.add_argument("volume", type=float)
calc.add_argument("recipe_id")

calc.add_argument("--superfat", type=float, default=None)
calc.add_argument("--oil-ratio", type=float, default=0.68)
calc.add_argument("--lye-ratio", type=float, default=None)
calc.add_argument("--liquid", default=None)
calc.add_argument("--fragrance-pct", type=float, default=None)
calc.add_argument(
    "--with-cost",
    action="store_true",
    help="Include cost_per_oz and cost_per_100g from current inventory pricing",
)

calc.add_argument(
    "--prep",
    action="store_true",
    help="Write batch prep file"
)
calc.add_argument(
    "--output-dir",
    default=None,
    help="Optional override for prep output directory",
)

args = parser.parse_args()

mutates = args.cmd in {
    "cost", "account", "inventory", "apply-prep", "record-batch-event",
    "create-child-batch", "record-child-materials", "record-cut-yield",
    "post-finished-goods",
} or (args.cmd == "calculate_batch" and args.prep)
try:
    if args.cmd == "calculate_batch" and args.prep and args.output_dir and not args.data_dir:
        if (ROOT / args.output_dir).resolve().is_relative_to(ROOT.resolve()):
            raise ValueError("Demo prep output must be outside the application checkout")
    data_root = configure_dataset(args.data_dir, writable=mutates)
except ValueError as error:
    parser.error(str(error))
if mutates and not args.data_dir:
    print(f"Demo scratch workspace: {data_root}")

ctx = load_all()

if args.cmd == "export-history":
    from history_export import export_history
    print(json.dumps(export_history(ctx), indent=2, default=str))
elif args.cmd == "validate":
    validate.validate_all()
elif args.cmd == "cost":
    costing.cost_all_batches(ctx, recompute=args.recompute)
elif args.cmd == "account":
    accounting.post_receipts_to_transactions(ctx)
elif args.cmd == "inventory":
    inventory_from_receipts(ctx)
elif args.cmd == "apply-prep":
    result = apply_prep_file(ctx, args.prep_ref)
    _print_yaml(result)
elif args.cmd == "record-batch-event":
    result = record_batch_event(
        ctx,
        args.batch_id,
        args.event_type,
        at=args.at,
        notes=args.notes,
    )
    _print_yaml(result)
elif args.cmd == "create-child-batch":
    result = create_child_batch(
        ctx,
        args.parent_batch_id,
        args.oil_weight_g,
        recipe_id=args.recipe_id,
        batch_id=args.batch_id,
        notes=args.notes,
        at=args.at,
    )
    _print_yaml(result)
elif args.cmd == "record-child-materials":
    result = record_child_materials(
        ctx,
        args.batch_id,
        _parse_key_value_entries(
            args.material,
            label="material",
            value_parser=float,
        ),
        at=args.at,
        notes=args.notes,
    )
    _print_yaml(result)
elif args.cmd == "record-cut-yield":
    result = record_cut_yield(
        ctx,
        args.batch_id,
        _parse_key_value_entries(
            args.size,
            label="size",
            value_parser=int,
        ),
        scrap_g=args.scrap_g,
        shredded_g=args.shredded_g,
        at=args.at,
        notes=args.notes,
    )
    _print_yaml(result)
elif args.cmd == "post-finished-goods":
    result = post_finished_goods(
        ctx,
        args.batch_id,
        at=args.at,
    )
    _print_yaml(result)
elif args.cmd == "list-recipes":
    recipes = load_recipes()

    print("\nBase Recipes:\n")

    for r in recipes:
        print(r)
        print(f"{r['id']:8}  {r['name']}")

    print()
elif args.cmd == "mold-volume":
    volume_in3 = cuboid_volume_in3(args.length_in, args.width_in, args.height_in)
    _print_yaml({"volume_in3": round(volume_in3, 2)})
elif args.cmd == "batch-volume":
    result = batch_volume_from_batch_id(
        batch_id=args.batch_id,
        total_oils_g=args.total_oils_g,
        superfat_pct=args.superfat,
        lye_ratio=args.lye_ratio,
        liquid_type=args.liquid,
        fragrance_pct=args.fragrance_pct,
    )
    _print_yaml(result)
elif args.cmd == "max-capacity":
    if args.recipe_id:
        result = max_capacity_for_recipe(
            recipe_ref=args.recipe_id,
            inventory_doc=ctx["inventory"],
            units_cfg=ctx["units"],
            density_cfg=ctx["density"],
            sap_cfg=ctx["sap_values"],
            base_recipes=ctx["recipes_base"]["base_recipes"],
            product_recipes=ctx["recipes_product"]["product_recipes"],
            superfat_pct=args.superfat,
            lye_ratio=args.lye_ratio,
            liquid_type=args.liquid,
            fragrance_pct=args.fragrance_pct,
        )
    else:
        target_batch = next(
            (b for b in ctx["production"]["batches"] if b["id"] == args.batch_id),
            None,
        )
        if target_batch is None:
            raise ValueError(f"Batch not found: {args.batch_id}")

        result = max_capacity_for_batch(
            batch=target_batch,
            inventory_doc=ctx["inventory"],
            units_cfg=ctx["units"],
            density_cfg=ctx["density"],
            sap_cfg=ctx["sap_values"],
            base_recipes=ctx["recipes_base"]["base_recipes"],
            product_recipes=ctx["recipes_product"]["product_recipes"],
            superfat_pct=args.superfat,
            lye_ratio=args.lye_ratio,
            liquid_type=args.liquid,
            fragrance_pct=args.fragrance_pct,
        )

    _print_yaml(result)
elif args.cmd == "capacity-audit":
    result = capacity_audit_for_batches(
        batch_ids=args.batch_ids,
        batches=ctx["production"]["batches"],
        inventory_doc=ctx["inventory"],
        units_cfg=ctx["units"],
        density_cfg=ctx["density"],
        sap_cfg=ctx["sap_values"],
        base_recipes=ctx["recipes_base"]["base_recipes"],
        product_recipes=ctx["recipes_product"]["product_recipes"],
        fragrance_pct=args.fragrance_pct,
    )
    _print_yaml(result)
elif args.cmd == "calculate_batch":
    batch_data = calculate_batch(
        volume_in3=args.volume,
        recipe_id=args.recipe_id,
        superfat_pct=args.superfat,
        oil_ratio=args.oil_ratio,
        lye_ratio=args.lye_ratio,
        liquid_type=args.liquid,
        fragrance_pct=args.fragrance_pct,
    )

    if args.with_cost:
        batch_data = add_cost_metrics(
            batch_data=batch_data,
            inventory_doc=ctx["inventory"],
            units_cfg=ctx["units"],
        )

    if args.prep:
        settings = {
            "superfat_pct": batch_data["superfat_pct"],
            "oil_ratio": batch_data["oil_ratio"],
            "liquid_type": batch_data["liquid_type"],
            "lye_ratio": args.lye_ratio,
            "fragrance_pct": args.fragrance_pct,
        }

        path = write_prep_file(
            batch_data,
            args.recipe_id,
            settings,
            output_dir=args.output_dir,
        )

        print(f"\nPrep file written: {path}")
    else:
        _print_yaml(batch_data)
