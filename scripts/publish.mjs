import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, readText, callLLMForJson, pickWeightedTopic, readYaml } from "./lib.mjs";
import { checkSafety } from "./safety-check.mjs";
import { judgeCandidates } from "./judge-candidates.mjs";
import { writeArchive } from "./write-archive.mjs";

const MAX_REGENERATE_RETRIES = 2;
const CANDIDATE_COUNT = Number(process.env.CANDIDATE_COUNT ?? 4);

async function generateOneCandidate({ system, beat, negativeConstraint }) {
  const base = `Write one satirical news article for the "${beat.label}" beat.\n\nAngle guidance: ${beat.angle.trim()}\n\nInvent a fresh, specific premise — do not reuse a generic "X is bad" framing.`;
  const userMessage = negativeConstraint
    ? `${base}\n\nIMPORTANT: a previous attempt on this topic was rejected by the safety guardrail for this reason: "${negativeConstraint}". Write a materially different piece that avoids this issue.`
    : base;
  return callLLMForJson({ system, userMessage });
}

async function generateAndJudge({ beat, negativeConstraint }) {
  const system = readText("config/prompts/generation.system.md");
  const candidates = [];
  for (let i = 0; i < CANDIDATE_COUNT; i++) {
    candidates.push(await generateOneCandidate({ system, beat, negativeConstraint }));
  }
  return judgeCandidates({ beat, candidates });
}

/**
 * Phase 1 of the daily pipeline: generate → judge → safety guardrail (with a
 * bounded regenerate loop) → render + archive to disk. Stops here — does NOT
 * post. Posting is a separate phase (scripts/post-published.mjs) run only
 * after the workflow has git-committed and pushed this archive, because
 * Instagram's Graph API needs a public image URL and the jsDelivr CDN only
 * mirrors what's already on `main` (see PLAN.md §4). A persistent `block`
 * verdict exits cleanly without ever reaching archive/post (see PLAN.md §2).
 */
export async function generateAndArchive({ topicKey } = {}) {
  const topics = readYaml("config/topics.yaml");
  const beat = topicKey ? topics.beats.find((b) => b.key === topicKey) : pickWeightedTopic(topics.beats);
  if (!beat) throw new Error(`Unknown topic key: ${topicKey}`);

  let negativeConstraint;
  let winner;
  let judgeVerdict;
  let safetyVerdict;

  for (let attempt = 0; attempt <= MAX_REGENERATE_RETRIES; attempt++) {
    const judged = await generateAndJudge({ beat, negativeConstraint });
    winner = judged.winner;
    judgeVerdict = judged.verdict;
    safetyVerdict = await checkSafety(winner);

    if (safetyVerdict.verdict === "pass") break;
    if (safetyVerdict.verdict === "block") {
      console.error(`Blocked: ${safetyVerdict.reasoning}`);
      return { archived: false, reason: "blocked", safetyVerdict };
    }
    negativeConstraint = safetyVerdict.reasoning;
    if (attempt === MAX_REGENERATE_RETRIES) {
      console.error(`Exhausted regenerate retries. Last reason: ${safetyVerdict.reasoning}`);
      return { archived: false, reason: "regenerate-exhausted", safetyVerdict };
    }
  }

  const archiveResult = await writeArchive({ beat, article: winner, judgeVerdict, safetyVerdict });
  const relImagePath = path.relative(ROOT, archiveResult.imagePath).replace(/\\/g, "/");

  return {
    archived: true,
    dirName: archiveResult.dirName,
    relImagePath,
    article: winner,
    topicKey: beat.key,
  };
}

async function main() {
  const result = await generateAndArchive({ topicKey: process.env.TOPIC_KEY });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.archived) process.exitCode = 3; // distinct code: blocked/exhausted, not a crash
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
