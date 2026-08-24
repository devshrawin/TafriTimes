import { writeFileSync, readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, readText, readJson, callLLMForJson, pickWeightedTopic, readYaml } from "./lib.mjs";
import { checkSafety } from "./safety-check.mjs";
import { judgeCandidates } from "./judge-candidates.mjs";
import { writeArchive } from "./write-archive.mjs";
import { fetchTrendingHeadline, getUsedTrendingEntries, checkCandidateWithLLM } from "./fetch-trending.mjs";

const MAX_REGENERATE_RETRIES = 2;
const CANDIDATE_COUNT = Number(process.env.CANDIDATE_COUNT ?? 4);

// Audited 2026-08-16: 76% of headlines followed the same "[Institution]
// mandates/announces [absurd thing]" AP-report shape. Picking one format
// per run (all N candidates in a batch share it, so the judge compares
// apples-to-apples) forces real structural variety instead of leaving it to
// the model's own discretion, which had settled into one groove.
// standard-report kept as the largest single slice (~35%) since it's the
// most reliable shape, per the audit's "cap it, don't eliminate it"
// recommendation -- the other five split the remaining ~65%.
export const FORMATS = [
  { key: "standard-report", weight: 35, instruction: "" },
  {
    key: "wire-brief",
    weight: 13,
    instruction:
      "Write this as a WIRE BRIEF, not a full report: 1-2 short sentences total for the body, no multi-paragraph structure, punchy and terse like a breaking-news ticker line.",
  },
  {
    key: "vox-pop",
    weight: 13,
    instruction:
      "Write this as a VOX POP: no traditional report paragraphs — instead, 4-5 short invented quotes from different ordinary named-by-role people (a commuter, a shopkeeper, a student, etc.) reacting to the absurd premise, one quote per line in the body.",
  },
  {
    key: "listicle",
    weight: 13,
    instruction:
      'Write this as a LISTICLE: headline should read like "N Things [X] Also Now Regulates/Requires/Includes" (or similar), and the body should be a numbered list of 4-6 short absurd items, one per line, not prose paragraphs.',
  },
  {
    key: "first-person",
    weight: 13,
    instruction:
      "Write this as a FIRST-PERSON account: the body is a short confessional/op-ed narrated by an ordinary invented person directly affected by the absurd premise, in their own voice, not a third-person report.",
  },
  {
    key: "fake-interview",
    weight: 13,
    instruction:
      "Write this as a FAKE INTERVIEW: the body is a short Q&A transcript between an invented interviewer and an invented subject discussing the absurd premise, formatted as alternating Q: / A: lines.",
  },
];

function pickFormat() {
  const total = FORMATS.reduce((sum, f) => sum + f.weight, 0);
  let r = Math.random() * total;
  for (const format of FORMATS) {
    r -= format.weight;
    if (r <= 0) return format;
  }
  return FORMATS[0];
}

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

/**
 * Manual mode: user supplies the exact premise/scenario directly (e.g. "CM
 * announces ban on Hindi films...") instead of it coming from RSS. Kept as
 * its own `manualPremise` field (checked first in generateOneCandidate) so
 * the model is told to refine this premise rather than invent a new one —
 * unlike beatFromTrendingHeadline, where inventing a fresh angle on a real
 * headline is the point. Still carries `trendingHeadline` so the guardrail's
 * stricter "Real trending event mode" check (real institutions/public
 * figures) applies the same way it would to a fetched headline.
 */
function beatFromManualTopic({ premise, context, sourceUrl }) {
  return {
    key: guessCategory(premise),
    label: "Manual Topic",
    angle: `human-supplied premise: "${premise}"`,
    manualPremise: premise,
    manualContext: context || undefined,
    trendingHeadline: { title: premise, link: sourceUrl || undefined },
  };
}

/**
 * Pulls the article's own lead photo from its `og:image`/`twitter:image` meta
 * tag, so a manual post backed by a real source link doesn't need a manual
 * upload -- the source article's actual photo becomes the background, which
 * reads better than an unrelated AI-generated stand-in. Returns null on any
 * failure (blocked fetch, no matching tag) so the caller falls back to the
 * Pollinations auto-generate path.
 */
