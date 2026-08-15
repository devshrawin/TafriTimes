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

## 2026-08-15 — LLM robustness fix: don't discard valid JSON on MAX_TOKENS

- Caught live (one-off local test, unrelated to the daily pipeline): Gemini
  generated a complete, valid JSON object, then degenerated into an
  infinite repetition of closing brackets (`]}]}...`) until it hit
  `maxOutputTokens` and finished with reason `MAX_TOKENS`. `callLLMForJson`
  (`lib.mjs`) was throwing unconditionally on any non-`STOP` finish reason
  *before* ever attempting to parse — discarding perfectly valid leading
  JSON because of garbage that came after it.
- Fixed: on a non-STOP finish, try `parseLeadingJsonObject` (which already
  exists for balanced-brace salvage) first, and only throw if that also
  fails. General pipeline robustness fix — this degenerate-repetition
  failure mode could in principle hit any `callLLMForJson` call, not just
  the one that surfaced it.

## 2026-08-15 — First real Instagram post; fixed gallery not updating from daily-publish

- **First live post**: owner manually triggered `daily-publish.yml` with
  `post: true`. Confirmed via the archive record (`igMediaId:
  17967940719129510`, `xTweetId: null` — X correctly skipped per the
  previous decoupling fix) and independently via the actual account,
  instagram.com/tafritimes. Headline: "Election Commission Mandates DNA
  Kits For All Political Debates To Resolve Parental Attribution Disputes."
- Owner immediately noticed the post wasn't showing on the gallery
  (devshrawin.github.io/TafriTimes/). Cause: `daily-publish.yml` never
  called `build-gallery.mjs` or touched `docs/` at all — only
  `hourly-trending-publish.yml` did. So anything archived via the daily
  workflow was invisible on the gallery until some unrelated hourly run
  happened to rebuild it. Added the gallery build + `docs` to the commit
  step, and rebuilt locally right away so the post shows up immediately
  rather than waiting for the next hourly iteration.

## 2026-08-15 — Instagram credentials live; decoupled X/Instagram posting

- Owner completed Instagram setup: Meta app "Tafri Times - IG" (use case:
  "Manage messaging & content on Instagram", the correct Instagram-API one,
  not the legacy Pages API), added `instagram_business_content_publish` +
  `instagram_business_manage_insights` permissions, generated a token via
  the dashboard's "API setup with Instagram login" page.
- Verified the token live (`GET graph.instagram.com/v25.0/{IG_USER_ID}`)
  before it went into any secret — resolves correctly to `@tafritimes`.
  `IG_USER_ID` / `IG_ACCESS_TOKEN` added as GitHub repo secrets (owner did
  this manually — no `gh` CLI/token available in this environment to verify
  or set repo secrets directly).
- `post-published.mjs` previously posted to X and Instagram as one
  all-or-nothing step — would have thrown immediately on missing X
  credentials before ever attempting Instagram. Decoupled: each platform
  now checks its own required env vars are *all* present and skips (not
  fails) if not, so Instagram can be tested/enabled independently of X
  being set up at all. A platform whose credentials ARE present still
  fails loudly on a genuine posting error — only a fully-absent credential
  set is treated as "skip."
