import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, readText, readJson, callLLMForJson, pickWeightedTopic, readYaml } from "./lib.mjs";
import { checkSafety } from "./safety-check.mjs";
import { judgeCandidates } from "./judge-candidates.mjs";
import { writeArchive } from "./write-archive.mjs";
import { fetchTrendingHeadline, getUsedTrendingEntries } from "./fetch-trending.mjs";

const MAX_REGENERATE_RETRIES = 2;
const CANDIDATE_COUNT = Number(process.env.CANDIDATE_COUNT ?? 4);

// Best-effort keyword guess so a trending-headline post still gets a
// per-beat accent color in render-image.mjs — cosmetic only, doesn't affect
// generation or safety.
const CATEGORY_KEYWORDS = {
  cricket: ["cricket", "ipl", "bcci", "test match", "odi", "t20"],
  "bollywood-entertainment": ["bollywood", "actor", "actress", "film", "movie", "box office", "ott"],
  "politics-bureaucracy": ["minister", "parliament", "government", "court", "supreme court", "ministry", "policy", "election"],
  "workplace-corporate": ["startup", "layoff", "ipo", "company", "corporate", "ceo"],
  "festivals-culture": ["festival", "wedding", "temple", "celebration"],
  "urban-life": ["traffic", "metro", "civic", "municipal", "infrastructure"],
};

function guessCategory(title) {
  const lower = title.toLowerCase();
  for (const [key, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return key;
  }
  return "trending-news";
}

/**
 * Builds the synthetic "beat" used when generating from a real trending
 * headline instead of a fixed topics.yaml beat — same shape (key/label/angle)
 * so the rest of the pipeline (judge, guardrail, render accent color)
 * doesn't need to know the difference.
 */
function beatFromTrendingHeadline(headline) {
  return {
    key: guessCategory(headline.title),
    label: "Trending News",
    angle: `real trending headline: "${headline.title}"`,
    trendingHeadline: headline,
  };
}

function markTrendingHeadlineUsed(headline) {
  const log = readJson("data/trending-used.json", []);
  log.push({ title: headline.title, link: headline.link, usedAt: new Date().toISOString() });
  writeFileSync(path.join(ROOT, "data/trending-used.json"), JSON.stringify(log, null, 2) + "\n");
}

async function generateOneCandidate({ system, beat, negativeConstraint }) {
  const base = beat.trendingHeadline
    ? `Write one satirical news article using this real trending Indian news headline as your concrete inspiration:\n\n"${beat.trendingHeadline.title}"\n\nFollow the "Real trending event mode" section of your instructions. Invent a fresh, specific satirical premise based on this real story — do not reuse a generic "X is bad" framing.`
    : `Write one satirical news article for the "${beat.label}" beat.\n\nAngle guidance: ${beat.angle.trim()}\n\nInvent a fresh, specific premise — do not reuse a generic "X is bad" framing.`;
  const userMessage = negativeConstraint
    ? `${base}\n\nIMPORTANT: a previous attempt on this topic was rejected by the safety guardrail for this reason: "${negativeConstraint}". Write a materially different piece that avoids this issue.`
    : base;
  return callLLMForJson({ system, userMessage });
}

async function generateAndJudge({ beat, negativeConstraint }) {
  const system = readText("config/prompts/generation.system.md");
  const candidates = [];
  for (let i = 0; i < CANDIDATE_COUNT; i++) {
    candidates.push(await generateOneCandidate({ system, beat, negativeConstraint }));
  }
  return judgeCandidates({ beat, candidates });
}

/**
 * Phase 1 of the daily pipeline: generate → judge → safety guardrail (with a
 * bounded regenerate loop) → render + archive to disk. Stops here — does NOT
 * post. Posting is a separate phase (scripts/post-published.mjs) run only
 * after the workflow has git-committed and pushed this archive, because
 * Instagram's Graph API needs a public image URL and the jsDelivr CDN only
 * mirrors what's already on `main` (see PLAN.md §4). A persistent `block`
 * verdict exits cleanly without ever reaching archive/post (see PLAN.md §2).
 *
 * Topic selection: if `topicKey` is given, use that fixed beat (mainly for
 * testing a specific beat). Otherwise default to real trending-headline mode
 * (owner's choice — see PROGRESS.md 2026-08-14 — over the safer
 * category-only alternative): fetch India's current top suitable headline
 * (tragedy/violence/death already filtered out by fetch-trending.mjs) and
 * write satire directly about that real story. Falls back to the original
 * weighted-random topics.yaml beat if the feed is unreachable or every
 * fetched headline has already been used.
 */
export async function generateAndArchive({ topicKey } = {}) {
  const topics = readYaml("config/topics.yaml");
  let beat;

  if (topicKey) {
    beat = topics.beats.find((b) => b.key === topicKey);
    if (!beat) throw new Error(`Unknown topic key: ${topicKey}`);
  } else {
    const headline = await fetchTrendingHeadline({ usedEntries: getUsedTrendingEntries() });
    beat = headline ? beatFromTrendingHeadline(headline) : pickWeightedTopic(topics.beats);
    // Record the headline as used immediately (not just on eventual success)
    // so a blocked/unusable trending story isn't retried every single hour.
    if (headline) markTrendingHeadlineUsed(headline);
  }

  let negativeConstraint;
  let winner;
  let judgeVerdict;
  let safetyVerdict;

  for (let attempt = 0; attempt <= MAX_REGENERATE_RETRIES; attempt++) {
    const judged = await generateAndJudge({ beat, negativeConstraint });
    winner = judged.winner;
    judgeVerdict = judged.verdict;
    safetyVerdict = await checkSafety(winner);

    if (safetyVerdict.verdict === "pass") break;
    if (safetyVerdict.verdict === "block") {
      console.error(`Blocked: ${safetyVerdict.reasoning}`);
      return { archived: false, reason: "blocked", safetyVerdict };
    }
    negativeConstraint = safetyVerdict.reasoning;
    if (attempt === MAX_REGENERATE_RETRIES) {
      console.error(`Exhausted regenerate retries. Last reason: ${safetyVerdict.reasoning}`);
      return { archived: false, reason: "regenerate-exhausted", safetyVerdict };
    }
  }

  const archiveResult = await writeArchive({ beat, article: winner, judgeVerdict, safetyVerdict });
  const relImagePath = path.relative(ROOT, archiveResult.imagePath).replace(/\\/g, "/");

  return {
    archived: true,
    dirName: archiveResult.dirName,
    relImagePath,
    article: winner,
    topicKey: beat.key,
  };
}

async function main() {
  const result = await generateAndArchive({ topicKey: process.env.TOPIC_KEY });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.archived) process.exitCode = 3; // distinct code: blocked/exhausted, not a crash
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
