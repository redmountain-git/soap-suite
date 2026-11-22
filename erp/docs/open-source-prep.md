# Open-Source Prep Checklist

- Review each entry in `tools/public-files.txt`. New files are private unless named explicitly. Export a checkpoint with `python tools/export_release_candidate.py ABSOLUTE_NEW_DIRECTORY --ref COMMIT`; uncommitted and staged edits are not inputs. The exporter rejects workspace backups and database files before writing the candidate.
- Use `demo-data/` and the app seed data for screenshots, hosted demos, and portfolio walkthroughs.
- Run `cli.py validate` before publishing a release.
- Run the full pytest suite from `erp/` before publishing a release.
- Review fixture values as well as names and IDs. Keep real formulations private; changing a recipe name does not make its composition fictional.
- Review the candidate and built assets together for secrets or business details. Do not publish the original repository history.
- Prefer small visible releases over large private rewrites.
- Do not add hosted auth, billing, CRM, or OCR before the local production workflow is useful.
