# Red Mountain Soap Suite

Plan a batch, weigh ingredients, record cut yield and cure weights, and track inventory and costs. Operations is the main app. It opens on Production with fictional records and saves in this browser by default. No account or server is required for storage.

## Quick start

Install Node.js 24. From the extracted `erp/` directory (the one containing this README and `package-lock.json`), run:

```sh
npm ci
npm run dev
```

Open [Operations](http://localhost:4200/). For the older Vite app, run `npm run dev:legacy -- --port 4173` and open [the prototype](http://127.0.0.1:4173/). Each origin has separate browser storage. Move records with **Settings & Data > Export / Review backup** in Operations. The designer's no-recipe example is a fictional olive, coconut and palm blend, not a production formula.

## Build and verify

To build just Operations, run `npm run build` with the Node dependencies installed. Python is not required to use either browser app.

For the full checks, install Python 3 and Git. From `erp/`, create a virtual environment with `python -m venv .venv` (use `python3` where that is the Python 3 command). Activate it with `.\.venv\Scripts\Activate.ps1` in PowerShell or `. .venv/bin/activate` in a POSIX shell, then run:

```sh
python -m pip install -r requirements-dev.txt
python engine/cli.py validate
python -m pytest -q
npx playwright install chromium
npm run check
```

The frontend checks compare TypeScript results with the Python engine, build both production PWAs and the Node API, and exercise the apps in isolated browsers, including offline reload. They do not need Git history; the Python export tests create a disposable repository. Angular output is in `dist/apps/operations/browser/` and Vite output in `app/dist/`.

## Data and recovery

The browser seed and Python `demo-data/` are examples. The CLI uses demo fixtures by default and copies them to a scratch workspace for writes. To work with private YAML, pass an explicit absolute directory outside the source tree via `--data-dir` before the command. Keep databases and exported records outside the project. Browser storage is not a backup; export regularly and test a restore.

See [architecture](docs/architecture.md) for the two frontends and storage adapters, and [data integrity](docs/data-integrity.md) for inventory, lifecycle and recovery rules.

## Optional SQLite Workspace

The browser-only app remains the default. To try a separate fictional SQLite workspace on your own computer, use Node.js 24, build both parts, and choose a new database path outside Git:

```powershell
npm run build
npm run build:workspace-api
node dist/apps/workspace-api/cli.mjs init-demo C:/Private/SoapDemo.sqlite
node dist/apps/workspace-api/cli.mjs serve C:/Private/SoapDemo.sqlite 4350
```

Visit `http://127.0.0.1:4350/` and check for **SQLite workspace** in the header. This is a loopback-only single-owner mode, not a hosted or network service. Do not expose it through a proxy or open its port to other machines. The SQLite mode does not use IndexedDB or support offline saves.

Use a new destination each time and keep verified copies on a separate encrypted device. To rehearse recovery, start the restored file on a separate unused port with the original file untouched:

```powershell
node dist/apps/workspace-api/cli.mjs snapshot C:/Private/SoapDemo.sqlite C:/Private/SoapDemo-backup.sqlite
node dist/apps/workspace-api/cli.mjs restore C:/Private/SoapDemo-backup.sqlite C:/Private/SoapDemo-restored.sqlite
node dist/apps/workspace-api/cli.mjs serve C:/Private/SoapDemo-restored.sqlite 4351
```

SQLite snapshots include recovery and retry records. Settings exports portable JSON for workspace interchange, not a full database backup. Do not import operational records until the source records and a restore have been reviewed.

### Choose a provider

Operations resolves `WORKSPACE_DATA_PROVIDER` at startup. With no configuration it uses the current origin's browser database and works offline. The SQLite server supplies its own configuration. To point a separate deployment of the same build at a hosted command endpoint, add this to the served HTML head:

```html
<meta name="soap-suite-workspace" content="endpoint" data-endpoint="https://api.example.com/api/v1/commands">
```

Use a separate origin from any existing offline browser deployment: a previously installed service worker may still serve its old HTML. Serve configured HTML with `Cache-Control: no-store`, without a service worker. Do not put passwords or tokens in the URL. A separate-domain API must allow the exact UI origin, JSON POST and OPTIONS, and implement the worker command contract, atomic writes and mutation-ID deduplication. The adapter does not send cookies across origins. Authentication, tenancy, and billing are not provided; never expose the local SQLite service as that endpoint.

On an interrupted write, keep the page open and choose **Retry unconfirmed save**. It resends the original command; a matching previous commit is returned without repeating it. A rejected write displays the server's error. There is no background queue, browser fallback or synchronization between providers.

### Move a workspace

1. Stop entry on the source. In **Settings & Data**, export JSON. For a new SQLite file run `node dist/apps/workspace-api/cli.mjs init-from-export C:/Private/operations.sqlite C:/Private/source.json`. Both paths must be absolute and outside Git. This creates a new file, preserves the current workspace revision, and does not seed demo records.
2. For an existing destination (including moving back to the browser), export its current contents first. Use **Settings & Data > Review backup**, inspect the replacement and confirm. Imports replace rather than merge and use the destination's next revision.
3. Export the destination and compare its workspace, including batch history, with the source. For a freshly initialized SQLite copy use `node tools/verify-served-copy.mjs C:/Private/source.json http://127.0.0.1:4350/ C:/Private/verified.json`. SQLite snapshots retain database-local recovery and retry records, which do not travel with JSON. Test a snapshot restore into another new file and recheck the source before switching. Keep one writer. To switch back later, export the **latest** authoritative copy, not the original cutover file.

On Windows, after building both parts, `tools/sqlite-runtime.ps1 -Action Stage -Runtime C:/Private/SoapRuntime` copies Node 24, the frontend and the bundled API into a new standalone directory. After verification use `tools/sqlite-runtime.ps1 -Action Enable -Runtime C:/Private/SoapRuntime -Database C:/Private/operations.sqlite` to register and start the current user's limited, hidden sign-in task. Its working directory must remain the installed runtime. Use Windows Task Scheduler to disable/stop **Red Mountain Soap Operations** without deleting the database. Local snapshots protect against mistakes, not loss of the disk.

## License

MIT. See `LICENSE`.
