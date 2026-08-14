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

## 2026-08-14 — Hourly workflow verified live end-to-end (two real bugs found + fixed)

- Owner added `GEMINI_API_KEY` as a repo secret and manually triggered the
  workflow three times while debugging, surfacing two real bugs one after
  the other (both now fixed, see commits `fdd4074` and `f2cc8be`):
  1. `if ! timeout ...; then code=$?; fi` captured bash's *negated* exit
     status for the `if` test (always 0/1), never the command's real code —
     broke the guardrail-blocked (exit 3) clean-skip check and misreported
     the actual `GEMINI_API_KEY not set` failure as "exit 0" in the first run.
  2. Bigger one: GitHub Actions runs every `run:` step as `bash -eo
     pipefail {0}` by default — errexit was already ON before our own `set
     -uo pipefail` line executed, and that line only *adds* `-u`/pipefail,
     it cannot turn off an `-e` already active. A single transient Gemini
     503 killed the whole step in 29s on the second run, before any of the
     error-handling logic ran at all. Needed an explicit `set +e`.
  3. Also worth remembering for next time: GitHub's public REST API
     (`/actions/runs`, `/actions/runs/{id}/jobs`) works without auth for a
     public repo's run *metadata*, but actual job **logs** need an admin
     token (403 without one) — no `gh` CLI in this environment either, so
     verifying a workflow's actual failure reason needed the owner to paste
     the log text directly, or opening the run in the Browser tool (which
     shows step names/conclusions and short annotations, but not full logs,
     without being signed in).
- Third trigger succeeded cleanly: real trending story ("Supreme Court
  Directs Bar Council To Issue 'Official Protest Permits'...", genericized
  from a real Bar Council/Nalsar/court story), guardrail passed, image
  rendered with photo background, archived, committed, and pushed
  automatically by the workflow itself — the whole pipeline confirmed
  working unattended, not just in local manual tests.
- Loop is now sleeping ~1h before its next iteration, as designed. Next
  session should check accumulated archive quality after it's had a
  day or two to run per the owner's original test-phase plan.

## 2026-08-14 — Fixed unreliable hourly cron using NewsDigest's self-loop pattern

- Confirmed live: `hourly-trending-publish.yml`'s naive `schedule: cron: "0
  * * * *"` fired **zero times** by 07:00+ UTC despite being registered as
  `active` — checked via `GET /repos/.../actions/runs` (no `gh` CLI in this
  environment, used the public REST API directly with curl).
- This is a known GitHub Actions limitation, and the sibling project
  **NewsDigest** (`K UR Files/Projects/NewsDigest/newsdigest`) hit the exact
  same thing first and documented it in
  `.github/workflows/check-feeds.yml`: `schedule:` is best-effort with no
  SLA and no catch-up for a dropped tick, confirmed there by watching even a
  single hourly cron go 4+ hours with zero fires on that repo.
- Ported NewsDigest's fix directly: one long-lived job loops internally via
  a plain bash `sleep` for the real ~hourly cadence (independent of GitHub's
  scheduler once the job starts), with only a coarse `schedule:` trigger
  (every 6h, offset `:17` to avoid the top-of-hour congestion crowd) to
  restart the chain if a job ever dies. `concurrency: cancel-in-progress:
  true` is safe here for the same reason it was there — each loop iteration
  is a fully independent publish, so cancelling a stale chain and starting
  fresh loses at most one in-flight iteration.
- Also ported their push-conflict retry logic (stash this iteration's
  generated output, hard-reset onto `origin`, restore it, re-commit) rather
  than rebasing, since `content/archive/` and `data/trending-used.json` only
  ever grow — there's no meaningful merge, so the generated output should
  always just win.
- Adjusted for this repo: Node/npm instead of Python/pip, `INTERVAL=3600`
  (vs their 2700s) since we want ~hourly not ~45min, much smaller
  `RUN_CAP`/`RESERVE` since `publish.mjs` runs in well under a minute
  (vs their 20-40 min feed-check runs), and exit code 3 from `publish.mjs`
  (guardrail blocked/exhausted) is treated as a clean "nothing to archive
  this iteration," not a failure.
- Not yet verified live end-to-end (needs `GEMINI_API_KEY` added as a repo
  secret first — owner was walked through the GitHub UI steps for this).
  Next session should check the Actions run history to confirm the loop is
  actually firing roughly hourly and archiving successfully.

## 2026-08-14 — Real trending-headline mode + hourly test scheduler

- **Repo moved**: this project now lives at
  `C:\Users\shrawin.sisodiya\Desktop\K UR Files\Projects\IndianOnion` (owner
  moved it out of `Desktop\IndianOnion`). Use this path going forward.
