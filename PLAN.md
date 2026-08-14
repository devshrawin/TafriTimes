# IndianOnion — Fully Automated Social-Only Satire Bot (POC Plan)

## Context

The goal is a POC: an India-specific satirical news brand in the spirit of **The Onion** — and modeled closely on **The Fauxy** (@the_fauxy), India's existing Onion-equivalent (website + social, English/Hindi/Gujarati, satirizing current events/politics/entertainment/sports/public figures) — but published **purely through git and GitHub Actions, with no website at all**. Only two outputs matter: a daily post on **X** and a daily post on **Instagram**. No human writes the content, and no human approves a post before it goes live. The target repo, `devshrawin/IndianOnion`, is currently empty, so this is a from-scratch build, deliberately independent of the `NewsFlick` codebase.

Two things this plan has to solve that a simple "generate and post" pipeline doesn't:
1. **Real images, not just text.** Plain text cards aren't enough — posts need a genuine visual, in the "parody news graphic / meme-screenshot" style common to Indian satire pages (fake breaking-news banners, fake quote/screenshot cards) rather than photorealistic AI-generated images of real people (which carries deepfake/legal risk and needs a second AI vendor Anthropic doesn't offer).
2. **How do you know an AI-written joke is actually funny, with no human reading it first?** This plan treats "funny" as something you approximate two ways: an automated *judge* step before publishing (a proxy), and a *feedback loop* from real engagement data after publishing (the actual ground truth) — see the dedicated section below.

Studied references:
- **The Onion**: AP-style inverted-pyramid news writing, but the *most absurd* detail sits where real journalism puts its most important fact. Nearly every image is custom-made in-house (staged photos or graphics) because the fake world has to look internally consistent.
- **The Fauxy**: "India's answer to The Onion," founded 2018, currently a website with 50+ contributors, covering current events/entertainment/sports/public figures, satire so convincing it's repeatedly been mistaken for real news — a cautionary data point for a zero-human pipeline (see Risks).

## Recommended Architecture (no site — pure social, git-driven)

**No Astro, no GitHub Pages, no site.** The repo is purely: automation scripts, config/prompts, an archive of what was generated (for audit trail + the feedback loop), and the GitHub Actions workflows that do everything. Git itself doubles as the image host (see below) — this is what "everything on git" means concretely.

### 1. Content generation: candidate tournament, not single-shot

Per daily cycle:
- **Topic selection — revised 2026-08-14 (see PROGRESS.md)**: originally rotated India-relevant satire beats (politics, cricket, Bollywood, bureaucracy, festivals, urban life) deliberately *not* pulled from live breaking news, to avoid satirizing a real, currently-newsworthy identifiable person. Owner explicitly chose to move to **real trending-headline mode** instead — higher topical relevance, consciously accepted higher risk (see Known Risks). `scripts/fetch-trending.mjs` pulls India's current top headlines from Google News RSS (free, no key — Google Trends itself has no working free API anymore), filters out anything death/violence/tragedy-adjacent *before* it ever reaches the writer LLM, and skips headlines already used. The real headline becomes the concrete premise (`generation.system.md`'s "Real trending event mode"): real institutions can be named, real named *individuals* still can't be — same hard safety constraints as before, unchanged. Falls back to the original weighted `topics.yaml` beat rotation if the feed is unreachable or exhausted, so a features feed outage doesn't stall the pipeline. Beat-weighting by the engagement-log (see Feedback Loop) still applies to that fallback path once it has data.
- **Generate N candidates** (e.g. 4–5): one Claude call per candidate (varied prompt angle/temperature), each producing structured JSON — headline, slug, short article body, social caption — via tool-use/JSON-schema forcing. System prompt bakes in safety at generation time: no real named private individuals, genericize public figures, target institutions/behavior rather than religion/caste/community.
- **Judge the candidates** (`scripts/judge-candidates.mjs`): a separate Claude call scores all N candidates against an explicit rubric — surprise/incongruity, specificity of invented detail, fidelity to the Onion/Fauxy inverted-pyramid structure, headline punchiness — and returns the top pick with reasoning. This is a single-model tournament (Claude judging Claude), not a multi-vendor panel — cheapest option, no extra API keys, and the mechanism can be upgraded to a multi-vendor panel later without changing the pipeline shape.
- **Dev-time calibration (one-time, not a live gate)**: before relying on the judge rubric, sanity-check it once against a small hand-picked set of real Onion/Fauxy headlines with known reception, to confirm the rubric actually rewards what's structurally "funny" rather than just fluent.

