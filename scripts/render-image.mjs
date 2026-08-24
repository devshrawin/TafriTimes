import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { ROOT } from "./lib.mjs";

const WIDTH = 1080;
const HEIGHT = 1080;

// One accent color per beat (config/topics.yaml keys) so the feed doesn't
// read as one repeated template — the color is the only thing that varies
// beat-to-beat, everything else stays consistent for brand recognition.
const BEAT_ACCENTS = {
  "politics-bureaucracy": "#ff6b35",
  cricket: "#2ecc71",
  "bollywood-entertainment": "#e0217a",
  "urban-life": "#3498db",
  "festivals-culture": "#f1c40f",
  "workplace-corporate": "#9b59b6",
  "trending-news": "#e63946",
};
const DEFAULT_ACCENT = "#ff6b35";

let _fontData;
function loadFont() {
  if (!_fontData) {
    _fontData = readFileSync(path.join(ROOT, "config/image-templates/fonts/Inter-Bold.woff"));
  }
  return _fontData;
}

// Cropped from the owner-supplied full logo artwork (a torn-newspaper-style
// square design with tagline/icons) down to just the "TAFRI TIMES"
// wordmark + red accent stripe, since the full square doesn't read legibly
// at the small size a per-post masthead bar needs.
const LOGO_ASPECT_RATIO = 700 / 356; // source crop dimensions
let _logoDataUri;
function loadLogo() {
  if (!_logoDataUri) {
    const buffer = readFileSync(path.join(ROOT, "config/image-templates/logo.png"));
    _logoDataUri = `data:image/png;base64,${buffer.toString("base64")}`;
  }
  return _logoDataUri;
}

// Investigated 2026-08-16: observed backgrounds were mirrored/tiled (visible
// as a repeating 2x2 pattern). First hypothesis -- requesting 1080x1080
// against Pollinations' documented 1024x1024 native size, with no model
// pinned -- turned out to be WRONG when tested: 1024x1024 with `model=flux`
// pinned explicitly still tiled, on both a complex prompt (a conference
// room) and a trivial one (a single coffee cup), ruling out both the
// resolution mismatch and prompt complexity as the cause. Confirmed via
// direct curl comparison that `flux` itself is the one that tiles on this
// endpoint -- `model=turbo` at the same 1024x1024 produced a single coherent
// image on both test prompts. `turbo` is the fix; the resolution change
// wasn't actually necessary but 1024 (their documented native size) is kept
// as good practice. No downstream template change needed either way: the
// background is applied with `backgroundSize: "cover"`, so a 1024px source
// scaling up ~5.5% to fill the 1080x1080 canvas is visually seamless.
const POLLINATIONS_SIZE = 1024;

/**
 * Fetches a generic photorealistic scene photo from Pollinations (free,
 * keyless, no signup) based on the writer LLM's `imagePrompt` — a generic
 * scene description with no real people/logos (see generation.system.md).
 * This is what makes the card read as a real news photo at a glance before
 * the SATIRE mark registers on a closer look. Returns null on any failure
 * (network flake, timeout) so the caller can fall back to a flat background
 * instead of failing the whole publish.
 */
async function fetchBackgroundImageDataUri(imagePrompt) {
  if (!imagePrompt) return null;
  try {
    const encoded = encodeURIComponent(imagePrompt.trim());
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=${POLLINATIONS_SIZE}&height=${POLLINATIONS_SIZE}&model=turbo&nologo=true`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Loads a user-supplied background image (manual mode) instead of fetching
 * one from Pollinations — a local file path or a remote URL, either way
 * returned as the same data-URI shape the Satori template already expects.
 */
async function loadManualImageDataUri(pathOrUrl) {
  if (/^https?:\/\//.test(pathOrUrl)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const response = await fetch(pathOrUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TafriTimesBot/1.0)" },
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`Failed to fetch manual image: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  }
  const buffer = readFileSync(pathOrUrl);
  const ext = path.extname(pathOrUrl).slice(1).toLowerCase() || "jpeg";
  const mime = ext === "jpg" ? "jpeg" : ext;
  return `data:image/${mime};base64,${buffer.toString("base64")}`;
}

const PULL_QUOTE_MAX_CHARS = 200;

/**
 * Finds the first "quoted" span of reasonable length. Bugfix note: an
 * earlier version used a single non-global regex with a {20,180} bound on
 * the captured content, which — for any quote longer than 180 chars —
 * failed at the true opening quote and then matched the next quote pair
 * instead (e.g. the plain connector text between two dialogue quotes,
 * "said board spokesperson X.", got picked instead of the actual quote).
 * Scanning all quoted spans and truncating (rather than rejecting) long
 * ones avoids that failure mode.
 */
function truncateAtWordBoundary(text, maxChars) {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + "…";
}

function extractPullQuote(body) {
  if (!body) return null;
  const matches = [...body.matchAll(/"([^"]{15,})"/g)];
  if (matches.length > 0) return truncateAtWordBoundary(matches[0][1], PULL_QUOTE_MAX_CHARS);
  const firstSentence = body.split(/(?<=[.!?])\s/)[0];
  return firstSentence ? truncateAtWordBoundary(firstSentence, PULL_QUOTE_MAX_CHARS) : null;
}

