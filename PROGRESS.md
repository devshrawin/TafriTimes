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