### 2. Automated safety guardrail (still no human)

Same design as previously scoped: a rule-based denylist prefilter (real politician names, protected-category slurs) plus a second, adversarially-prompted Claude call that returns a structured verdict (`pass` / `regenerate` / `block`) on the *winning* candidate — checking for real-named private individuals, communal/religious hatred risk, defamation risk, caste/ethnicity targeting. `regenerate` loops back into candidate generation (max 2 retries, guardrail's reasoning fed back as a negative constraint); persistent `block` skips that day's publish entirely and exits the workflow cleanly. This is a technical gate inside the job graph, not a person.

### 3. Image: generic photorealistic scene photo + text overlay (revised — see PROGRESS.md 2026-08-14)

Original design (below, kept for context) was a flat templated graphic with no photo. Owner feedback: it needs to read as a real news photo at first glance, with the satire only becoming apparent on a closer look. Revised approach:
- The writer LLM also produces `imagePrompt`: a short, generic, anonymous scene description (a location/object/crowd-at-a-distance — never a named person, real logo, identifiable real building, or readable sign text; see `generation.system.md`'s Image prompt section). The guardrail LLM call also checks `imagePrompt` for leakage of real people/logos, same as the article text.
- That prompt is sent to **Pollinations.ai** (`https://image.pollinations.ai/prompt/...`) — free, keyless, no signup, no vendor account needed — to generate a photorealistic-style background photo. Falls back to no photo (flat gradient) if the request fails, so a Pollinations outage never blocks a publish.
- **Satori + resvg** then composites the masthead, category tag, headline, a pull-quote pulled from the article body, and the permanent **"SATIRE" mark** on top of that photo (dark gradient scrim underneath for text legibility) — so the safeguard against being mistaken for real news lives in the same place regardless of which background is used.
- Known quality gap: Pollinations occasionally tiles/mirrors the image at this aspect ratio — acceptable for a POC, worth revisiting if this goes further.
- This still avoids the original deepfake/real-person-likeness concern: `imagePrompt` is constrained to generic anonymous scenes, never a depiction of a real or invented named individual.
- Original flat-graphic-only design (for reference): a small set of reusable fictional graphic templates — a breaking-news-style banner, a fake quote/screenshot card — with headline/quote baked in as text, no photo at all. Needed no image vendor and carried zero deepfake risk by construction, at the cost of reading as a plain graphic rather than "real news at a glance."
- Either way: must use its **own clearly fictional masthead/branding** ("IndianOnion" or similar) — must not copy a real news channel's actual logo/on-air branding, to avoid trademark issues and to avoid *increasing* the "mistaken for real news" risk The Fauxy has already run into. The permanent "SATIRE" mark is a built-in, always-on design safeguard, not a content-judgment step, so it doesn't reintroduce human review.

### 4. Git as the image host (no site, no separate hosting)

- Commit the rendered article record (JSON) and the generated PNG into `content/archive/YYYY-MM-DD-slug/` and push to `main`.
- For Instagram's Graph API, which requires a public image URL to build a media container, use the **jsDelivr GitHub CDN**: `https://cdn.jsdelivr.net/gh/<owner>/IndianOnion@main/content/archive/.../image.png`. This needs no hosting setup at all — it's a free CDN mirror of any public GitHub repo's content. Call jsDelivr's purge endpoint (`https://purge.jsdelivr.net/gh/<owner>/IndianOnion@main/<path>`) immediately after the push to force-refresh the CDN cache before Instagram fetches it, avoiding stale/404 propagation-delay issues.
- X does **not** need a public URL — the image is uploaded directly as bytes via X's chunked media upload endpoint.
- Since there's no site to link to, X posts are **text + image only, no outbound link** — this also drops X's per-post cost to the cheaper ~$0.015/post tier (~$0.45/month at 1/day) instead of the ~$0.20/post-with-link tier.

### 5. Social posting integration

- **X**: OAuth 1.0a user-context (static consumer key/secret + access token/secret, no refresh-token rotation needed for a single bot account) via the `twitter-api-v2` npm package — handles chunked media upload and the v2 tweet endpoint.
- **Instagram**: requires an Instagram Professional (Business/Creator) account linked to a Facebook Page, a Meta Developer App, and the account added as an **Instagram Tester** (avoids full App Review since the app only ever posts to its own account). Publish flow is two plain HTTPS calls: create a media container (jsDelivr image URL + caption) → publish the container. Long-lived token (60-day expiry) is refreshed automatically via a no-interaction weekly workflow that calls Meta's refresh endpoint and writes the new token back into the GitHub secret via the GitHub API (fine-grained PAT with this-repo secrets:write). The one truly manual, non-automatable step is the *first* token issuance (one-time interactive Facebook OAuth consent) and recovery if refresh is ever missed for 60+ days.

### 6. The feedback loop — the actual answer to "how do we know it's funny"

An LLM judge is a **proxy**, not proof of funniness. The real signal is audience reaction, so a separate weekly workflow (`collect-engagement.yml`) pulls metrics for recent posts — X post public metrics (likes/reposts/replies) and Instagram Graph API insights (likes/comments/reach/saves) — and appends them to `data/engagement-log.json`, keyed by topic, template style, and which candidate-generation angle produced the winning post. This log does two things over time, entirely mechanically (no human curation):
- **Re-weights topic selection** — beats with historically higher engagement get sampled more often.
- **Feeds a small number of top/bottom performing past posts back into the generation prompt as few-shot examples** ("these landed, these didn't") — a lightweight, fully automated self-improvement loop driven by real reactions rather than guesswork.

## Repo Structure

```
IndianOnion/
├── .github/workflows/
│   ├── daily-publish.yml            # generate → judge → guardrail → render image → commit → post-x → post-instagram
│   ├── refresh-instagram-token.yml  # weekly
│   └── collect-engagement.yml       # weekly, pulls X/IG metrics into data/engagement-log.json
├── scripts/
│   ├── generate-candidates.mjs      # N writer calls
│   ├── judge-candidates.mjs         # rubric-scoring call, picks winner
│   ├── safety-check.mjs             # denylist prefilter + guardrail call
│   ├── render-image.mjs             # Satori/resvg templated graphic
│   ├── write-archive.mjs            # commits article JSON + image to content/archive
│   ├── post-to-x.mjs
│   ├── post-to-instagram.mjs        # uses jsDelivr CDN URL + purge call
│   ├── refresh-instagram-token.mjs
│   └── collect-engagement.mjs
├── config/
│   ├── topics.yaml                  # beats + rotation/engagement weighting
│   ├── denylist.yaml
│   ├── image-templates/             # fonts, background assets, layout defs (fictional branding only)
│   └── prompts/
│       ├── generation.system.md
│       ├── judge.system.md
│       └── guardrail.system.md
├── content/archive/YYYY-MM-DD-slug/ # article.json + image.png — audit trail + feedback-loop data source
├── data/engagement-log.json
└── package.json
```

## GitHub Secrets Required

| Secret | Purpose |
|---|---|
| `GEMINI_API_KEY` | writer, judge, and guardrail LLM calls (currently Gemini — free tier, see PROGRESS.md; `ANTHROPIC_API_KEY`/Claude was the original design but has no free tier) |
| `X_API_KEY` / `X_API_SECRET` | OAuth 1.0a consumer keys |
| `X_ACCESS_TOKEN` / `X_ACCESS_SECRET` | OAuth 1.0a bot-account tokens |
| `IG_USER_ID` | Instagram professional account ID |
| `IG_ACCESS_TOKEN` | long-lived Graph API token (weekly auto-refreshed) |
| `GH_PAT_FOR_SECRETS` | fine-grained PAT, this-repo secrets:write, used only by the refresh job |

## Prerequisites Before Any Code Is Written

1. X developer account + app (2026 default is pay-per-use billing, no free tier).
2. Instagram Professional account linked to a Facebook Page + Meta Developer App, with IndianOnion added as an Instagram Tester.
3. Complete the one-time interactive OAuth flows for both platforms to mint initial tokens, store as GitHub repo secrets.
4. Anthropic API key with billing enabled.

## Known Risks (explicitly accepted for this POC)

- **Legal exposure is real and not fully solved by the guardrail LLM.** India's 2026 IT Rules synthetic-media amendments have no explicit satire carve-out, and as the *originator* of the content, IndianOnion likely doesn't get safe-harbour treatment the way a host of user content would. The two-call guardrail (generation-time constraints + adversarial review) reduces obvious failure modes but is a probabilistic risk-reducer, not a compliance guarantee. Someone still needs to watch for external complaints/takedown notices even though posting itself is unattended.
- **"Mistaken for real news" risk is higher here than a plain text-only bot — and higher again since switching to a photorealistic photo background** (2026-08-14), since the whole point of that change was to look real at first glance. This is the same trap The Fauxy has already fallen into (a feature for virality, a risk for misinformation complaints), now deliberately leaned into harder. The built-in "SATIRE" mark and fictional-only masthead are the mitigation, not a cure — this tradeoff should get real scrutiny before this goes beyond a POC.
- **Pollinations.ai has no uptime/SLA guarantee** (it's the free, keyless option — see PROGRESS.md). Render falls back to a flat gradient background on failure rather than blocking publish, but image quality/availability isn't guaranteed the way a paid vendor's would be.
- **LLM judging approximates funny, it doesn't guarantee it.** The tournament-and-judge step filters out obviously weak candidates; real quality signal only comes from the post-publish engagement feedback loop, which takes time (weeks) to accumulate before it's useful for re-weighting.
- **Instagram is the most fragile integration.** Meta can change permission/App Review requirements without notice; a broken IG integration fails silently (X keeps working, only IG quietly stops) unless a failure alert is added.
- **Cost**: low tens of $/month — Anthropic calls (N candidates + judge + guardrail, ~6-7 calls/day) at Sonnet-class pricing, X pay-per-use without links (~$0.45/month at 1/day), Instagram Graph API itself free.
- **Live-news ingestion is now on by default (2026-08-14, owner's explicit choice)** — reverses the original "no live-news by design" mitigation above. Satirizing the actual current top India headline each run means the piece is regularly about a real, currently-unfolding real event/institution, which is materially higher legal/reputational exposure than the original evergreen-beats-only design, even with real named individuals still excluded by the unchanged guardrail. This should get real scrutiny before scaling beyond the current archive-only test phase.
- **Google News RSS's own terms restrict it to personal, non-commercial, feed-reader use** — using it to drive an automated content pipeline is a ToS gray area (low enforcement risk in practice, but real). No official free trending-topics API currently exists as an alternative (Google Trends' free RSS is dead, its 2025 official API is alpha/waitlisted).
- **Trending headlines are frequently about real tragedy** (death, violence, disaster, court cases involving victims) — confirmed live on the very first test run. A keyword prefilter in `fetch-trending.mjs` blocks these before they reach the writer LLM, but it's a blunt keyword list, not a guarantee — a borderline tragic story could still slip through untagged.

## Verification (once implemented)

1. Run `generate-candidates.mjs` + `judge-candidates.mjs` locally against a handful of test topics; manually sanity-check the judge's picks and reasoning against intuition before wiring up posting.
2. Run the dev-time judge calibration against a small set of known real Onion/Fauxy headlines to confirm the rubric rewards genuinely funny structure, not just fluency.
3. Trigger `daily-publish.yml` via `workflow_dispatch` end-to-end against test/sandbox social accounts first — confirm generate → judge → guardrail-pass → image render → commit → jsDelivr purge → X post → Instagram post all succeed, and inspect both live posts.
4. Deliberately feed a topic/prompt likely to trip the denylist or guardrail verdict — confirm `regenerate` and eventual `block` behave correctly (no post goes out) rather than silently shipping.
5. Test `refresh-instagram-token.yml` manually once; confirm the GitHub secret is actually overwritten via the API call.
6. After a few days of live cron runs, check `data/engagement-log.json` is populating correctly and that topic-weighting logic reads from it as intended.