- Owner wants topic selection to target the actual most-trending India topic
  each run, not just a fixed rotation of evergreen beats — explicitly chose
  the higher-risk **"full real-event satire"** option over a safer
  "category-only" alternative (I raised this as a real fork given it cuts
  against PLAN.md's original no-live-news risk mitigation; noted as a
  conscious decision, not a silent change).
- Research: Google Trends' free RSS feed is dead (404) and there's no real
  free Trends API anymore (2025's official one is alpha/waitlisted, paid
  third-party alternatives only). **Google News RSS**
  (`https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en`) works, is free,
  needs no key — used that instead. Caveat worth remembering: that feed's
  own terms restrict it to "personal, non-commercial, feed-reader use,"
  which an automated pipeline doesn't strictly satisfy — low enforcement
  risk, but a real ToS gray area (see PLAN.md Risks).
- **Immediately hit a real problem this design predicts**: the actual top
  trending story when first tested was a Supreme Court ruling on
  compassionate appointments for people who died in a tragedy — completely
  unsuitable for satire, and would have gone straight to the writer LLM with
  no fixed-beat pipeline ever having to filter for this. Added a keyword
  prefilter (`UNSUITABLE_KEYWORDS` in `scripts/fetch-trending.mjs`) blocking
  death/violence/disaster/tragedy-adjacent headlines *before* they reach
  generation — this runs earlier than the existing denylist/guardrail, which
  only checks the *generated article*, not the source headline.
- New `scripts/fetch-trending.mjs`: fetches + parses the RSS feed (regex-based,
  no new XML dependency), strips Google's " - Source" suffix, filters
  tragedy keywords, and skips headlines already used (tracked in
  `data/trending-used.json`, written immediately when a headline is picked —
  even on a `blocked` outcome — so a bad story isn't retried every hour).
- `publish.mjs`: when no `TOPIC_KEY` is given, now tries a trending headline
  first (falls back to the old weighted-random `topics.yaml` beat if the
  feed is down or exhausted). Added a `guessCategory()` keyword map purely
  for cosmetic accent-color selection in the rendered image, plus a new
  `trending-news` fallback accent (red) for headlines that don't match any
  existing beat's keywords.
- `generation.system.md` got a new "Real trending event mode" section: use
  the real headline as the concrete premise, real institutions can be named,
  but real named *individuals* still can't be (existing hard safety
  constraints unchanged) — the guardrail's existing real-person/defamation
  checks apply exactly as before, unmodified.
- Verified end-to-end: real trending story right now was "Bar Council
  threatens Nalsar students, Cockroach Janta Party roars, order withdrawn" —
  piece written directly parodying that (mandatory courtroom-arguments-
  against-cockroaches training), guardrail passed it, image rendered fine
  with the new red "Trending News" accent.
- **New workflow**: `.github/workflows/hourly-trending-publish.yml` — runs
  every hour (24/day), archive-only (no posting — that's still deliberately
  deferred, see below), for a multi-day test the owner wants to review before
  revisiting posting. Needs `GEMINI_API_KEY` added as a GitHub Actions repo
  secret before it'll actually run — not done yet, no `gh` CLI available in
  this environment to set it programmatically, owner needs to add it via
  GitHub's web UI (Settings → Secrets and variables → Actions).
- Explicitly NOT done: no posting to X/Instagram in this workflow. Owner's
  plan is to let this run for a few days, review the archived output, then
  come back to posting as a separate decision.
- Kicked off a background research agent to survey existing similar
  open-source projects (AI satire-news bots, automated meme/parody
  generators) for architecture ideas and — most usefully — any documented
  failure/controversy stories, since safety is the biggest open risk here.
  Results not in yet as of this entry.

## 2026-08-14 — Photorealistic photo backgrounds + design feedback pass

- Owner feedback on the first rendered image: too plain (flat black box +
  headline, empty middle third), and wanted the card to look like a real
  photo at first glance with satire only visible on a closer look (the
  SATIRE pill). Two rounds of changes:
  1. Redesigned the no-photo template first: added a per-beat accent color
     (`BEAT_ACCENTS` in `render-image.mjs`), a category+date row, and a
     pull-quote (extracted from the article body) filling what used to be
     dead space, with a colored left-border quote card.
  2. Then the bigger change — real photo backgrounds. Tried Gemini's
     image-generation models first (`gemini-3-pro-image`,
     `nano-banana-pro-preview`, etc., discovered via `GET /v1beta/models` on
     the same free key) — every one of them returned `RESOURCE_EXHAUSTED`
     with an explicit `limit: 0` for the free tier. Image generation is not
     actually free on Gemini even though text generation is. Switched to
     **Pollinations.ai** (`https://image.pollinations.ai/prompt/...`) —
     genuinely free, no API key, no signup at all, confirmed working.