function formatTopicLabel(topicKey) {
  if (!topicKey) return null;
  return topicKey.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Fictional masthead (owner-supplied logo artwork, cropped — see loadLogo)
 * + a permanent "SATIRE" mark baked into every image as a built-in,
 * always-on safeguard against being mistaken for real news (see PLAN.md
 * §3). This is a design safeguard, not a content-judgment step — it stays
 * even when a photo background is present specifically because the photo
 * is what makes this need the safeguard most.
 */
function buildTemplate(article, { topicKey, date, bgImageDataUri } = {}) {
  const accent = BEAT_ACCENTS[topicKey] ?? DEFAULT_ACCENT;
  const topicLabel = formatTopicLabel(topicKey);
  const pullQuote = extractPullQuote(article.body);
  const hasPhoto = Boolean(bgImageDataUri);

  const metaRowChildren = [];
  if (topicLabel) {
    metaRowChildren.push({
      type: "div",
      props: {
        style: {
          display: "flex",
          fontSize: 22,
          fontWeight: 700,
          color: accent,
          textTransform: "uppercase",
          letterSpacing: 2,
        },
        children: topicLabel,
      },
    });
  }
  if (date) {
    metaRowChildren.push({
      type: "div",
      props: {
        style: { display: "flex", fontSize: 22, color: hasPhoto ? "#e0e0e0" : "#7a7a7a" },
        children: date,
      },
    });
  }

  const contentLayer = {
    type: "div",
    props: {
      style: {
        position: "relative",
        width: WIDTH,
        height: HEIGHT,
        display: "flex",
        flexDirection: "column",
        color: "#ffffff",
        fontFamily: "Inter",
        padding: 64,
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: `4px solid ${accent}`,
              paddingBottom: 24,
              marginBottom: 32,
            },
            children: [
              {
                type: "img",
                props: {
                  src: loadLogo(),
                  width: Math.round(72 * LOGO_ASPECT_RATIO),
                  height: 72,
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: 22,
                    fontWeight: 700,
                    color: "#0b0b0c",
                    backgroundColor: "#ffcc00",
                    padding: "8px 16px",
                    borderRadius: 6,
                  },
                  children: "SATIRE",
                },
              },
            ],
          },
        },
        metaRowChildren.length > 0
          ? { type: "div", props: { style: { display: "flex", gap: 24, marginBottom: 24 }, children: metaRowChildren } }
          : { type: "div", props: { style: { display: "none" } } },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              fontSize: 52,
              fontWeight: 700,
              lineHeight: 1.15,
              textShadow: hasPhoto ? "0 2px 12px rgba(0,0,0,0.8)" : "none",
            },
            children: article.headline,
          },
        },
        pullQuote
          ? {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  flexGrow: 1,
                  justifyContent: "center",
                  borderLeft: `6px solid ${accent}`,
                  paddingLeft: 32,
                  marginTop: 40,
                },
                children: [
                  { type: "div", props: { style: { display: "flex", fontSize: 72, color: accent, lineHeight: 0.6 }, children: "“" } },
                  { type: "div", props: { style: { display: "flex", fontSize: 32, color: "#e8e8e8", lineHeight: 1.4, marginTop: 12, textShadow: hasPhoto ? "0 2px 8px rgba(0,0,0,0.9)" : "none" }, children: pullQuote } },
                ],
              },
            }
          : { type: "div", props: { style: { display: "flex", flexGrow: 1 } } },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              borderTop: "2px solid rgba(255,255,255,0.3)",
              paddingTop: 24,
            },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", flexDirection: "row", gap: 8, fontSize: 22, fontWeight: 700, color: "#f0f0f0" },
                  children: [
                    { type: "div", props: { style: { display: "flex" }, children: "BECAUSE REAL NEWS IS" } },
                    { type: "div", props: { style: { display: "flex", color: accent }, children: "BORING." } },
                  ],
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", fontSize: 18, color: "#8a8a8a", marginTop: 4 },
                  children: "Fictional publication. Not real news.",
                },
              },
            ],
          },
        },
      ],
    },
  };

  if (!hasPhoto) {
    return {
      type: "div",
      props: {
        style: {
          width: WIDTH,
          height: HEIGHT,
          display: "flex",
          backgroundColor: "#0b0b0c",
          backgroundImage: `linear-gradient(160deg, ${accent}22 0%, #0b0b0c 45%)`,
        },
        children: [contentLayer],
      },
    };
  }

  return {
    type: "div",
    props: {
      style: { width: WIDTH, height: HEIGHT, display: "flex", position: "relative", backgroundColor: "#0b0b0c" },
      children: [
        {
          type: "div",
          props: {
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              width: WIDTH,
              height: HEIGHT,
              display: "flex",
              backgroundImage: `url(${bgImageDataUri})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            },
          },
        },
        {
          type: "div",
          props: {
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              width: WIDTH,
              height: HEIGHT,
              display: "flex",
              backgroundImage:
                "linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.35) 32%, rgba(0,0,0,0.4) 58%, rgba(0,0,0,0.9) 100%)",
            },
          },
        },
        contentLayer,
      ],
    },
  };
}

export async function renderImage(article, { topicKey, date, manualImage } = {}) {
  const fontData = loadFont();
  const bgImageDataUri = manualImage
    ? await loadManualImageDataUri(manualImage)
    : await fetchBackgroundImageDataUri(article.imagePrompt);
  const svg = await satori(buildTemplate(article, { topicKey, date, bgImageDataUri }), {
    width: WIDTH,
    height: HEIGHT,
    fonts: [{ name: "Inter", data: fontData, weight: 700, style: "normal" }],
  });
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } });
  return resvg.render().asPng();
}

async function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const article = input.article ?? input.winner ?? input;
  const png = await renderImage(article, { topicKey: input.topicKey, date: input.date });
  const outPath = process.argv[2] ?? path.join(ROOT, "content/archive/preview.png");
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, png);
  console.error(`Wrote ${outPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