async function fetchOgImageUrl(pageUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(pageUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TafriTimesBot/1.0)" },
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const html = await response.text();
    const match =
      /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i.exec(html) ??
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i.exec(html);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

const RECENT_HEADLINES_LIMIT = 20;

/**
 * Audited 2026-08-16: 76% of archived headlines followed the same
 * "[Institution] mandates/announces [absurd thing]" shape, and the judge
 * has no way to detect this since every dimension scores within-batch only
 * -- a 22nd mandate joke scores identically to the first. generateOneCandidate
 * previously had zero memory of anything it had written before, so it
 * could not avoid repeating itself. Feeding back the last N real headlines
 * on every single call (not just on a safety regenerate) gives the model
 * something concrete to differentiate against.
 */
function getRecentHeadlines(limit = RECENT_HEADLINES_LIMIT) {
  const archiveDir = path.join(ROOT, "content/archive");
  if (!existsSync(archiveDir)) return [];
  const posts = readdirSync(archiveDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const articlePath = path.join(archiveDir, entry.name, "article.json");
      if (!existsSync(articlePath)) return null;
      try {
        const record = JSON.parse(readFileSync(articlePath, "utf8"));
        const timestamp = record.publishedAt ? Date.parse(record.publishedAt) : statSync(articlePath).mtimeMs;
        return { headline: record.headline, timestamp };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
  return posts.map((p) => p.headline).filter(Boolean);
}

function markTrendingHeadlineUsed(headline) {
  const log = readJson("data/trending-used.json", []);
  log.push({ title: headline.title, link: headline.link, usedAt: new Date().toISOString() });
  writeFileSync(path.join(ROOT, "data/trending-used.json"), JSON.stringify(log, null, 2) + "\n");
}

function buildAntiRepetitionBlock(recentHeadlines) {
  if (recentHeadlines.length === 0) return "";
  const list = recentHeadlines.map((h) => `- ${h}`).join("\n");
  return `\n\nAVOID REPEATING RECENT HEADLINES. Here are the last ${recentHeadlines.length} pieces already published:\n${list}\n\nDo NOT write another "[Institution] mandates/announces/introduces [absurd thing]" piece if several of the above already follow that shape — vary the structure: consider a first-person account, an ordinary person as the subject instead of an institution, a listicle, a fake interview, or a wire-brief instead of a full report. Do not invent another "Ministry of [Abstract Noun]".`;
}

async function generateOneCandidate({ system, beat, negativeConstraint, recentHeadlines, format }) {
  const base = beat.manualPremise
    ? `Write one satirical news article. The user has given you the exact real-world premise/scenario below — this IS the story. Do NOT swap it for a different, unrelated joke and do NOT invent a new premise. Your job is to refine and dress it up: sharpen the phrasing, add plausible absurd corroborating details (quotes, numbers, named-by-role reactions), and give it a satirical news voice, while keeping the central scenario intact and recognizable.\n\nPremise:\n"${beat.manualPremise}"${beat.manualContext ? `\n\nAdditional context/tone notes from the user, incorporate these: ${beat.manualContext}` : ""}\n\nFollow the "Real trending event mode" section of your instructions for how to handle real institutions/public figures named in the premise.`
    : beat.trendingHeadline
    ? `Write one satirical news article using this real trending Indian news headline as your concrete inspiration:\n\n"${beat.trendingHeadline.title}"\n\nFollow the "Real trending event mode" section of your instructions. Invent a fresh, specific satirical premise based on this real story — do not reuse a generic "X is bad" framing.`
    : `Write one satirical news article for the "${beat.label}" beat.\n\nAngle guidance: ${beat.angle.trim()}\n\nInvent a fresh, specific premise — do not reuse a generic "X is bad" framing.`;
  const withFormat = format.instruction ? `${base}\n\nFORMAT: ${format.instruction}` : base;
  const withAntiRepetition = withFormat + buildAntiRepetitionBlock(recentHeadlines);
  const userMessage = negativeConstraint
    ? `${withAntiRepetition}\n\nIMPORTANT: a previous attempt on this topic was rejected by the safety guardrail for this reason: "${negativeConstraint}". Write a materially different piece that avoids this issue.`
    : withAntiRepetition;
  return callLLMForJson({ system, userMessage });
}

async function generateAndJudge({ beat, negativeConstraint, forcedFormat }) {
  const system = readText("config/prompts/generation.system.md");
  const recentHeadlines = getRecentHeadlines();
  const format = forcedFormat ?? pickFormat();
  console.error(`Format for this run: ${format.key}`);
  const candidates = [];
  for (let i = 0; i < CANDIDATE_COUNT; i++) {
    candidates.push(await generateOneCandidate({ system, beat, negativeConstraint, recentHeadlines, format }));
  }
  return judgeCandidates({ beat, candidates, recentHeadlines });
}

// Rubric is 6 dimensions x 1-10 = max 60 (see judge.system.md). Audited
// 2026-08-16: the judge always picked a winner regardless of how weak every
// candidate was -- winning totals across the archive ranged 34-47/50 under
// the old 5-dimension/50-max rubric (a ~68-94% range), so a floor around the
// bottom of that observed range catches genuinely weak batches without
// rejecting the normal case. Below floor, skip archiving entirely rather
// than publish a winner nobody would laugh at.
const QUALITY_FLOOR = 40;

function winnerScore(verdict) {
  const entry = verdict.scores?.find((s) => s.index === verdict.winnerIndex);
  return entry?.total;
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
export async function generateAndArchive({
  topicKey,
  manualTopic,
  manualContext,
  manualSourceUrl,
  manualImage,
  format,
  skipArchive,
  preferSourceImage = true,
} = {}) {
  const topics = readYaml("config/topics.yaml");
  let beat;

  const forcedFormat = format ? FORMATS.find((f) => f.key === format) : undefined;
  if (format && !forcedFormat) throw new Error(`Unknown format: ${format}`);

  if (manualTopic) {
    // Manual mode bypasses fetch-trending.mjs's own RSS pull entirely, so
    // its tragedy/violence keyword prefilter never runs on this text --
    // run the same LLM suitability check it uses on RSS survivors as a
    // stand-in guard against a manually-typed topic about a real tragedy.
    const { ok, verdict } = await checkCandidateWithLLM(manualTopic, []);
    if (!ok) {
      console.error(`Manual topic rejected by suitability check: ${JSON.stringify(verdict)}`);
      return { archived: false, reason: "manual-topic-unsuitable", verdict };
    }
    beat = beatFromManualTopic({ premise: manualTopic, context: manualContext, sourceUrl: manualSourceUrl });
  } else if (topicKey) {
    beat = topics.beats.find((b) => b.key === topicKey);
    if (!beat) throw new Error(`Unknown topic key: ${topicKey}`);
  } else {
    const headline = await fetchTrendingHeadline({ usedEntries: getUsedTrendingEntries() });
    beat = headline ? beatFromTrendingHeadline(headline) : pickWeightedTopic(topics.beats);
    // Record the headline as used immediately (not just on eventual success)
    // so a blocked/unusable trending story isn't retried every single hour.
    if (headline) markTrendingHeadlineUsed(headline);
  }

  // Image priority: (1) a manually uploaded photo always wins, (2) failing
  // that, the source article's own og:image *only if the caller opted in*
  // via preferSourceImage (a real photo of the real story beats an
  // unrelated AI-generated stand-in, but not every source site's lead
  // image is usable/desired, so this is explicit, not silently automatic),
  // (3) failing that, renderImage's existing Pollinations auto-generate
  // fallback runs as-is since effectiveManualImage stays undefined.
  let effectiveManualImage = manualImage;
  let imageSource = manualImage ? "upload" : undefined;
  if (!effectiveManualImage && !skipArchive && preferSourceImage && beat.trendingHeadline?.link) {
    const ogImage = await fetchOgImageUrl(beat.trendingHeadline.link);
    if (ogImage) {
      effectiveManualImage = ogImage;
      imageSource = "source-url";
    }
  }
  if (!imageSource && !skipArchive) imageSource = "generated";

  let negativeConstraint;
  let winner;
  let judgeVerdict;
  let safetyVerdict;

  for (let attempt = 0; attempt <= MAX_REGENERATE_RETRIES; attempt++) {
    const judged = await generateAndJudge({ beat, negativeConstraint, forcedFormat });
    winner = judged.winner;
    judgeVerdict = judged.verdict;

    const score = winnerScore(judgeVerdict);
    if (typeof score === "number" && score < QUALITY_FLOOR) {
      console.error(`Winner scored ${score}/60, below QUALITY_FLOOR=${QUALITY_FLOOR} -- skipping this iteration rather than publishing a weak batch.`);
      return { archived: false, reason: "below-quality-floor", judgeVerdict };
    }

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

  if (skipArchive) {
    return { archived: false, skipped: true, article: winner, judgeVerdict, safetyVerdict, topicKey: beat.key };
  }

  const archiveResult = await writeArchive({ beat, article: winner, judgeVerdict, safetyVerdict, manualImage: effectiveManualImage });
  const relImagePath = path.relative(ROOT, archiveResult.imagePath).replace(/\\/g, "/");

  return {
    archived: true,
    dirName: archiveResult.dirName,
    relImagePath,
    article: winner,
    topicKey: beat.key,
    imageSource,
  };
}

async function main() {
  const result = await generateAndArchive({
    topicKey: process.env.TOPIC_KEY,
    manualTopic: process.env.MANUAL_TOPIC,
    manualContext: process.env.MANUAL_CONTEXT,
    manualSourceUrl: process.env.MANUAL_SOURCE_URL,
    manualImage: process.env.MANUAL_IMAGE,
    format: process.env.MANUAL_FORMAT,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.archived) process.exitCode = 3; // distinct code: blocked/exhausted, not a crash
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
