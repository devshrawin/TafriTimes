import { readJson } from "./lib.mjs";
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

/**
 * Fetches India top-stories from Google News RSS (free, no API key — see
 * PLAN.md for the ToS caveat: this feed's own terms restrict it to personal,
 * non-commercial feed-reader use, which an automated pipeline doesn't
 * strictly satisfy). Returns the first headline not already in
 * `excludeTitles`, or null if the feed is unreachable or every item is
 * already covered.
 */
export async function fetchTrendingHeadline({ excludeTitles = [] } = {}) {
  try {
    const response = await fetch(FEED_URL, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const xml = await response.text();
    const items = parseRssItems(xml);
    const excludeSet = new Set(excludeTitles);
    return (
      items.find((item) => item.title && !excludeSet.has(item.title) && isSuitableForSatire(item.title)) ?? null
    );
  } catch {
    return null;
  }
}

/** Reads the set of headline titles already used, from the trending-used log. */
export function getUsedTrendingTitles() {
  return readJson("data/trending-used.json", []).map((entry) => entry.title);
}

async function main() {
  const headline = await fetchTrendingHeadline({ excludeTitles: getUsedTrendingTitles() });
  process.stdout.write(JSON.stringify(headline, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
