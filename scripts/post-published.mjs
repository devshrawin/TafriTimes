import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib.mjs";
import { postToX } from "./post-to-x.mjs";
import { postToInstagram } from "./post-to-instagram.mjs";
import { recordPostIds } from "./write-archive.mjs";

const GITHUB_REPO = process.env.GITHUB_REPOSITORY ?? "devshrawin/TafriTimes";

const X_ENV_VARS = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"];
const IG_ENV_VARS = ["IG_USER_ID", "IG_ACCESS_TOKEN"];
const hasAllEnv = (names) => names.every((name) => Boolean(process.env[name]));

// X's 280-char limit can't fit more than the short caption (enforced
// separately in post-to-x.mjs), but Instagram allows up to 2200 chars —
// plenty of room for the full piece, not just the caption line. Owner
// wanted the full headline + body visible on the post itself, not
// truncated to the one-line caption X is stuck with.
const IG_CAPTION_LIMIT = 2200;

function truncateAtWordBoundary(text, maxChars) {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + "…";
}

export function buildInstagramCaption(record) {
  // Instagram doesn't render caption URLs as clickable links (a platform
  // limitation, not something we can fix) -- included as plain text anyway
  // since it's still useful as a citation/credibility reference for anyone
  // who wants to look up the real story this piece was inspired by.
  const sourceLine = record.sourceHeadline
    ? `\n\nInspired by real news: ${record.sourceHeadline.title}\n${record.sourceHeadline.link}`
    : "";
  // igHook leads the caption -- it's the only part shown before Instagram's
  // "...more" truncation, so putting the headline there (which is already
  // on the image itself) was pure redundancy. Older archived posts predate
  // this field, hence the fallback to the old headline-first behavior.
  const hookLine = record.igHook ? `${record.igHook}\n\n` : "";
  const full = `${hookLine}${record.headline}\n\n${record.body}\n\n${record.caption}${sourceLine}`;
  return truncateAtWordBoundary(full, IG_CAPTION_LIMIT);
}

/**
 * Phase 2 of the daily pipeline. Takes the dirName from an already-committed
 * and pushed archive entry (written by publish.mjs / generateAndArchive) and
 * posts it to whichever of X/Instagram have credentials configured. Must run
 * only after the archive commit has been pushed, since Instagram's
 * image_url fetch depends on the jsDelivr CDN mirror of that exact commit
 * (see PLAN.md §4).
 *
 * Platforms are posted independently — set up one at a time (e.g. Instagram
 * before X) without the other's missing credentials aborting the whole run.
 * `postToX`/`postToInstagram` still throw on a genuine posting failure once
 * a platform's credentials ARE present; only a fully-absent credential set
 * is treated as "skip this platform," not a partial/broken one.
 */
export async function postPublished({ dirName }) {
  const dirPath = path.join(ROOT, "content/archive", dirName);
  const articlePath = path.join(dirPath, "article.json");
  const record = JSON.parse(readFileSync(articlePath, "utf8"));
  const imagePath = path.join(dirPath, "image.png");
  const relImagePath = path.relative(ROOT, imagePath).replace(/\\/g, "/");

  const xConfigured = hasAllEnv(X_ENV_VARS);
  const igConfigured = hasAllEnv(IG_ENV_VARS);

  // Audited 2026-08-16: if IG_ACCESS_TOKEN/IG_USER_ID ever went missing
  // (secret deleted, renamed, scope changed) while X stays unconfigured (as
  // it is today), both platforms would be skipped, this function would
  // still return `posted: true`, and the workflow would treat that as a
  // full success -- committing an empty "Record post IDs" no-op, sleeping
  // the normal interval, and burning Gemini/Pollinations/storage forever
  // while posting literally nothing, completely silently. Zero platforms
  // configured is a configuration error, not an intentional skip-one path
  // (skipping exactly one platform while the other works is the normal,
  // supported case and must NOT throw here).
  if (!xConfigured && !igConfigured) {
    throw new Error(
      "No platform has credentials configured (both X and Instagram env vars are missing) -- refusing to silently report success while posting nothing."
    );
  }

  // Re-read any post IDs already recorded on this exact archive entry --
  // this function is the whole retry unit under the workflow's PENDING_DIR
  // retry (a post-published.mjs failure retries by calling this again with
  // the same dirName). Without this guard, if X succeeded but Instagram then
  // threw, the retry would re-run postToX and post the same tweet again --
  // up to 5 times under MAX_POST_RETRIES. Skipping a platform that already
  // has a recorded ID makes every retry idempotent regardless of which
  // platform failed last time.
  let xResult = record.xTweetId ? { id: record.xTweetId } : null;
  let igResult = record.igMediaId ? { id: record.igMediaId } : null;

  if (xResult) {
    console.error(`Skipping X: already posted as ${xResult.id} (retry of a partially-succeeded attempt).`);
  } else if (xConfigured) {
    xResult = await postToX({ caption: record.caption, imagePath });
  } else {
    console.error("Skipping X: credentials not configured.");
  }

  if (igResult) {
    console.error(`Skipping Instagram: already posted as ${igResult.id} (retry of a partially-succeeded attempt).`);
  } else if (igConfigured) {
    const cdnImagePath = `${GITHUB_REPO}@main/${relImagePath}`;
    igResult = await postToInstagram({ caption: buildInstagramCaption(record), cdnImagePath });
  } else {
    console.error("Skipping Instagram: credentials not configured.");
  }

  recordPostIds({ dirPath, xTweetId: xResult?.id, igMediaId: igResult?.id });

  return { posted: true, dirName, xResult, igResult };
}

async function main() {
  const dirName = process.env.ARCHIVE_DIR_NAME;
  if (!dirName) throw new Error("Missing required env var: ARCHIVE_DIR_NAME");
  const result = await postPublished({ dirName });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
