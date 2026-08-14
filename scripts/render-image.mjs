import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { ROOT } from "./lib.mjs";

const WIDTH = 1080;
const HEIGHT = 1080;

let _fontData;
function loadFont() {
  if (!_fontData) {
    _fontData = readFileSync(path.join(ROOT, "config/image-templates/fonts/Inter-Bold.woff"));
  }
  return _fontData;
}

/**
 * Fictional masthead + a permanent "SATIRE" mark baked into every image as a
 * built-in, always-on safeguard against being mistaken for real news
 * (see PLAN.md §3). This is a design safeguard, not a content-judgment step.
 */
function buildTemplate(article) {
  return {
    type: "div",
    props: {
      style: {
        width: WIDTH,
        height: HEIGHT,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#0b0b0c",
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
              borderBottom: "4px solid #ffffff",
              paddingBottom: 24,
              marginBottom: 48,
            },
            children: [
              {
                type: "div",
                props: {
                  style: { fontSize: 40, fontWeight: 700, letterSpacing: -1 },
                  children: "THE INDIAN ONION",
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
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              fontSize: 56,
              fontWeight: 700,
              lineHeight: 1.15,
              flexGrow: 1,
            },
            children: article.headline,
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              fontSize: 24,
              color: "#a8a8a8",
              borderTop: "2px solid #333333",
              paddingTop: 24,
            },
            children: "Fictional publication. Not real news.",
          },
        },
      ],
    },
  };
}

export async function renderImage(article) {
  const fontData = loadFont();
  const svg = await satori(buildTemplate(article), {
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
  const png = await renderImage(article);
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
