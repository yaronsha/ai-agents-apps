Vendored from https://github.com/pbakaus/impeccable (Apache-2.0), commit d631a88 (2026-10-08), path .claude/skills/impeccable.

Local patches:
- `scripts/impeccable` checks the downloaded engine against the hashes pinned in `scripts/engine.sha256`, not the `.sha256` sidecar from the same release. A platform with no pinned line refuses the download.
- `scripts/impeccable.cmd` (Windows launcher) is removed, since it still trusts the sidecar.

To update: copy that folder again from upstream, re-apply the patches above, and pin the new engine hashes (VERSION) in the same reviewed PR.

Cautions:
- Don't use `impeccable live` in this repo. It injects a `<script>` for localhost:8400 into the served HTML (e.g. `thailand-trip/app/index.html`) and can patch the CSP; if that gets committed it ships to Cloudflare Pages.
- `/impeccable hooks on` writes `.github/hooks/impeccable.json`, a committed file. Keep it out of unrelated PRs.
