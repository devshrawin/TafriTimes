# Tafri Times

An India-specific satirical news brand — in the spirit of The Onion / The Fauxy —
generated and published entirely through git and GitHub Actions, with no
human reviewing a piece before it's archived.

**Status (2026-08-14): content pipeline is live and running unattended.**
Posting to X/Instagram is deliberately not wired up yet — see "What's not
done" below. Read `PROGRESS.md` for the full dated history; this file is
just the current end-to-end shape of the system.

## View the output

Generated posts are published as a browsable gallery site (GitHub Pages,
served from this repo's `main` branch `/docs` folder) — a dated-tabs view,
newest day first, each tab showing that day's posts by hour with the
rendered image and full article text. Enable it once under this repo's
**Settings → Pages → Source → Deploy from a branch → `main` / `/docs`** if
not already on; it auto-republishes on every push, no separate deploy step.

## How it works, end to end

1. **Topic selection** (`scripts/fetch-trending.mjs`) — fetches India's
   current top headlines from Google News RSS (free, no API key), strips
   Google's added "- Source" suffix, filters out anything death/violence/
   disaster/tragedy-adjacent via a keyword prefilter (confirmed necessary
   live — the very first fetch surfaced a story about a fatal accident),
   and skips headlines already used (tracked in `data/trending-used.json`).
   Falls back to a fixed weighted-random beat from `config/topics.yaml`
   (politics, cricket, Bollywood, urban life, festivals, workplace) if the
   feed is unreachable or every fetched headline is already used.

2. **Candidate generation** (`scripts/generate-candidates.mjs`,
   `config/prompts/generation.system.md`) — an LLM (currently Google
   Gemini, `gemini-3.1-flash-lite` — free tier, ~1,500 req/day, no card;
   picked after `gemini-2.5-*` turned out 404'd for new keys and
   `gemini-3.5-flash`'s chain-of-thought leaked into JSON output) writes N
   independent candidate articles for the same topic/headline: headline,
   slug, body, social caption (must end with an explicit "(satire)" marker
   — a pixel-level watermark alone isn't enough, per real-world precedent
   below), and an `imagePrompt` for a generic, anonymous photo scene.
   Hard safety constraints baked into every generation call: never name a
   real private individual; genericize real public figures by role, not
   name; never target a religion/caste/ethnicity as the joke's object.

3. **Judging** (`scripts/judge-candidates.mjs`,
   `config/prompts/judge.system.md`) — a separate LLM call scores all N
   candidates on surprise, specificity, Onion-style inverted-pyramid
   structure, and headline punchiness, and picks a winner with reasoning.

4. **Safety guardrail** (`scripts/safety-check.mjs`) — two layers on the
   winning candidate: a cheap deterministic denylist prefilter
   (`config/denylist.yaml` — slurs, communal flashpoint terms, a short list
   of high-risk real names), then an adversarial LLM guardrail call
   (`config/prompts/guardrail.system.md`) checking for real-named
   individuals, defamation risk, communal/caste targeting, and
   `imagePrompt` leakage. Returns `pass` / `regenerate` / `block`.
   `publish.mjs` loops back into generation on `regenerate` (feeding the
   guardrail's reasoning back as a negative constraint, up to 2 retries)
   and exits cleanly with nothing archived on `block` or exhausted retries.

5. **Image rendering** (`scripts/render-image.mjs`) — fetches a
   photorealistic-style background photo from **Pollinations.ai** (free,
   no API key — Gemini's own image models turned out to have zero free-tier
   quota despite text being free) based on the `imagePrompt`, then
   composites the masthead, a per-beat accent color, category + date, the
   headline, a pull-quote pulled from the article body, and a permanent
   **"SATIRE" mark** on top via Satori + resvg. Falls back to a flat
   gradient background if Pollinations is unreachable, so an outage there
   never blocks a publish.

6. **Archiving** (`scripts/write-archive.mjs`) — writes the article record
   (JSON, including the judge/guardrail verdicts and the source headline if
   any) and the rendered PNG to `content/archive/YYYY-MM-DD-slug/`. This is
   git-committed by the workflow, which is also what makes step 7 possible.

7. **Gallery site** (`scripts/build-gallery.mjs`) — regenerates
   `docs/index.html` from everything in `content/archive/` after each
   successful publish, so the Pages site above always reflects the latest
   state.

8. **Scheduling** (`.github/workflows/hourly-trending-publish.yml`) — runs
   the above roughly hourly, unattended. GitHub's plain `schedule:` cron
   trigger is unreliable in practice (confirmed live: a naive hourly cron
   fired zero times) — this instead uses the same fix as the sibling
   NewsDigest project: one long-lived job that loops internally via `sleep`
   for the real cadence, with only a coarse 6-hourly `schedule:` trigger to
   restart the chain if a job ever dies.

## What's not done

- **Posting to X/Instagram** — scripts exist (`post-to-x.mjs`,
  `post-to-instagram.mjs`, `post-published.mjs`) but the hourly workflow
  deliberately only archives, per an explicit decision to review output
  quality over a multi-day test phase first. X also has no free tier as of
  2026 (pay-per-use only); Instagram's Graph API is free but needs a
  one-time Meta Developer App + Instagram Tester setup.
- **Human review of the archive** — the pipeline is fully unattended by
  design, but nothing currently surfaces `regenerate`/`block` verdicts for
  periodic human spot-checking (a "layered moderation" best practice from
  external research — see `PROGRESS.md`).

## Known risk, in short

Topic selection now targets **real, currently trending India news** (an
explicit, consciously-accepted tradeoff — see `PLAN.md`'s Known Risks
section), which is meaningfully higher legal/reputational exposure than an
evergreen-beats-only design would be, even with the guardrail still
blocking real named individuals. The real-world precedent (The Fauxy, India's
actual Onion-equivalent) has already been mistaken for real news
internationally and sent a legal notice to a fact-checker over it — the
"SATIRE" mark and "(satire)" caption text are mitigations, not a cure.

## Reference docs

- **`PLAN.md`** — full architecture rationale, secrets required,
  prerequisites, and the complete known-risks list.
- **`PROGRESS.md`** — dated session-by-session log of every decision, bug
  found, and test run. Read this for *why* something is built the way it
  is, not just what it does.
