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

// --- Dedupe -----------------------------------------------------------
// History worth keeping (2026-08-14 audit): this started as a character-
// bigram Dice-coefficient similarity check with a 0.72 threshold, ported in
// spirit from the NewsDigest project's headline-clustering. Measured against
// this repo's own trending-used.json, that approach provably cannot work:
//
//   same story, reworded   ("BCI threatens Nalsar students" vs
//                           "CJI disapproves BCI action against NALSAR")  0.394
//   unrelated pair         ("US shadow transhipment network" vs
//                           "Great scam: US after India named...")        0.482
//
// The duplicate band sits BELOW the unrelated band, so no threshold
// separates them — it isn't a tuning problem, character bigrams are just the
// wrong measure for short headlines that reword aggressively and use
// abbreviations ("BCI" for "Bar Council of India"). With the threshold at
// 0.72 nothing was ever caught, and three duplicate pairs got satirized
// twice each in the first day of live running.
//
// Replaced with semantic dedupe folded into the LLM suitability call that
// already runs per candidate (see below) — no extra API cost, and a model
// resolves abbreviations and rewordings that string distance can't. A cheap
// exact-match check runs first so an identical repost never costs a call.
const DEDUPE_WINDOW_HOURS = 168; // 7 days — a topic recurring weeks later is fair game again, not a duplicate

/** Used entries still inside the dedupe window, newest first. */
function recentUsedEntries(usedEntries) {
  const cutoff = Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000;
  return usedEntries.filter((entry) => {
    if (!entry?.title) return false; // a malformed row must not throw and kill trending mode entirely
    const usedAt = Date.parse(entry.usedAt ?? "");
    // Unparseable/missing usedAt: keep it in the window rather than aging it
    // out, so a corrupt row over-rejects (safe) instead of silently
    // reopening an already-used story.
    return Number.isNaN(usedAt) ? true : usedAt >= cutoff;
  });
}

// Cheap keyword prefilter catches the obvious cases but misses tragedy
// phrased without a trigger word — confirmed live: "Air India A320 briefly
// lost key flight controls" (a real safety incident) passed the keyword
// list clean since it contains none of UNSUITABLE_KEYWORDS. This LLM check
// runs only on the keyword survivors, not every RSS item, to keep the added
// cost to one call in the common case. It now also answers "is this the same
// underlying story as one we already used" in the same call.
const MAX_SUITABILITY_CHECKS = 8; // bound worst-case LLM calls if several top candidates all get rejected

export async function checkCandidateWithLLM(title, recentTitles) {
  const system = readText("config/prompts/trending-suitability.system.md");
  const usedList = recentTitles.length
    ? recentTitles.map((t, i) => `${i}. ${t}`).join("\n")
    : "(none used recently)";
  const userMessage = `Candidate headline:\n${title}\n\nRecently used headlines:\n${usedList}`;
  const verdict = await callLLMForJson({ system, userMessage, maxOutputTokens: 256 });
  const isDuplicate = Number.isInteger(verdict.duplicateOfIndex);
  return { ok: verdict.suitable === true && !isDuplicate, verdict };
}

/**
 * Fetches India top-stories from Google News RSS (free, no API key — see
 * PLAN.md for the ToS caveat: this feed's own terms restrict it to personal,
 * non-commercial feed-reader use, which an automated pipeline doesn't
 * strictly satisfy). Returns the first headline that passes the keyword
 * prefilter, isn't an exact repeat, and clears the LLM suitability +
 * semantic-dedupe check — or null if the feed is unreachable or nothing
 * passes within MAX_SUITABILITY_CHECKS attempts.
 */
export async function fetchTrendingHeadline({ usedEntries = [] } = {}) {
  try {
    const response = await fetch(FEED_URL, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const xml = await response.text();
    const items = parseRssItems(xml);

    const recent = recentUsedEntries(usedEntries);
    const recentTitles = recent.map((e) => e.title);
    const exactUsed = new Set(recentTitles);

    const candidates = items.filter(
      (item) => item.title && isSuitableForSatire(item.title) && !exactUsed.has(item.title)
    );

    let checked = 0;
    for (const candidate of candidates) {
      if (checked >= MAX_SUITABILITY_CHECKS) break;
      checked++;
      const { ok } = await checkCandidateWithLLM(candidate.title, recentTitles);
      if (ok) return candidate;
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
