import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { TwitterApi } from "twitter-api-v2";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const X_CAPTION_LIMIT = 280;
const SATIRE_SUFFIX = "(satire)";

/**
 * Hard code-level enforcement of X's 280-char limit — the generation prompt
 * already asks for <=260 chars, but that's instruction-following, not a
 * guarantee, and X's API rejects the post outright if it's ever over. Keeps
 * the "(satire)" marker intact by truncating the body before it rather than
 * just hard-cutting the whole string, since that marker is the one that
 * survives a caption being screenshotted/quoted without the image.
 */
export function enforceXCaptionLimit(caption) {
  if (caption.length <= X_CAPTION_LIMIT) return caption;
  const hasSuffix = caption.trim().endsWith(SATIRE_SUFFIX);
  let body = hasSuffix ? caption.slice(0, caption.length - SATIRE_SUFFIX.length).trimEnd() : caption;
  const reserve = hasSuffix ? SATIRE_SUFFIX.length + 2 : 1; // +2 for the space + ellipsis join, +1 for a bare ellipsis
  const maxBody = X_CAPTION_LIMIT - reserve;
  if (body.length > maxBody) {
    const truncated = body.slice(0, maxBody);
    const lastSpace = truncated.lastIndexOf(" ");
    body = (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + "…";
  }
  return hasSuffix ? `${body} ${SATIRE_SUFFIX}` : body;
}

/**
 * X does not need a public image URL — bytes are uploaded directly via the
 * chunked media upload endpoint, then attached to the tweet (see PLAN.md §4).
 * No outbound link since there's no site to link to (also keeps this on the
 * cheaper no-link pricing tier).
 */
export async function postToX({ caption, imagePath }) {
  const client = new TwitterApi({
    appKey: requireEnv("X_API_KEY"),
    appSecret: requireEnv("X_API_SECRET"),
    accessToken: requireEnv("X_ACCESS_TOKEN"),
    accessSecret: requireEnv("X_ACCESS_SECRET"),
  });

  const mediaId = await client.v1.uploadMedia(imagePath, { mimeType: "image/png" });
  const { data } = await client.v2.tweet({ text: enforceXCaptionLimit(caption), media: { media_ids: [mediaId] } });
  return data;
}

async function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const result = await postToX(input);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
