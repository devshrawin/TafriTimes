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
 * X does NOT count JavaScript's `String.length` (UTF-16 code units). It uses
 * a weighted count: code points in U+0000–U+10FF, U+2000–U+200D,
 * U+2010–U+201F and U+2032–U+2037 weigh 1, everything else weighs 2.
 *
 * This bit us concretely (2026-08-14 audit): the previous implementation
 * measured `.length`, so it produced captions of exactly 280 code units that
 * X counted as 281+ and rejected — including via the "…" (U+2026) the
 * function appends itself, which weighs 2. A "₹" (U+20B9), near-guaranteed
 * in Indian-satire captions, also weighs 2. The function whose entire job
 * was preventing an over-length rejection was reliably causing one.
 */
function xWeightedLength(str) {
  let total = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    const light =
      cp <= 0x10ff ||
      (cp >= 0x2000 && cp <= 0x200d) ||
      (cp >= 0x2010 && cp <= 0x201f) ||
      (cp >= 0x2032 && cp <= 0x2037);
    total += light ? 1 : 2;
  }
  return total;
}

/** Truncates to at most `maxWeight` in X's weighted units, never splitting a code point. */
function sliceToWeight(str, maxWeight) {
  let total = 0;
  let out = "";
  // Iterating the string yields whole code points, so this can't split a
  // surrogate pair the way `.slice()` on code units could.
  for (const ch of str) {
    const w = xWeightedLength(ch);
    if (total + w > maxWeight) break;
    total += w;
    out += ch;
  }
  return out;
}

/**
 * Hard code-level enforcement of X's 280-char limit — the generation prompt
 * asks for <=260, but that's instruction-following, not a guarantee (one
 * archived caption already came in at 263). Keeps the "(satire)" marker
 * intact by truncating the body before it rather than hard-cutting the whole
 * string, since that marker is what survives a caption being screenshotted
 * or quoted without the image.
 */
export function enforceXCaptionLimit(caption) {
  if (xWeightedLength(caption) <= X_CAPTION_LIMIT) return caption;

  const trimmed = caption.trim();
  const hasSuffix = trimmed.endsWith(SATIRE_SUFFIX);
  // Slice from `trimmed`, not `caption` — slicing the untrimmed string by
  // the suffix length left the suffix intact when there was trailing
  // whitespace, and the function then appended a second "(satire)".
  let body = hasSuffix ? trimmed.slice(0, trimmed.length - SATIRE_SUFFIX.length).trimEnd() : trimmed;

  // Reserve weighted room for what gets appended after truncation:
  // the ellipsis (weight 2), plus — when a suffix is present — a space and
  // the suffix itself (all weight-1 ASCII).
  const ELLIPSIS_WEIGHT = 2;
  const reserve = ELLIPSIS_WEIGHT + (hasSuffix ? SATIRE_SUFFIX.length + 1 : 0);
  const maxBody = X_CAPTION_LIMIT - reserve;

  if (xWeightedLength(body) > maxBody) {
    const truncated = sliceToWeight(body, maxBody);
    const lastSpace = truncated.lastIndexOf(" ");
    body = (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).trimEnd() + "…";
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
