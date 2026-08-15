# Disabled workflows

These are moved out of `.github/workflows/` on purpose — GitHub Actions
only scans that exact folder, so a file here doesn't run, isn't scheduled,
and doesn't show up in the Actions tab at all. Nothing is deleted; this is
just how you fully hide a workflow (not merely disable-and-gray-out) while
keeping the code for later.

**To reactivate one**: move it back into `.github/workflows/` (`git mv
.github/workflows-disabled/<file>.yml .github/workflows/<file>.yml`),
commit, push.

## Why each one is here

- **`daily-publish.yml`** — manual-trigger-only posting workflow, superseded
  by `hourly-trending-publish.yml` now that the hourly loop posts
  automatically (see PROGRESS.md 2026-08-15). Kept in case a one-off manual
  post (e.g. forcing a specific `topic_key`) is ever needed outside the
  normal hourly cadence.
- **`collect-engagement.yml`** — the engagement-feedback-loop collector.
  Not yet useful: it needs `xTweetId`/`igMediaId` on archived posts, which
  only exist since automatic posting just went live — there's no real
  engagement data to collect yet. Reactivate once there's a meaningful
  backlog of live posts to pull metrics for.
- **`refresh-instagram-token.yml`** — refreshes the 60-day Instagram token
  automatically. **Do not forget this one** — reactivate before the current
  `IG_ACCESS_TOKEN` is ~60 days old, or Instagram posting will silently
  start failing until a new token is issued manually.
