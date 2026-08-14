import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib.mjs";
import { postToX } from "./post-to-x.mjs";
import { postToInstagram } from "./post-to-instagram.mjs";
import { recordPostIds } from "./write-archive.mjs";

const GITHUB_REPO = process.env.GITHUB_REPOSITORY ?? "devshrawin/TafriTimes";

/**
 * Phase 2 of the daily pipeline. Takes the dirName from an already-committed
 * and pushed archive entry (written by publish.mjs / generateAndArchive) and
 * posts it to X and Instagram. Must run only after the archive commit has
 * been pushed, since Instagram's image_url fetch depends on the jsDelivr CDN
 * mirror of that exact commit (see PLAN.md §4).
 */
export async function postPublished({ dirName }) {
  const dirPath = path.join(ROOT, "content/archive", dirName);
  const articlePath = path.join(dirPath, "article.json");
  const record = JSON.parse(readFileSync(articlePath, "utf8"));
  const imagePath = path.join(dirPath, "image.png");
  const relImagePath = path.relative(ROOT, imagePath).replace(/\\/g, "/");

  const xResult = await postToX({ caption: record.caption, imagePath });
  const cdnImagePath = `${GITHUB_REPO}@main/${relImagePath}`;
  const igResult = await postToInstagram({ caption: record.caption, cdnImagePath });

  recordPostIds({ dirPath, xTweetId: xResult.id, igMediaId: igResult.id });

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
