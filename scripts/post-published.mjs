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

  let xResult = null;
  let igResult = null;

  if (hasAllEnv(X_ENV_VARS)) {
    xResult = await postToX({ caption: record.caption, imagePath });
  } else {
    console.error("Skipping X: credentials not configured.");
  }

  if (hasAllEnv(IG_ENV_VARS)) {
    const cdnImagePath = `${GITHUB_REPO}@main/${relImagePath}`;
    igResult = await postToInstagram({ caption: record.caption, cdnImagePath });
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
