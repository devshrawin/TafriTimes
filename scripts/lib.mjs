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

export function readJson(relPath, fallback) {
  const abs = path.join(ROOT, relPath);
  if (!existsSync(abs)) return fallback;
  return JSON.parse(readFileSync(abs, "utf8"));
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
export async function callLLMForJson({ system, userMessage, model, maxOutputTokens }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model ?? GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
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

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Gemini API error: ${JSON.stringify(body)}`);
  }

  const candidate = body.candidates?.[0];
  if (!candidate) {
    throw new Error(`Gemini returned no candidates: ${JSON.stringify(body)}`);
  }
  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    throw new Error(`Gemini finished with reason ${candidate.finishReason} (likely hit maxOutputTokens or was filtered): ${JSON.stringify(body)}`);
  }

  const text = (candidate.content?.parts ?? []).map((p) => p.text ?? "").join("");
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
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
