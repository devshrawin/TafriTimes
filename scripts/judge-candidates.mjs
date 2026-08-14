import { pathToFileURL } from "node:url";
import { readText, callLLMForJson } from "./lib.mjs";
import { generateCandidates } from "./generate-candidates.mjs";

export async function judgeCandidates({ beat, candidates }) {
  const system = readText("config/prompts/judge.system.md");
  const userMessage = JSON.stringify(
    candidates.map((c, index) => ({ index, ...c })),
    null,
    2
  );
  const verdict = await callLLMForJson({ system, userMessage, maxOutputTokens: 1024 });
  const winner = candidates[verdict.winnerIndex];
  if (!winner) {
    throw new Error(`Judge returned invalid winnerIndex: ${verdict.winnerIndex}`);
  }
  return { beat, winner, verdict, candidates };
}

async function main() {
  const { beat, candidates } = await generateCandidates({ topicKey: process.env.TOPIC_KEY });
  const result = await judgeCandidates({ beat, candidates });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
