import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import yaml from "js-yaml";
import Anthropic from "@anthropic-ai/sdk";

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

let _client;
export function anthropic() {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

/**
 * Calls Claude with a system prompt + user message, expecting a raw JSON
 * object back (no markdown fences). Strips fences defensively anyway since
 * models occasionally add them despite instructions.
 */
export async function callClaudeForJson({ system, userMessage, model, maxTokens }) {
  const client = anthropic();
  const response = await client.messages.create({
    model: model ?? "claude-sonnet-5",
    max_tokens: maxTokens ?? 2048,
    system,
    messages: [{ role: "user", content: userMessage }],
  });
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned);
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
