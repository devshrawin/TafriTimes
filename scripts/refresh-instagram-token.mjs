import { pathToFileURL } from "node:url";

const GRAPH_BASE = "https://graph.facebook.com/v20.0";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * Long-lived Instagram tokens expire after 60 days. This refresh must run at
 * least once within that window (weekly cron gives large margin) — if missed
 * entirely, recovery requires redoing the one-time interactive Facebook OAuth
 * consent (see PLAN.md §5, Prerequisites).
 */
async function refreshToken(currentToken) {
  const url = `${GRAPH_BASE}/oauth/access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(currentToken)}`;
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(`Token refresh failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

/**
 * Writes the new token back as a GitHub Actions secret via the GitHub REST
 * API, so no human has to manually rotate it. Needs a fine-grained PAT with
 * this-repo secrets:write (GH_PAT_FOR_SECRETS) — separate from GITHUB_TOKEN,
 * which cannot write repo secrets.
 */
async function writeGitHubSecret({ owner, repo, secretName, secretValue, pat }) {
  const sodium = await import("libsodium-wrappers");
  await sodium.default.ready;

  const keyResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/secrets/public-key`,
    { headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" } }
  );
  const { key, key_id } = await keyResponse.json();

  const messageBytes = sodium.default.from_string(secretValue);
  const keyBytes = sodium.default.from_base64(key, sodium.default.base64_variants.ORIGINAL);
  const encryptedBytes = sodium.default.crypto_box_seal(messageBytes, keyBytes);
  const encryptedValue = sodium.default.to_base64(encryptedBytes, sodium.default.base64_variants.ORIGINAL);

  const putResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/secrets/${secretName}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ encrypted_value: encryptedValue, key_id }),
    }
  );
  if (!putResponse.ok) {
    throw new Error(`Failed to write GitHub secret: ${await putResponse.text()}`);
  }
}

export async function refreshInstagramToken() {
  const currentToken = requireEnv("IG_ACCESS_TOKEN");
  const pat = requireEnv("GH_PAT_FOR_SECRETS");
  const [owner, repo] = requireEnv("GITHUB_REPOSITORY").split("/");

  const newToken = await refreshToken(currentToken);
  await writeGitHubSecret({ owner, repo, secretName: "IG_ACCESS_TOKEN", secretValue: newToken, pat });
  return { refreshed: true };
}

async function main() {
  const result = await refreshInstagramToken();
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
