import { writeFileSync, readdirSync, readFileSync as readFileSyncNode, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TwitterApi } from "twitter-api-v2";
import { ROOT, readJson } from "./lib.mjs";

const LOOKBACK_DAYS = 14;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function fetchXMetrics(tweetId) {
  const client = new TwitterApi({
    appKey: requireEnv("X_API_KEY"),
    appSecret: requireEnv("X_API_SECRET"),
    accessToken: requireEnv("X_ACCESS_TOKEN"),
    accessSecret: requireEnv("X_ACCESS_SECRET"),
  });
  const tweet = await client.v2.singleTweet(tweetId, { "tweet.fields": ["public_metrics"] });
  return tweet.data.public_metrics;
}

async function fetchInstagramMetrics(mediaId) {
  const accessToken = requireEnv("IG_ACCESS_TOKEN");
  // graph.instagram.com, not graph.facebook.com -- same host fix as
  // post-to-instagram.mjs/refresh-instagram-token.mjs (current Instagram
  // Login API, no linked Facebook Page required).
  const url = `https://graph.instagram.com/v25.0/${mediaId}/insights?metric=likes,comments,reach,saved&access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(`Instagram insights error: ${JSON.stringify(body)}`);
  return Object.fromEntries(body.data.map((m) => [m.name, m.values[0].value]));
}

/**
 * Fetches and appends engagement metrics for one already-published post.
 * Exported standalone for direct testing against a known tweet/media id.
 */
export async function collectEngagementFor({ topicKey, slug, xTweetId, igMediaId }) {
  return {
    date: new Date().toISOString().slice(0, 10),
    topicKey,
    slug,
    x: xTweetId ? await fetchXMetrics(xTweetId) : null,
    instagram: igMediaId ? await fetchInstagramMetrics(igMediaId) : null,
  };
}

function recentArchiveRecords() {
  const archiveDir = path.join(ROOT, "content/archive");
  if (!existsSync(archiveDir)) return [];
  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  return readdirSync(archiveDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const articlePath = path.join(archiveDir, entry.name, "article.json");
      if (!existsSync(articlePath)) return null;
      const record = JSON.parse(readFileSyncNode(articlePath, "utf8"));
      return { dirName: entry.name, record };
    })
    .filter(Boolean)
    .filter(({ record }) => new Date(record.date).getTime() >= cutoff)
    .filter(({ record }) => record.xTweetId || record.igMediaId);
}

/**
 * Scans content/archive for posts published in the last LOOKBACK_DAYS that
 * have a recorded xTweetId/igMediaId (written by publish.mjs) and haven't
 * been logged yet, then appends their engagement metrics to
 * data/engagement-log.json (see PLAN.md §6 — the actual "is it funny" signal,
 * as opposed to the LLM judge's proxy).
 */
export async function collectEngagement() {
  const logPath = path.join(ROOT, "data/engagement-log.json");
  const log = readJson("data/engagement-log.json", []);
  const alreadyLogged = new Set(log.map((e) => e.slug));

  const candidates = recentArchiveRecords().filter(({ record }) => !alreadyLogged.has(record.slug));

  const newEntries = [];
  for (const { record } of candidates) {
    const entry = await collectEngagementFor({
      topicKey: record.topicKey,
      slug: record.slug,
      xTweetId: record.xTweetId,
      igMediaId: record.igMediaId,
    });
    log.push(entry);
    newEntries.push(entry);
  }

  writeFileSync(logPath, JSON.stringify(log, null, 2) + "\n");
  return newEntries;
}

async function main() {
  const result = await collectEngagement();
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