- X setup deliberately not pursued further for now (owner: "remove x for
  now") — `daily-publish.yml`'s manual `post: true` trigger will currently
  post to Instagram only.
- Not yet done: an actual live test post via `daily-publish.yml` with
  `post: true` hasn't been run yet — next step once the owner wants to
  verify the real end-to-end Instagram publish, not just the token check.

## 2026-08-15 — Fixed Instagram code: wrong API host entirely

- Owner asked for genuinely detailed, current Meta/Instagram setup steps
  (fair complaint — earlier instructions were generic). Research turned up
  something more important than better instructions: **our own Instagram
  code was pointing at the wrong API architecture.**
- Meta has split Instagram posting into two separate flows: the old
  "Facebook Login for Business" (requires a linked Facebook Page, host
  `graph.facebook.com`) and the current **"Instagram API with Instagram
  Login"** (no Facebook Page needed at all, host `graph.instagram.com`).
  `post-to-instagram.mjs`, `refresh-instagram-token.mjs`, and
  `collect-engagement.mjs` were all built against the old host/version
  (`graph.facebook.com/v20.0`) — would have failed outright against tokens
  minted the current way, and `refresh-instagram-token.mjs` was also
  calling the wrong endpoint path (`/oauth/access_token` instead of
  `/refresh_access_token`).
- Fixed all three to `graph.instagram.com/v25.0` (v23.0 reached
  end-of-life June 2026; v25 chosen over the very new v26 for stability
  margin) and the corrected refresh endpoint. Updated `PLAN.md` §5 and the
  prerequisites list to drop the now-incorrect "linked Facebook Page"
  requirement.
- Scope names also changed (`instagram_basic`/`instagram_content_publish` →
  `instagram_business_basic`/`instagram_business_content_publish`,
  deprecated Jan 2025) — relevant when the owner requests the token via
  Graph API Explorer or the app dashboard's permission picker, not
  something our code references directly.
- Confirmed via research: for this exact use case (posting to one's own
  account only, via script), **Standard Access via Instagram Tester is
  sufficient** — no Business Verification or full App Review needed, and
  tokens generated directly from the App Dashboard's "Generate token"
  button (for a Tester account) come out already long-lived, skipping the
  separate short-to-long token exchange step for that path.

## 2026-08-15 — Real logo integrated into every generated image

- Owner supplied final branding: a full square logo design (torn-newspaper
  art style, "TAFRI TIMES" wordmark, tagline "BECAUSE REAL NEWS IS BORING.")
  via a WhatsApp-exported JPEG. The full square doesn't read legibly at the
  small size a per-post masthead bar needs, so cropped it down to just the
  wordmark + red accent stripe (`sharp`, new dependency, used only for this
  one-time crop/resize — not part of the runtime pipeline) and saved as
  `config/image-templates/logo.png` (700px wide, ~45KB).
- `render-image.mjs`: masthead now embeds this real logo image (via Satori's
  `img` node type, base64 data URI) in place of the plain-text "TAFRI TIMES"
  wordmark that was there before. The "SATIRE" pill stays next to it
  unchanged. Footer now shows the new tagline ("BECAUSE REAL NEWS IS
  BORING.", accent-colored) above the existing "Fictional publication. Not
  real news." disclaimer — kept both since the tagline is brand voice, the
  disclaimer is the actual safety-mitigation text from PLAN.md.
- Hit and fixed a real Satori quirk: splitting the tagline into two `span`
  children with a trailing space in the first ("...IS ") collapsed the
  space entirely, running the words together ("ISBORING."). Flex containers
  don't preserve inter-element whitespace this way — fixed with an explicit
  `gap` on a flex row instead of relying on text-node spacing.
- This changes every post going forward; old archived posts keep their
  original plain-text masthead (images are static, never regenerated
  retroactively unless explicitly requested, per the "keep everything"
  instruction from the test-phase).

## 2026-08-14 — Gallery: IST display, ascending sort, IST day boundaries

- Owner flagged the live gallery: times should be IST not UTC, posts within
  a day should read ascending (morning→evening), and the day tabs looked
  "random." Root cause of the last one: `groupByDate` used the UTC calendar
  date as the tab key — a post made at, say, 00:30 IST is 19:00 UTC the
  *previous* day, so a single IST morning was getting split across two
  date tabs.
- Fixed all three in `build-gallery.mjs`: added a fixed `IST_OFFSET_MS`
  (IST has no DST, so a flat +5:30 offset is exact), switched both the
  day-grouping key and the displayed time label to IST, and sort posts
  within each day ascending by timestamp (tabs themselves stay newest-day-
  first, which is the normal "recent posts" convention).
- Verified against the live 14-post archive: times now read 11:45 → 15:44
  IST in order, all under one correctly-bounded day tab.

## 2026-08-14 — Real-name policy: allow harmless whimsy, keep violence/crime hard-blocked

- Owner saw a Babylon Bee headline naming a real athlete in a fictional
  violent scenario ("...Shooting Sophie Cunningham With Rocket Launcher")
  and asked to allow that style. Flagged the actual tradeoff first: the Bee
  operates in the US under real legal protection for absurd public-figure
  satire (*Hustler v. Falwell*) and still got Twitter-suspended over
  exactly this category; India has no equivalent doctrine. Gave three
  options — harmless-naming only, Bee-style violence/crime included, or
  keep the current no-names rule — owner picked the middle one:
  **real public figures can be named, but only for harmless whimsy.**
- This also directly resolves an audit finding from earlier today: the
  guardrail was inconsistent on real names not covered by the 3-name
  denylist (Kohli/Tendulkar passed, Shah Rukh Khan/Ambani blocked, same
  premise) — because the old rule technically said "never name" but the
  model wasn't reliably enforcing it either way. This makes the actual
  behavior an explicit, consistent policy instead of an accidental coin
  flip.
- `generation.system.md`: real public figures nameable for a "mundane
  secret habit / silly belief / harmless incompetence" register only.
  Explicitly still hard-blocked regardless of how absurd or obviously
  fictional: violence, crime (victim or perpetrator), sexual content,
  substance abuse, anything reading as a real reputation-damaging factual
  claim (corruption/fraud/misconduct/scandal), their family/private life,
  or their religion/caste/ethnicity. "Real trending event mode" stays
  stricter than this — still don't name someone whose *actual* real news
  event is the piece's premise, since that's exactly the "mistaken for a
  real claim" risk; the whimsy allowance is for self-contained invented
  asides, not for dramatizing today's real headline about them.
- `guardrail.system.md` check #2 rewritten to match — verified live against
  4 cases: Kohli/SRK harmless-whimsy pieces now both `pass` consistently;
  an invented-violence-against-Ambani piece and a fabricated-tax-fraud-
  against-Tendulkar piece both correctly still `block`. The line holds
  where it needs to.

## 2026-08-14 — Full audit (2 independent agents + manual verification), fixed top 5

Ran a real audit at the owner's request — two agents in parallel (one on
code correctness, one on safety-chain gaps + docs accuracy), then verified
every serious claim myself with actual test scripts before trusting it (a
few agent claims were imprecise; only reporting what I personally confirmed
by execution). Fixed in priority order:

1. **`daily-publish.yml` was one env-var typo away from live autonomous
   posting.** Its posting steps were gated on `dry_run != 'true'`, but on a
   `schedule:` trigger `inputs` is empty so that's always true — a scheduled
   run took the posting path by default. Only reason it never actually
   posted: it passed `ANTHROPIC_API_KEY` while the code needs
   `GEMINI_API_KEY`, so it crashed at step one every morning. **Removed the
   `schedule:` trigger entirely** (posting stays a deliberate, manual,
   explicit-opt-in action — new `post` input defaults to `"false"`), fixed
   the env var, added a `git diff --staged --quiet ||` guard the commit
   steps were missing.
2. **`enforceXCaptionLimit` (post-to-x.mjs) produced captions X rejects.**
   X counts *weighted* length (non-ASCII/emoji/₹ count 2, not 1) — the old
   implementation measured `.length`, so a caption at exactly 280 code units
   was often 281-282 weighted, including via the "…" the function itself
   appends. Verified before and after with real ₹/emoji/no-space-token test
   cases. Also fixed a real double-`(satire)` bug when trailing whitespace
   was present (sliced from the untrimmed string).
3. **The fuzzy dedupe added earlier today doesn't work, and never did.**
   Measured against our own `trending-used.json`: a genuine duplicate pair
   ("BCI threatens Nalsar students" / "CJI disapproves BCI action") scored
   **0.394** on the Dice-coefficient check; an *unrelated* pair scored
   **0.482**. The duplicate band sits below the noise floor — no threshold
   fixes this, character bigrams are the wrong measure for short, heavily
   reworded/abbreviated headlines. Three duplicate pairs got satirized
   twice each on day one. Replaced with semantic dedupe folded into the
   existing LLM suitability call (`trending-suitability.system.md` now also
   returns `duplicateOfIndex` against a list of recently-used titles) — no
   extra API cost, and a model actually resolves "BCI" = "Bar Council of
   India" the way string distance can't. Verified against all 4 known
   duplicate/non-duplicate pairs in the live log: 4/4 correct.
4. **Archive dir collisions silently destroyed posts.** `date-slug` with
   ~24 posts/day risks two same-slug posts overwriting each other's
   `article.json`/`image.png` with no error — already had 3 near-miss slugs
   in one day. `write-archive.mjs` now appends `-2`, `-3`... on collision.
5. **Gallery date tabs were wrong on every CI run.** Used file mtime for
   sorting/grouping, but `actions/checkout` resets every pre-existing
   file's mtime to checkout time — collapsed the whole historical archive
   into "today" and showed checkout time as every old post's publish time.
   Added a real `publishedAt` ISO timestamp written at archive time;
   `build-gallery.mjs` now reads that, falling back to mtime only for
   pre-fix posts that don't have it.
6. **Denylist `"paki"` matched "Pakistan" as a substring** — every
   legitimate India/Pakistan story was auto-blocked, indistinguishable from
   the guardrail working correctly. Fixed to whole-word matching; also
   extended the prefilter to `imagePrompt` (previously unchecked, and the
   one field sent verbatim to an external image service). Committed
   separately (`d45fdac`) right after the audit surfaced it.

**Not yet fixed** (lower priority per the audit, still real): guardrail is
inconsistent on real-named public figures not on the 3-name denylist (Kohli
→ pass, Ambani → block, same premise); guardrail has never once returned
`block`/`regenerate` in 13 live posts — PLAN.md's own required verification
step (deliberately trip it) had never been run before I forced it during
this audit; `(satire)` caption marker is prompt-only, unenforced in code,
missing from 6/13 archived captions; `collect-engagement.mjs` dedupes on
`slug` not `dirName` (collides across days) and loses all progress on one
API failure mid-loop; `postPublished` only records `xTweetId` if Instagram
*also* succeeds, silently orphaning successful X posts from the engagement
feedback loop.

Also researched **The Babylon Bee** as a reference model (owner's request)
— key transferable lessons: they generate ~500 headlines/week and publish
~30 (the filter is the actual product, not the writing), every real
enforcement action against them (Twitter suspension, Facebook removals) was
under hate-speech/incitement policy, not "mistaken for real news" — satire
labeling doesn't protect against that category at all. Full brief with
sources given to owner in chat, not duplicated in this file.

---

## 2026-08-14 — Tone shift: affectionate, not contemptuous

- Owner flagged the "Supreme Court directs historical figures to file
  defamation from the afterlife" piece as reading "anti-India" — clarified
  via a direct question that this wasn't about safety/targeting (guardrail's
  job) but tone: same targets (bureaucracy, institutions) are fine, but the
  *spirit* should be affectionate ribbing, not cynicism implying a system is
  broken/hopeless/corrupt.
- Added a new "Tone: affectionate, not contemptuous" section to
  `generation.system.md` — explicit contrast example ("a committee spends
  six months choosing a font" vs. "the judiciary has collapsed into farce"),
  and an explicit note that this applies especially to real courts/
  Parliament/military/named government institutions in Real trending event
  mode — satirize one invented incident involving them, don't make the
  institution look generally foolish/dysfunctional.
- Added a 5th judge rubric dimension, `warmth`, to `judge.system.md` —
  among candidates, prefer the warmer one even over a more "surprising" but
  cynical one.
- Verified live: same "politics-bureaucracy" beat now produces a piece about
  a government committee formed to optimize paperclip standardization —
  genuinely affectionate/whimsical register, not systemic-collapse framing.
- Did NOT touch the guardrail or denylist — this was a tone/voice change,
  not a safety change, and the two should stay conceptually separate.

## 2026-08-14 — Fuzzy dedupe + LLM suitability check for trending headlines

- Owner explicitly ruled out Reddit r/india as an alternate source ("heavily
  biased") — noted so it doesn't get re-suggested.
- **Fuzzy dedupe**, ported from the sibling NewsDigest project's approach to
  merging the same wire story reworded across publishers: normalize title +
  a string-similarity ratio above a threshold, gated to a recency window.
  NewsDigest uses Python's `difflib.SequenceMatcher`; ported here as a
  dependency-free character-bigram Sørensen–Dice coefficient instead (no JS
  stdlib equivalent to SequenceMatcher, and adding a package for this felt
  like overkill). Threshold `0.72`, window 7 days — both starting points,
  not independently tuned the way NewsDigest's `0.78`/20h were. Scoped down
  from NewsDigest's O(n²)-with-token-index version since we compare one
  candidate against a used-log growing by a handful of entries/day, not
  ~3,000 articles/run — a plain per-title scan is fine at this scale.
  `fetch-trending.mjs`'s `getUsedTrendingTitles()` → `getUsedTrendingEntries()`
  (needs full `{title, usedAt}` records now, not just title strings);
  `fetchTrendingHeadline()`'s `excludeTitles` param → `usedEntries`.
- **LLM suitability check** (`config/prompts/trending-suitability.system.md`):
  added after the keyword prefilter demonstrably missed a real case live —
  "Air India A320 briefly lost key flight controls" (a real safety incident)
  passed the keyword list clean since it contains none of
  `UNSUITABLE_KEYWORDS`. One extra Gemini call per candidate headline (not
  every RSS item — only run on keyword-and-dedupe survivors, bounded to 8
  checks worst-case) asking "is this suitable satire raw material, given
  these reject criteria" — catches tragedy phrased without a trigger word.
  Confirmed live: correctly rejected the Air India headline, fell through to
  the next candidate.
- That next candidate was itself a good stress test: a real Supreme Court
  ruling naming a real politician (Rahul Gandhi) over comments about a real
  historical figure (Savarkar) — not tragic/violent, so correctly not
  fetch-trending's job to filter. Ran it through the full pipeline: the
  writer genericized away from naming him entirely and landed on "Supreme
  Court directs historical figures to file defamation complaints from the
  afterlife" — clearly parodying the real story's absurdity without naming
  anyone real. Guardrail passed it clean. Good end-to-end validation of the
  safety chain on a genuinely sensitive real headline, archived as
  `content/archive/2026-08-14-supreme-court-afterlife-defamation-ruling/`.

## 2026-08-14 — Rebranded "IndianOnion" → "Tafri Times"

- Owner's call, scope confirmed explicitly: rename **everything**, including
  the GitHub repo itself, not just in-content branding.
- Done in this session: masthead text in `render-image.mjs` ("TAFRI TIMES"),
  all three system prompts (`generation`/`judge`/`guardrail`.system.md),
  `build-gallery.mjs`'s page title/heading, `post-published.mjs`'s
  `GITHUB_REPO` fallback constant, `package.json`'s `name` field
  (`tafri-times`, lockfile re-synced), README.md's title, and PLAN.md's
  title/repo-structure diagram/prerequisites/risks mentions (kept the two
  spots in PLAN.md that narrate the actual history of the original name as
  historical record, not scrubbed). Also re-rendered all 10 existing
  archived images so the gallery doesn't have a mix of old/new mastheads,
  and rebuilt `docs/index.html`.
- **Not done — needs the owner, no token/gh CLI available here**: the
  actual GitHub repo rename (`devshrawin/IndianOnion` →
  `devshrawin/TafriTimes`, Settings → repository name) and the local folder
  rename (currently still `K UR Files/Projects/IndianOnion`). Once the repo
  is renamed on GitHub: update the local git remote
  (`git remote set-url origin https://github.com/devshrawin/TafriTimes.git`),
  and note the Pages URL becomes `https://devshrawin.github.io/TafriTimes/`
  (GitHub keeps the old URL working via redirect for a while, but that's
  the new canonical one to bookmark).
- Not changed: `data/trending-used.json` and existing `article.json`
  records — these are data, not branding, no name string to change.

## 2026-08-14 — GitHub Pages gallery live; explicit "don't clean up yet" instruction

- GitHub Pages enabled (branch-based, `main`/`docs`) — live at
  **https://devshrawin.github.io/IndianOnion/**. Note for next session: the
  Source dropdown in Settings → Pages has two modes — "Deploy from a
  branch" (what this needs, zero workflow steps, matches NewsDigest's
  approach) vs "GitHub Actions" (needs `actions/deploy-pages` steps we
  don't have). If the site ever goes 404 again, check that dropdown first.
- **Owner instruction, keep this in mind**: keep every archived test post
  through this week-long test phase — do NOT add any pruning/cleanup logic
  for `content/archive/`, `docs/images/`, or `data/trending-used.json`.
  Cleanup is explicitly a *later* decision, only once posting to social
  media actually begins. As of this entry nothing deletes anything anyway
  (the pipeline is purely additive), so this is a "don't add cleanup," not
  "undo something" — but worth remembering before ever suggesting an
  archive-size cleanup pass.

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
