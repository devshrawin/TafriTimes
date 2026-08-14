import { pathToFileURL } from "node:url";
import { readYaml, readText, callClaudeForJson, pickWeightedTopic } from "./lib.mjs";

const CANDIDATE_COUNT = Number(process.env.CANDIDATE_COUNT ?? 4);

function buildUserMessage(beat) {
  return `Write one satirical news article for the "${beat.label}" beat.\n\nAngle guidance: ${beat.angle.trim()}\n\nInvent a fresh, specific premise — do not reuse a generic "X is bad" framing.`;
}

export async function generateCandidates({ topicKey } = {}) {
  const topics = readYaml("config/topics.yaml");
  const beat = topicKey
    ? topics.beats.find((b) => b.key === topicKey)
    : pickWeightedTopic(topics.beats);
  if (!beat) throw new Error(`Unknown topic key: ${topicKey}`);

  const system = readText("config/prompts/generation.system.md");
  const userMessage = buildUserMessage(beat);

  const candidates = [];
  for (let i = 0; i < CANDIDATE_COUNT; i++) {
    // Each call is independent, so natural sampling variance across calls
    // gives varied angles without needing to hand-tune temperature per call.
    const candidate = await callClaudeForJson({ system, userMessage });
    candidates.push(candidate);
  }

  return { beat, candidates };
}

async function main() {
  const result = await generateCandidates({ topicKey: process.env.TOPIC_KEY });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
