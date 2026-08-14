import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { TwitterApi } from "twitter-api-v2";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
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
  const { data } = await client.v2.tweet({ text: caption, media: { media_ids: [mediaId] } });
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
