import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib.mjs";
import { renderImage } from "./render-image.mjs";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Writes the archived article record + rendered image into
 * content/archive/YYYY-MM-DD-slug/ — the audit trail and the data source the
 * feedback loop (collect-engagement.mjs) later attaches engagement metrics to.
 */
export async function writeArchive({ beat, article, judgeVerdict, safetyVerdict, date }) {
  const dateStr = date ?? todayIsoDate();
  const dirName = `${dateStr}-${article.slug}`;
  const dirPath = path.join(ROOT, "content/archive", dirName);
  mkdirSync(dirPath, { recursive: true });

  const record = {
    date: dateStr,
    topicKey: beat.key,
    headline: article.headline,
    slug: article.slug,
    body: article.body,
    caption: article.caption,
    judgeVerdict,
    safetyVerdict,
  };
  writeFileSync(path.join(dirPath, "article.json"), JSON.stringify(record, null, 2) + "\n");

  const png = await renderImage(article);
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
