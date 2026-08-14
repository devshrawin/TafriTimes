import { pathToFileURL } from "node:url";
import { readYaml, readText, callLLMForJson } from "./lib.mjs";

function flattenDenylist(denylist) {
  return Object.values(denylist).flat();
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word match, not substring. A plain `includes()` made the slur "paki"
 * match the country name "Pakistan", silently blocking every legitimate
 * India/Pakistan story — the failure looked identical to the guardrail
 * working correctly, which is the worst kind of false positive. Word
 * boundaries keep the slur blocked while leaving normal country references
 * alone; multi-word terms ("narendra modi", "love jihad") still match fine.
 */
function matchesTerm(haystack, term) {
  return new RegExp(`\\b${escapeRegex(term.toLowerCase())}\\b`, "i").test(haystack);
}

/**
 * Cheap deterministic first line of defense. Runs before the LLM guardrail
 * call since it's free and catches the obvious cases without burning a call.
 * Covers imagePrompt too — that string is sent verbatim to an external image
 * service, so it's the one field that leaves our control unreviewed.
 */
export function runDenylistPrefilter(article) {
  const denylist = readYaml("config/denylist.yaml");
  const terms = flattenDenylist(denylist);
  const haystack = [article.headline, article.body, article.caption, article.imagePrompt]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  const hits = terms.filter((term) => matchesTerm(haystack, term));
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
