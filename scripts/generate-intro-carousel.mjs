import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, readText, callLLMForJson } from "./lib.mjs";

const SLIDE_COUNT = Number(process.env.SLIDE_COUNT ?? 6);

/**
 * One-off tool, not part of the automated daily pipeline: generates the
 * ChatGPT image-generation prompts for the "what is Tafri Times" onboarding
 * carousel meant to be pinned as the account's first Instagram post. Run
 * once, paste each slide's prompt into ChatGPT in order, download the
 * images, build the carousel manually in the Instagram app.
 */
export async function generateIntroCarousel({ slideCount = SLIDE_COUNT } = {}) {
  const system = readText("config/prompts/intro-carousel.system.md");
  const userMessage = `Write exactly ${slideCount} slides for the carousel described in your instructions.`;
  const result = await callLLMForJson({ system, userMessage, maxOutputTokens: 8192 });
  if (!Array.isArray(result.slides) || result.slides.length === 0) {
    throw new Error(`Expected a non-empty slides array, got: ${JSON.stringify(result)}`);
  }
  return result.slides;
}

function formatForTerminal(slides) {
  return slides
    .map(
      (s) =>
        `\n${"=".repeat(70)}\nSLIDE ${s.slideNumber} — ${s.title}\n${"=".repeat(70)}\n${s.imagePrompt}\n`
    )
    .join("");
}

async function main() {
  const slides = await generateIntroCarousel({});
  const outPath = path.join(ROOT, "content/intro-carousel.json");
  writeFileSync(outPath, JSON.stringify({ slides }, null, 2) + "\n");
  process.stderr.write(`Wrote ${slides.length} slide prompts to content/intro-carousel.json\n`);
  process.stdout.write(formatForTerminal(slides));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
