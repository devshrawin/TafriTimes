import { readJson, readText, callLLMForJson } from "./lib.mjs";
import { pathToFileURL } from "node:url";

const FEED_URL = "https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en";

// Trending news is frequently about real tragedy, not "news in general" —
// death, disaster, violence, court cases involving victims. Those are
// unsuitable for satire regardless of what the generation/guardrail prompts
// would otherwise allow, and shouldn't even reach the writer LLM. This is a
// cheap keyword prefilter, not a content judgment call — deliberately blunt
// and over-inclusive, since the cost of skipping a fine headline is a retry
// but the cost of satirizing a real tragedy is a real problem.
const UNSUITABLE_KEYWORDS = [
  "dies", "dead", "death", "killed", "kills", "murder", "suicide",
  "tragedy", "tragic", "accident", "crash", "collapse", "fire kills",
  "rape", "assault", "abuse", "attack", "terror", "blast", "explosion",
  "riot", "war", "conflict", "flood", "earthquake", "disaster",
  "funeral", "mourns", "grief", "victim", "shot", "stabbed",
];

function isSuitableForSatire(title) {
  const lower = title.toLowerCase();
  return !UNSUITABLE_KEYWORDS.some((kw) => lower.includes(kw));
}

const ENTITY_MAP = { amp: "&", quot: '"', "#39": "'", apos: "'", lt: "<", gt: ">" };

function decodeEntities(text) {
  return text.replace(/&(#39|amp|quot|apos|lt|gt);/g, (_, ent) => ENTITY_MAP[ent]);
}

/**
 * Google News appends " - SourceName" to every title. Strip it so the
 * headline text handed to the writer LLM doesn't include that suffix.
 */
function stripSourceSuffix(title) {
  return title.replace(/\s+-\s+[^-]+$/, "").trim();
}

function parseRssItems(xml) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  return items.map((item) => {
    const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "";
    const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "";
    return {
      title: stripSourceSuffix(decodeEntities(title)),
      link: decodeEntities(link),
      pubDate,
    };
  });
}

// --- Fuzzy dedupe -----------------------------------------------------
// Same problem the NewsDigest project solved for merging the same wire
// story run near-verbatim by multiple publishers: an exact title-string
// match misses "X resigns" vs "X steps down amid pressure" for what's
// really the same real event, and each rephrasing would otherwise get
// satirized as if it were a fresh story. Ported the same shape of fix —
// normalize + a string-similarity ratio above a threshold, gated to a
// recency window — but scoped down for our scale: NewsDigest compares
// ~3,000 articles/run against each other (needed a token-index to avoid
// O(n²)), we compare one candidate headline against a used-log that grows
// by a few entries per day, so a plain per-title scan is fine here.
//
// NewsDigest used Python's difflib.SequenceMatcher (Ratcliff/Obershelp).
// No dependency-free JS equivalent exists, so this uses character-bigram
// Dice coefficient instead — a different but comparably standard
// string-similarity measure for exactly this "same headline, reworded"
// case, without adding a new npm dependency for it.
const DEDUPE_TITLE_THRESHOLD = 0.72; // starting point, not independently tuned — see note above
const DEDUPE_WINDOW_HOURS = 168; // 7 days — a topic recurring weeks later is fair game again, not a duplicate

const TITLE_NOISE_RE = /[^\w\s]/g;

function normalizeTitle(title) {
  return title.toLowerCase().replace(TITLE_NOISE_RE, " ").replace(/\s+/g, " ").trim();
}

function bigrams(str) {
  const result = [];
  for (let i = 0; i < str.length - 1; i++) result.push(str.slice(i, i + 2));
  return result;
}

/** Sørensen–Dice coefficient over character bigrams, 0 (nothing shared) to 1 (identical). */
function diceCoefficient(a, b) {
  const bgA = bigrams(a);
  const bgB = bigrams(b);
  if (bgA.length === 0 || bgB.length === 0) return bgA.length === bgB.length ? 1 : 0;
  const remaining = new Map();
  for (const bg of bgB) remaining.set(bg, (remaining.get(bg) ?? 0) + 1);
  let matches = 0;
  for (const bg of bgA) {
    const count = remaining.get(bg) ?? 0;
    if (count > 0) {
      matches++;
      remaining.set(bg, count - 1);
    }
  }
  return (2 * matches) / (bgA.length + bgB.length);
}

/**
 * True if `title` is close enough to any recently-used title to be treated
 * as the same real-world story rather than a fresh one — catches "same
 * event, different headline wording" that an exact-string check would miss.
 */
function isDuplicateOfRecentlyUsed(title, usedEntries) {
  const normTitle = normalizeTitle(title);
  const cutoff = Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000;
  return usedEntries.some((entry) => {
    const usedAt = Date.parse(entry.usedAt ?? "");
    if (!Number.isNaN(usedAt) && usedAt < cutoff) return false;
    if (entry.title === title) return true;
    return diceCoefficient(normTitle, normalizeTitle(entry.title)) >= DEDUPE_TITLE_THRESHOLD;
  });
}

// Cheap keyword prefilter catches the obvious cases but misses tragedy
// phrased without a trigger word — confirmed live: "Air India A320 briefly
// lost key flight controls" (a real safety incident) passed the keyword
// list clean since it contains none of UNSUITABLE_KEYWORDS. This LLM check
// runs only on the keyword-and-dedupe survivor(s), not every RSS item, to
// keep the added cost to one call in the common case.
const MAX_SUITABILITY_CHECKS = 8; // bound worst-case LLM calls if several top candidates all get rejected

async function checkSuitabilityWithLLM(title) {
  const system = readText("config/prompts/trending-suitability.system.md");
  const verdict = await callLLMForJson({ system, userMessage: title, maxOutputTokens: 256 });
  return verdict.suitable === true;
}

/**
 * Fetches India top-stories from Google News RSS (free, no API key — see
 * PLAN.md for the ToS caveat: this feed's own terms restrict it to personal,
 * non-commercial feed-reader use, which an automated pipeline doesn't
 * strictly satisfy). Returns the first headline that passes the keyword
 * prefilter, isn't a near-duplicate of a recently-used one (see fuzzy
 * dedupe above), and passes an LLM suitability check, or null if the feed
 * is unreachable or nothing passes within MAX_SUITABILITY_CHECKS attempts.
 */
export async function fetchTrendingHeadline({ usedEntries = [] } = {}) {
  try {
    const response = await fetch(FEED_URL, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const xml = await response.text();
    const items = parseRssItems(xml);
    const candidates = items.filter(
      (item) => item.title && isSuitableForSatire(item.title) && !isDuplicateOfRecentlyUsed(item.title, usedEntries)
    );

    let checked = 0;
    for (const candidate of candidates) {
      if (checked >= MAX_SUITABILITY_CHECKS) break;
      checked++;
      if (await checkSuitabilityWithLLM(candidate.title)) return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

/** Reads the full used-headline log entries ({title, link, usedAt}), for fuzzy-dedupe comparison. */
export function getUsedTrendingEntries() {
  return readJson("data/trending-used.json", []);
}

async function main() {
  const headline = await fetchTrendingHeadline({ usedEntries: getUsedTrendingEntries() });
  process.stdout.write(JSON.stringify(headline, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
