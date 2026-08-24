import { pathToFileURL } from "node:url";
import { generateAndArchive } from "./publish.mjs";

/**
 * Manual mode entrypoint: user supplies the topic and a background image
 * directly (own photo, not AI-generated) -- everything else (article body,
 * caption, igHook, format, rendered graphic) still runs through the same
 * generate -> judge -> safety-check -> archive pipeline as the automated
 * hourly run. Usage:
 *
 *   npm run generate:manual -- --topic "PM announces new policy X" --image ./photo.jpg
 *
 * or via env vars (matching the existing TOPIC_KEY convention):
 *
 *   MANUAL_TOPIC="..." MANUAL_IMAGE=./photo.jpg npm run generate:manual
 */
function parseArgs(argv) {
  const args = {
    topic: process.env.MANUAL_TOPIC,
    image: process.env.MANUAL_IMAGE,
    context: process.env.MANUAL_CONTEXT,
    sourceUrl: process.env.MANUAL_SOURCE_URL,
    format: process.env.MANUAL_FORMAT,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--topic") args.topic = argv[++i];
    else if (argv[i] === "--image") args.image = argv[++i];
    else if (argv[i] === "--context") args.context = argv[++i];
    else if (argv[i] === "--source") args.sourceUrl = argv[++i];
    else if (argv[i] === "--format") args.format = argv[++i];
  }
  return args;
}

async function main() {
  const { topic, image, context, sourceUrl, format } = parseArgs(process.argv.slice(2));
  if (!topic) throw new Error('Missing topic. Pass --topic "..." or set MANUAL_TOPIC.');
  if (!image) throw new Error("Missing image. Pass --image <path-or-url> or set MANUAL_IMAGE.");

  const result = await generateAndArchive({
    manualTopic: topic,
    manualImage: image,
    manualContext: context,
    manualSourceUrl: sourceUrl,
    format,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.archived) process.exitCode = 3; // distinct code: blocked/exhausted/unsuitable, not a crash
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