- Added `imagePrompt` as a new field the writer LLM produces alongside
  headline/body/caption/slug (`generation.system.md`) — a short, generic,
  anonymous scene description (a location/object/crowd, never a named
  person, real logo, or readable sign text). The guardrail prompt
  (`guardrail.system.md`) now also checks `imagePrompt` for the same
  real-person/logo leakage as the article text, treating it as a
  `regenerate`-worthy issue if it slips through.
- `render-image.mjs` now: fetches the Pollinations photo for `imagePrompt`
  (30s timeout, returns `null` on any failure so a Pollinations outage falls
  back to the old flat-gradient design rather than blocking a publish),
  embeds it as a base64 data URI background via Satori, adds a dark gradient
  scrim for text legibility, and layers the masthead/category/headline/
  pull-quote/SATIRE-mark content on top — same safeguard, new background.
- Verified this actually works and looks convincing at a glance: rendered
  the "ergonomic governance committee" piece with a generated photo of an
  empty government meeting room. Known quality gap: Pollinations sometimes
  tiles/mirrors the image at this aspect ratio (visible on the test render)
  — acceptable for a POC, worth revisiting before this goes further.
- Updated `PLAN.md` §3 to document this design change and the reasoning
  (owner wants "looks real at first glance, satire on closer look," not the
  original flat-graphic-only design), plus a new Known Risks entry: this
  intentionally increases the "mistaken for real news" risk that was already
  flagged as The Fauxy's actual problem, and Pollinations itself has no
  uptime/SLA guarantee.
- Also re-rendered the existing archived Bollywood example
  (`content/archive/2026-08-14-period-drama-slow-motion-runtime/`) with the
  new template for consistency, though without a photo since that entry
  predates the `imagePrompt` field.
- Next: run `publish.mjs` again on a fresh topic now that `imagePrompt` is
  wired into generation, to see a real end-to-end example with a photo
  background from a single pipeline run (everything shown so far was
  assembled by hand from an earlier text-only generation run).

## 2026-08-14 — Swapped to Gemini (free), pipeline verified live end-to-end

- Owner doesn't want to spend money yet, and Anthropic has no free tier at
  all (unlike Gemini's 1,500 req/day free on Flash-tier models). Swapped
  `scripts/lib.mjs`'s `callClaudeForJson` → `callLLMForJson`, now calling
  Gemini's `generateContent` REST endpoint directly (no SDK needed — dropped
  the `@anthropic-ai/sdk` dependency). `ANTHROPIC_API_KEY` → `GEMINI_API_KEY`
  everywhere. X still has no free tier (confirmed via research — killed
  entirely for new developers as of Feb 2026); Instagram Graph API itself is
  free ($0/call, ~200 calls/hour cap) but posting is on hold for now per
  owner's request to focus on the content pipeline first.
- Model selection took real trial and error against a live key — worth
  recording so the next session doesn't repeat it:
  - `gemini-2.5-flash` / `gemini-2.5-flash-lite` — 404, no longer available
    to new API keys as of this session.
  - `gemini-flash-latest` — transient 503 (high demand) when tried.
  - `gemini-3.5-flash` — works, but is a "thinking" model that leaks
    chain-of-thought text into the response even with
    `responseMimeType: "application/json"` set, breaking JSON parsing.
  - `gemini-3.1-flash-lite` — the one that works: plain (non-thinking) model,
    clean JSON output. This is what `lib.mjs` defaults to now.
  - Also hardened `callLLMForJson` to extract the first balanced JSON object
    from the response text instead of a bare `JSON.parse`, after hitting an
    intermittent "unexpected non-whitespace character after JSON" error once
    (root cause not fully confirmed — possibly a rare multi-part response —
    but the balanced-brace extraction is a reasonable defensive fix either
    way).
- **Ran the real pipeline live against Gemini and it works end-to-end**:
  generate → judge → guardrail all produced sensible output, and the guardrail
  correctly passed a clean bureaucracy-committee piece. `publish.mjs`
  (archive phase only, no posting) ran fully — see
  `content/archive/2026-08-14-period-drama-slow-motion-runtime/` for a real
  generated-and-archived example (Bollywood beat, slow-motion period drama
  joke) with its rendered image. Candidate quality read as genuinely funny
  in this session's judgment, not just structurally valid — e.g. a piece
  about a man who moves into a food-delivery app's notification queue, and
  one about sacrificing a goat to Bengaluru's Silk Board flyover for traffic
  luck.
- Next: no strong reason not to just keep running `publish.mjs` against more
  topics/beats to build a feel for consistency and where the guardrail
  actually trips (haven't yet seen a `regenerate` or `block` verdict fire —
  worth deliberately testing that path). Posting (X/Instagram) remains
  deliberately deferred.

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
