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

## Calculator

Use `npm run release:calculator` with a new `RELEASE_TAG` to prepare a local
`red-mountain-soap-calculator-vX.Y.Z.tar.gz` at the existing `/calculator/` mount.
The commands do not publish. Keep the already pinned calculator v0.1.0 release
and its checksum in the original calculator repository. Only after review and a
separate release should the website point its calculator pin at this repository.

The calculator and its educational reference data were imported from
[`ecd3dab`](https://github.com/redmountain-git/red-mountain-soap-calculator/commit/ecd3dabdae13f38d8c21c1bfcf46d1857357d20c).
The public package names are unchanged. Only the suite's existing
`packages/vector-widgets` implementation is used by both frontends.
