# Browser release for /suite/

Build from a clean public checkout, with Node 24 and the committed lockfile.
Run `npm ci` in `erp/`, set `RELEASE_TAG` to the intended release tag (e.g.
`v0.1.0`), and run `npm run release:browser`. This builds only the Angular
browser app at `/suite/`; the normal `npm run build` still targets `/`.
The archive and SHA-256 file are in `dist/releases/`. Do not package the source
checkout, workspace API, database or local backups.

After testing the assembled site, attach the verified archive and checksum to
a GitHub Release at the exact source commit. Consumers pin the asset version and
checksum. A suite release does not promote a website or deploy a server.
