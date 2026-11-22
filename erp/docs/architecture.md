# Architecture

Operations is a local-first Angular PWA for solo makers. Its Production, Recipes, Inventory, Finances and Settings & Data views use the same TypeScript commands as the older Vite/Lit app. Both share the formulation library, vector controls and domain rules under `packages/`.

## Storage

With no configuration, Operations runs commands in a worker and commits to IndexedDB. Its injected workspace provider can instead send commands to a loopback Node/SQLite service or to a configured HTTPS endpoint. The Vite app uses browser storage only. A failed remote write never falls back to a second database.

The executor checks mutation identities, applies domain transitions, validates the workspace and commits each mutation atomically. Recovery previews are bound to the destination revision. A portable workspace JSON file moves the business records between providers; a full SQLite snapshot also preserves database-local recovery and retry records.

## Data boundary

The Python CLI defaults to fictional YAML under `demo-data/`. The browser seed lives in `packages/domain-core/src/seed-data.ts`. Only shared measurement constants ship under `data/`; operating records are separate. Formulation math is checked against numerical fixtures in both runtimes. See [Data integrity](data-integrity.md) for lifecycle rules and reviewed reconstruction, and the [quick start](../README.md) for running either app.
