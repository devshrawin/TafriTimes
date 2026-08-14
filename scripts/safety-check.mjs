import { pathToFileURL } from "node:url";
import { readYaml, readText, callLLMForJson } from "./lib.mjs";

function flattenDenylist(denylist) {
  return Object.values(denylist).flat();
}

/**
 * Cheap deterministic first line of defense. Runs before the LLM guardrail
 * call since it's free and catches the obvious cases without burning a call.
 */
export function runDenylistPrefilter(article) {
  const denylist = readYaml("config/denylist.yaml");
  const terms = flattenDenylist(denylist);
  const haystack = `${article.headline}\n${article.body}\n${article.caption}`.toLowerCase();
  const hits = terms.filter((term) => haystack.includes(term.toLowerCase()));
  if (hits.length > 0) {
    return { verdict: "block", reasoning: `Denylist prefilter matched: ${hits.join(", ")}`, flaggedIssues: hits };
  }
  return null;
}

/**
 * Adversarial LLM review of the full piece for contextual risk the prefilter
 * can't catch (see config/prompts/guardrail.system.md).
 */
export async function runGuardrailCheck(article) {
  const system = readText("config/prompts/guardrail.system.md");
  const userMessage = JSON.stringify(article, null, 2);
  return callLLMForJson({ system, userMessage, maxOutputTokens: 512 });
}

export async function checkSafety(article) {
  const prefilterResult = runDenylistPrefilter(article);
  if (prefilterResult) return prefilterResult;
  return runGuardrailCheck(article);
}

async function main() {
  const { judgeCandidates } = await import("./judge-candidates.mjs");
  const { generateCandidates } = await import("./generate-candidates.mjs");
  const { beat, candidates } = await generateCandidates({ topicKey: process.env.TOPIC_KEY });
  const { winner } = await judgeCandidates({ beat, candidates });
  const verdict = await checkSafety(winner);
  process.stdout.write(JSON.stringify({ article: winner, verdict }, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
