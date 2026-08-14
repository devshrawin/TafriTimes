# Progress Log

Convention: every session working on this repo commits and pushes a dated entry
here (newest first) after any real milestone — a decision made, a script written,
a workflow wired up, a credential set up, a test run and its result. The goal is
that a brand-new session (or a human) can read this file plus `PLAN.md` and have
full context without depending on any chat history, since chat sessions are
ephemeral and get reclaimed.

Rule of thumb: if it would be a shame to lose it, commit it. Don't batch work
locally across a whole session and push once at the end — push after each
meaningful step.

---

## 2026-08-14 — Content pipeline + image rendering implemented

- Built out the full repo structure from PLAN.md: `package.json`,
  `config/topics.yaml`, `config/denylist.yaml`, the three system prompts
  (`generation`/`judge`/`guardrail`.system.md), and all `scripts/*.mjs`.
- Implemented and locally verified (no ANTHROPIC_API_KEY available in this
  session, so only the non-LLM pieces were actually run):
  - `render-image.mjs` — Satori + resvg templated graphic, fictional
    "THE INDIAN ONION" masthead + permanent "SATIRE" mark baked in. Verified
    by rendering a real PNG from a mock headline.
  - `write-archive.mjs` — writes `content/archive/YYYY-MM-DD-slug/article.json`
    + `image.png`. Verified end-to-end with mock article data.
  - `safety-check.mjs`'s `runDenylistPrefilter` — verified it blocks a real
    politician name and passes clean text.
- `generate-candidates.mjs`, `judge-candidates.mjs`, the full guardrail LLM
  call, and `publish.mjs`'s regenerate loop are written but **not yet run**
  against a real Anthropic API key — next session (or whenever a key is
  available) should do that before trusting the pipeline.
- Found and fixed a real bug during this build: the `import.meta.url ===
  file://${process.argv[1]}` entrypoint-detection idiom silently fails on
  Windows (path separator/URL mismatch — `main()` never ran, scripts exited
  0 doing nothing) and also crashes outright when a script is `import()`-ed
  as a module rather than run directly (`process.argv[1]` is `undefined`).
  Fixed everywhere to `process.argv[1] && import.meta.url ===
  pathToFileURL(process.argv[1]).href`.
- Split what PLAN.md called a single `publish.mjs` into two phases —
  `publish.mjs` (generate → judge → guardrail → render → archive to disk
  only) and `post-published.mjs` (post to X + Instagram) — because
  Instagram's Graph API needs the image to already be reachable via the
  jsDelivr CDN mirror, which only reflects what's already pushed to `main`.
  Posting before the git push would 404. `.github/workflows/daily-publish.yml`
  now does: archive → commit+push → jsDelivr purge → post-x/post-instagram →
  commit+push again (to persist the tweet/media IDs back into
  `article.json` for `collect-engagement.mjs` to find later).
- `collect-engagement.mjs` scans `content/archive/` for posts from the last
  14 days that have a recorded `xTweetId`/`igMediaId` and aren't already in
  `data/engagement-log.json`, rather than needing IDs passed in manually.
- Wrote all three GitHub Actions workflows (`daily-publish.yml`,
  `refresh-instagram-token.yml`, `collect-engagement.yml`).
- Not done yet: none of the X/Instagram/Anthropic prerequisites from PLAN.md
  are set up, so nothing has actually posted anywhere. Next concrete step is
  either (a) get an ANTHROPIC_API_KEY to test the generate→judge→guardrail
  loop locally, or (b) work through PLAN.md's "Prerequisites Before Any Code
  Is Written" to get real X/Instagram credentials, then trigger
  `daily-publish.yml` via `workflow_dispatch` with `dry_run: true` first.

## 2026-08-14 — Plan finalized, repo seeded

- Confirmed scope: no website — X + Instagram only, everything driven by git +
  GitHub Actions, fully autonomous (no human review before a post goes live).
- Studied reference models: The Onion (AP-style inverted pyramid, absurd detail
  placed as the "lead fact," fully custom in-house imagery) and The Fauxy
  (@the_fauxy — India's existing Onion-equivalent, website-based today, notable
  for satire repeatedly being mistaken for real news).
- Resolved open design questions:
  - Images: templated parody-news-graphic / meme-screenshot style (Satori +
    resvg), fictional masthead + permanent "SATIRE" mark baked into the
    template. No AI image-gen vendor — avoids deepfake risk and a second API
    key/cost.
  - Humor evaluation: single-model tournament — Claude generates N candidates,
    a separate Claude call judges them against a rubric and picks the winner.
    This is a proxy, not proof; the real signal is the engagement feedback
    loop (see PLAN.md §6) that re-weights topics and feeds top/bottom
    performers back into future generation prompts.
  - Image hosting: no separate host — git itself, via the jsDelivr GitHub CDN
    mirror of the committed image file, purged on publish.
- Full architecture, repo layout, secrets list, prerequisites, risks, and
  verification plan written to `PLAN.md` in this repo.
- Nothing has been implemented yet (no scripts, no workflows, no package.json).
  Next session should start with the repo structure in PLAN.md §"Repo
  Structure" and the prerequisites in PLAN.md §"Prerequisites Before Any Code
  Is Written" (X + Instagram developer/API setup is not done yet — this is a
  blocker for the posting scripts, though content-generation scripts can be
  built and tested independently first).
- Session note: an earlier cloud Claude Code session could not get GitHub push
  access approved via its MCP tooling, and file handoff via chat attachment
  also had friction — so the project moved to local Claude Code entirely from
  this point on. If you're a future session reading this: just use normal
  local git, no special handoff needed.
