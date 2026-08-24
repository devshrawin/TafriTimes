import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./lib.mjs";

// Loads .env (gitignored) into process.env before publish.mjs's module-level
// code reads GEMINI_API_KEY, so double-clicking the launcher works without
// the user ever setting an env var by hand.
function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

const { generateAndArchive } = await import("./publish.mjs");

const UI_DIR = path.join(ROOT, "manual-ui");
const PORT = Number(process.env.PORT ?? 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 20_000_000) req.destroy(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function decodeDataUriToTempFile(dataUri) {
  const match = /^data:image\/([\w+]+);base64,(.*)$/.exec(dataUri);
  if (!match) return null;
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const tmpPath = path.join(UI_DIR, `.tmp-upload-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  writeFileSync(tmpPath, Buffer.from(match[2], "base64"));
  return tmpPath;
}

async function handleGenerate(req, res) {
  const body = await readJsonBody(req);
  const { premise, context, sourceUrl, format, imageDataUri, promptOnly, useSourceImage } = body;

  if (!premise || !premise.trim()) return sendJson(res, 400, { ok: false, error: "premise is required" });

  let manualImagePath;
  if (imageDataUri) {
    manualImagePath = decodeDataUriToTempFile(imageDataUri);
    if (!manualImagePath) return sendJson(res, 400, { ok: false, error: "invalid image data" });
  }

  // Only skip archiving (and thus the composited image) when the user
  // explicitly asked for a paste-into-ChatGPT prompt AND supplied no photo
  // of their own -- otherwise always render the finished, ready-to-post card.
  const skipArchive = Boolean(promptOnly) && !manualImagePath;

  try {
    const result = await generateAndArchive({
      manualTopic: premise.trim(),
      manualContext: context?.trim() || undefined,
      manualSourceUrl: sourceUrl?.trim() || undefined,
      manualImage: manualImagePath,
      format: format && format !== "auto" ? format : undefined,
      skipArchive,
      preferSourceImage: useSourceImage !== false,
    });

    if (!result.archived && !result.skipped) {
      return sendJson(res, 200, {
        ok: false,
        reason: result.reason,
        judgeVerdict: result.judgeVerdict,
        safetyVerdict: result.safetyVerdict,
      });
    }

    const article = result.article;
    const hashtags = article.caption.match(/#\w+/g) || [];

    let imageBase64 = null;
    if (result.archived) {
      const imgPath = path.join(ROOT, result.relImagePath);
      imageBase64 = readFileSync(imgPath).toString("base64");
    }

    sendJson(res, 200, {
      ok: true,
      headline: article.headline,
      body: article.body,
      caption: article.caption,
      hashtags,
      igHook: article.igHook,
      imagePrompt: article.imagePrompt,
      imageBase64,
      dirName: result.dirName ?? null,
      archived: result.archived,
      imageSource: result.imageSource ?? null,
    });
  } finally {
    if (manualImagePath) {
      try {
        unlinkSync(manualImagePath);
      } catch {
        // best-effort cleanup only
      }
    }
  }
}

function serveStatic(req, res) {
  const urlPath = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(UI_DIR, decodeURIComponent(urlPath));
  if (!filePath.startsWith(UI_DIR) || !existsSync(filePath)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
  res.end(readFileSync(filePath));
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/generate") {
      await handleGenerate(req, res);
      return;
    }
    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { ok: false, error: String(err?.message ?? err) });
  }
});

server.listen(PORT, () => {
  console.log(`Manual post builder: http://localhost:${PORT}`);
  console.log("Needs GEMINI_API_KEY set in this shell's environment.");
});
