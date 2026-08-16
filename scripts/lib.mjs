import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import yaml from "js-yaml";

export const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");

export function readYaml(relPath) {
  return yaml.load(readFileSync(path.join(ROOT, relPath), "utf8"));
}

export function readText(relPath) {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

/**
 * Audited 2026-08-16: a bare JSON.parse here meant a truncated/corrupt file
 * (e.g. a `timeout`-killed write mid-flight, plausible given the workflow's
 * 5-minute run caps and cancel-in-progress restarts) would throw on EVERY
 * subsequent call forever -- fetch-trending.mjs's getUsedTrendingEntries()
 * is called outside any try/catch in publish.mjs, so one corrupt
 * trending-used.json would permanently hot-loop the whole pipeline (and the
 * corrupt file gets committed, so a fresh checkout doesn't self-heal
 * either). Falling back rather than throwing on a parse error trades a
 * silently-reset dedupe/log for a pipeline that keeps running -- the
 * former is recoverable, the latter isn't.
 */
export function readJson(relPath, fallback) {
  const abs = path.join(ROOT, relPath);
  if (!existsSync(abs)) return fallback;
  try {
    return JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    console.error(`::warning::${relPath} is corrupt/unparseable (${err.message}) -- using fallback instead of crashing`);
    return fallback;
  }
}

// gemini-2.5-* is no longer available to new API keys, and the newer
// gemini-3.5-flash is a "thinking" model that leaks chain-of-thought text
// into the JSON response even with responseMimeType: "application/json" —
// verified against a live key. 3.1-flash-lite is a plain (non-thinking)
// model and returns clean JSON.
const GEMINI_MODEL = "gemini-3.1-flash-lite";

/**
 * Calls Gemini with a system prompt + user message, expecting a raw JSON
 * object back. Uses responseMimeType: "application/json" so Gemini itself
 * guarantees valid JSON (no markdown fences to strip). Chosen over Anthropic
 * here specifically because it has a real free tier (1,500 req/day on
 * Flash, no card) — see PROGRESS.md for why this pipeline runs on Gemini
 * for now instead of the ANTHROPIC_API_KEY assumed in PLAN.md.
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_LLM_RETRIES = 3;
const RETRY_BASE_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Audited 2026-08-16: callLLMForJson used to do one bare fetch -- a
 * transient 429 (free-tier rate limit) or 503 (Gemini overloaded, observed
 * live) propagated straight up as a hard failure, which under the workflow's
 * 3-minute fast-retry actually made rate-limit pressure worse (more retries
 * per unit time, not fewer). Retrying transient statuses in-process with
 * exponential backoff (2s, 4s, 8s) absorbs the common case before it ever
 * becomes a workflow-level failure; a non-retryable error (bad request, auth)
 * still throws immediately on the first attempt.
 */
export async function callLLMForJson({ system, userMessage, model, maxOutputTokens }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model ?? GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let response;
  let body;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: userMessage }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: maxOutputTokens ?? 2048,
          },
        }),
      });
    } catch (err) {
      // Network-level failure (DNS, connection reset) -- also transient.
      if (attempt >= MAX_LLM_RETRIES) throw err;
      const delay = RETRY_BASE_MS * 2 ** attempt;
      console.error(`::warning::Gemini fetch threw (${err.message}), retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_LLM_RETRIES})`);
      await sleep(delay);
      continue;
    }

    if (response.ok) {
      body = await response.json();
      break;
    }

    if (!RETRYABLE_STATUS.has(response.status) || attempt >= MAX_LLM_RETRIES) {
      body = await response.json().catch(() => ({ status: response.status }));
      throw new Error(`Gemini API error: ${JSON.stringify(body)}`);
    }

    const delay = RETRY_BASE_MS * 2 ** attempt;
    console.error(`::warning::Gemini API returned ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_LLM_RETRIES})`);
    await sleep(delay);
  }

  const candidate = body.candidates?.[0];
  if (!candidate) {
    throw new Error(`Gemini returned no candidates: ${JSON.stringify(body)}`);
  }
  const text = (candidate.content?.parts ?? []).map((p) => p.text ?? "").join("");
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  // A non-STOP finish (commonly MAX_TOKENS, sometimes a safety filter) used
  // to throw unconditionally here, before ever attempting to parse — but a
  // real observed failure mode is the model emitting a complete, valid JSON
  // object and then degenerating into a repetition loop that eats the rest
  // of the token budget. parseLeadingJsonObject already exists to salvage a
  // balanced object out of trailing garbage, so try that first and only
  // throw if it can't find one — don't discard genuinely valid output.
  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    try {
      return parseLeadingJsonObject(cleaned);
    } catch {
      throw new Error(`Gemini finished with reason ${candidate.finishReason} (likely hit maxOutputTokens or was filtered): ${JSON.stringify(body)}`);
    }
  }

  return parseLeadingJsonObject(cleaned);
}

/**
 * Parses the first balanced JSON object out of a string. Guards against rare
 * cases where Gemini's JSON mode still appends trailing text after a
 * complete object (observed intermittently even on a non-thinking model) —
 * a plain JSON.parse would throw "Unexpected non-whitespace character after
 * JSON" on that trailing text even though the object itself is valid.
 */
function parseLeadingJsonObject(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    const start = text.indexOf("{");
    if (start === -1) throw err;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(start, i + 1));
      }
    }
    throw err;
  }
}

export function pickWeightedTopic(beats) {
  const total = beats.reduce((sum, b) => sum + (b.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const beat of beats) {
    r -= beat.weight ?? 1;
    if (r <= 0) return beat;
  }
  return beats[beats.length - 1];
}
