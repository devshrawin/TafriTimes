import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib.mjs";
import { renderImage } from "./render-image.mjs";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `date-slug` collides silently once there are ~24 posts/day (2026-08-14
 * audit found three near-miss slugs in a single day already). A collision
 * overwrote the earlier post's article.json and image.png with no error.
 * Appends -2, -3, ... until a free directory name is found, so a same-slug
 * post never destroys an earlier one.
 */
function findAvailableDirName(archiveRoot, baseName) {
  if (!existsSync(path.join(archiveRoot, baseName))) return baseName;
  for (let n = 2; ; n++) {
    const candidate = `${baseName}-${n}`;
    if (!existsSync(path.join(archiveRoot, candidate))) return candidate;
  }
}

/**
 * Writes the archived article record + rendered image into
 * content/archive/YYYY-MM-DD-slug/ — the audit trail and the data source the
 * feedback loop (collect-engagement.mjs) later attaches engagement metrics to.
 */
export async function writeArchive({ beat, article, judgeVerdict, safetyVerdict, date }) {
  const dateStr = date ?? todayIsoDate();
  // Real timestamp, not just the day-level `date` — the gallery previously
  // sorted/grouped by git checkout mtime, which `actions/checkout` resets
  // to checkout time for every pre-existing file, collapsing the whole
  // archive into one "day" on every fresh CI run. This is the field
  // build-gallery.mjs should read instead.
  const publishedAt = new Date().toISOString();
  const archiveRoot = path.join(ROOT, "content/archive");
  const dirName = findAvailableDirName(archiveRoot, `${dateStr}-${article.slug}`);
  const dirPath = path.join(archiveRoot, dirName);
  mkdirSync(dirPath, { recursive: true });

  const record = {
    date: dateStr,
    publishedAt,
    topicKey: beat.key,
    headline: article.headline,
    slug: article.slug,
    body: article.body,
    caption: article.caption,
    imagePrompt: article.imagePrompt,
    sourceHeadline: beat.trendingHeadline ?? null,
    judgeVerdict,
    safetyVerdict,
  };
  writeFileSync(path.join(dirPath, "article.json"), JSON.stringify(record, null, 2) + "\n");

  const png = await renderImage(article, { topicKey: beat.key, date: dateStr });
  const imagePath = path.join(dirPath, "image.png");
  writeFileSync(imagePath, png);

  return { dirName, dirPath, imagePath: path.join(dirPath, "image.png"), record };
}

export function recordPostIds({ dirPath, xTweetId, igMediaId }) {
  const articlePath = path.join(dirPath, "article.json");
  const record = JSON.parse(readFileSync(articlePath, "utf8"));
  record.xTweetId = xTweetId ?? record.xTweetId ?? null;
  record.igMediaId = igMediaId ?? record.igMediaId ?? null;
  writeFileSync(articlePath, JSON.stringify(record, null, 2) + "\n");
  return record;
}

async function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const result = await writeArchive(input);
  process.stdout.write(JSON.stringify({ ...result, imagePath: result.imagePath.replace(ROOT + path.sep, "") }, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
