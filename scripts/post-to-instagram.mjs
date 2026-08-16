import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// "Instagram API with Instagram Login" (current as of 2026) uses its own
// host and doesn't require a linked Facebook Page, unlike the older
// "Facebook Login for Business" flow this used to point at
// (graph.facebook.com) — see PROGRESS.md for the research that caught this.
// v25.0 chosen for stability margin; v23.0 reached end-of-life June 2026.
const GRAPH_BASE = "https://graph.instagram.com/v25.0";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function graphFetch(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Instagram Graph API error: ${JSON.stringify(body)}`);
  }
  return body;
}

function purgeUrl(cdnPath) {
  return `https://purge.jsdelivr.net/gh/${cdnPath}`;
}

const CONTAINER_POLL_INTERVAL_MS = 3000;
const CONTAINER_POLL_TIMEOUT_MS = 90_000;

/**
 * Diagnosed live (2026-08-16): publishing a container immediately after
 * creating it intermittently fails with error code 9007 / subcode 2207027,
 * "Media ID is not available" / "The media is not ready for publishing" --
 * Instagram needs time to actually fetch and process the container's
 * image_url after creation, before it's publishable. A real failed post
 * succeeded on a manual retry ~9 minutes later, confirming this is a
 * processing-readiness race, not a permanent error. Poll the container's
 * own `status_code` field until it reports `FINISHED` (or `ERROR`/timeout)
 * instead of publishing blind -- fixes the race at its source rather than
 * relying on the caller retrying the whole post minutes later.
 */
async function waitForContainerReady(containerId, accessToken) {
  const deadline = Date.now() + CONTAINER_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await graphFetch(
      `${GRAPH_BASE}/${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`
    );
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR") {
      throw new Error(`Instagram container ${containerId} failed processing: ${JSON.stringify(status)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, CONTAINER_POLL_INTERVAL_MS));
  }
  throw new Error(`Instagram container ${containerId} did not finish processing within ${CONTAINER_POLL_TIMEOUT_MS}ms`);
}

/**
 * Instagram's Graph API requires a public image URL to build a media
 * container — jsDelivr mirrors the just-pushed GitHub content for free, no
 * separate hosting (see PLAN.md §4). Purge the CDN cache first so Instagram
 * doesn't fetch a stale/404 response during propagation delay.
 */
export async function postToInstagram({ caption, cdnImagePath }) {
  const igUserId = requireEnv("IG_USER_ID");
  const accessToken = requireEnv("IG_ACCESS_TOKEN");
  const imageUrl = `https://cdn.jsdelivr.net/gh/${cdnImagePath}`;

  await fetch(purgeUrl(cdnImagePath)).catch(() => {});

  const container = await graphFetch(
    `${GRAPH_BASE}/${igUserId}/media?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, caption }),
    }
  );

  await waitForContainerReady(container.id, accessToken);

  const published = await graphFetch(
    `${GRAPH_BASE}/${igUserId}/media_publish?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: container.id }),
    }
  );

  return published;
}

async function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const result = await postToInstagram(input);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
