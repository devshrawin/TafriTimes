import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib.mjs";

const ARCHIVE_DIR = path.join(ROOT, "content/archive");

// 21 days: 7-day buffer past collect-engagement.mjs's 14-day LOOKBACK_DAYS,
// even though that script never actually touches the image file (only
// xTweetId/igMediaId) -- the buffer is just so a manual re-check of a
// recent post's image isn't already gone.
const RETAIN_DAYS = Number(process.env.MEDIA_RETAIN_DAYS ?? 21);

function isOldEnough(record, articlePath) {
  const ts = record.publishedAt ? Date.parse(record.publishedAt) : statSync(articlePath).mtimeMs;
  return Date.now() - ts > RETAIN_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Deletes just the ~2MB image.png for posts that are (a) already posted to
 * at least one platform and (b) older than RETAIN_DAYS -- article.json stays
 * forever as the actual audit trail / engagement-collection data source.
 * Repo/Pages size grows ~2MB per post otherwise, indefinitely (audited
 * 2026-08-16: GitHub Pages' 1GB limit was on track to bite ~Sept 24 at
 * then-current volume). Only deletes the working-tree copy going forward --
 * does not rewrite git history, so this alone won't shrink a `git clone`,
 * but it does keep docs/ (what Pages actually serves, via build-gallery.mjs)
 * and content/archive from growing forever.
 */
export function cleanupOldMedia() {
  if (!existsSync(ARCHIVE_DIR)) return { deleted: 0, skipped: 0 };
  let deleted = 0;
  let skipped = 0;
  for (const entry of readdirSync(ARCHIVE_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(ARCHIVE_DIR, entry.name);
    const articlePath = path.join(dirPath, "article.json");
    const imagePath = path.join(dirPath, "image.png");
    if (!existsSync(imagePath) || !existsSync(articlePath)) continue;

    let record;
    try {
      record = JSON.parse(readFileSync(articlePath, "utf8"));
    } catch {
      skipped++; // corrupt record -- leave the image alone rather than risk deleting the only copy of something we can't verify
      continue;
    }

    const posted = Boolean(record.xTweetId || record.igMediaId);
    if (!posted || !isOldEnough(record, articlePath)) {
      skipped++;
      continue;
    }

    unlinkSync(imagePath);
    record.imageDeleted = true;
    writeFileSync(articlePath, JSON.stringify(record, null, 2) + "\n");
    deleted++;
  }
  return { deleted, skipped };
}

async function main() {
  const result = cleanupOldMedia();
  console.error(`Cleanup: deleted ${result.deleted} old image(s), left ${result.skipped} alone.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
