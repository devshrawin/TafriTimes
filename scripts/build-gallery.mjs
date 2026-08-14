import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib.mjs";

const ARCHIVE_DIR = path.join(ROOT, "content/archive");
const DOCS_DIR = path.join(ROOT, "docs");

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function loadPosts() {
  if (!existsSync(ARCHIVE_DIR)) return [];
  return readdirSync(ARCHIVE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dirPath = path.join(ARCHIVE_DIR, entry.name);
      const articlePath = path.join(dirPath, "article.json");
      const imagePath = path.join(dirPath, "image.png");
      if (!existsSync(articlePath) || !existsSync(imagePath)) return null;
      const record = JSON.parse(readFileSync(articlePath, "utf8"));
      // record.publishedAt is a real timestamp written at archive time.
      // File mtime was used originally, but `actions/checkout` resets every
      // pre-existing file's mtime to checkout time on a fresh CI run — that
      // collapsed the entire historical archive into one "today" tab and
      // showed the checkout time as every old post's publish time (found in
      // the 2026-08-14 audit). Older archived posts predate this field, so
      // fall back to mtime only for those, not as the general-case source.
      const timestamp = record.publishedAt ? Date.parse(record.publishedAt) : statSync(articlePath).mtimeMs;
      return { dirName: entry.name, record, imagePath, timestamp };
    })
    .filter(Boolean)
    .sort((a, b) => b.timestamp - a.timestamp);
}

/** Groups posts by calendar date (UTC), newest date first, posts within a date newest-hour first. */
function groupByDate(posts) {
  const groups = new Map();
  for (const post of posts) {
    const dateKey = new Date(post.timestamp).toISOString().slice(0, 10);
    if (!groups.has(dateKey)) groups.set(dateKey, []);
    groups.get(dateKey).push(post);
  }
  return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

function formatTime(timestamp) {
  return new Date(timestamp).toISOString().slice(11, 16) + " UTC";
}

function renderCard(post) {
  const { record, dirName, timestamp } = post;
  const topicLabel = (record.topicKey ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const sourceLine = record.sourceHeadline
    ? `<p class="source">Based on real trending headline: <a href="${escapeHtml(record.sourceHeadline.link)}" target="_blank" rel="noopener">${escapeHtml(record.sourceHeadline.title)}</a></p>`
    : "";
  return `
    <article class="card">
      <img src="images/${escapeHtml(dirName)}.png" alt="${escapeHtml(record.headline)}" loading="lazy" />
      <div class="card-body">
        <div class="meta">
          <span class="topic">${escapeHtml(topicLabel || "Trending")}</span>
          <span class="time">${formatTime(timestamp)}</span>
        </div>
        <h2>${escapeHtml(record.headline)}</h2>
        <details>
          <summary>Read full piece</summary>
          <p class="body">${escapeHtml(record.body).replace(/\n\n/g, "</p><p class=\"body\">")}</p>
          <p class="caption"><strong>Caption:</strong> ${escapeHtml(record.caption)}</p>
          ${sourceLine}
        </details>
      </div>
    </article>`;
}

function formatDateLabel(dateKey) {
  const d = new Date(dateKey + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function renderDateGroups(groups) {
  const tabs = groups
    .map(([dateKey], i) => `<button class="tab${i === 0 ? " active" : ""}" data-target="day-${dateKey}">${formatDateLabel(dateKey)} <span class="count">${groups[i][1].length}</span></button>`)
    .join("\n");

  const panels = groups
    .map(([dateKey, posts], i) => `
    <section class="day-panel${i === 0 ? " active" : ""}" id="day-${dateKey}">
      <div class="grid">
        ${posts.map(renderCard).join("\n")}
      </div>
    </section>`)
    .join("\n");

  return { tabs, panels };
}

const PAGE_TEMPLATE = ({ tabs, panels, totalCount, dayCount }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Tafri Times — POC Archive</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 16px 64px;
    background: #0b0b0c; color: #f0f0f0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  header { max-width: 1080px; margin: 0 auto 24px; }
  header h1 { font-size: 28px; margin: 0 0 4px; }
  header p { color: #a8a8a8; margin: 0; font-size: 14px; }
  .tabs {
    max-width: 1080px; margin: 0 auto 28px;
    display: flex; gap: 8px; flex-wrap: wrap;
    border-bottom: 1px solid #2a2a2e; padding-bottom: 16px;
  }
  .tab {
    background: #16161a; border: 1px solid #2a2a2e; color: #d0d0d0;
    padding: 8px 14px; border-radius: 999px; font-size: 13px; cursor: pointer;
    font-family: inherit;
  }
  .tab .count { color: #7a7a7a; margin-left: 4px; }
  .tab.active { background: #ff6b35; border-color: #ff6b35; color: #0b0b0c; font-weight: 600; }
  .tab.active .count { color: #3a2010; }
  .day-panel { display: none; max-width: 1080px; margin: 0 auto; }
  .day-panel.active { display: block; }
  .grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 24px;
  }
  .card {
    background: #16161a; border: 1px solid #2a2a2e; border-radius: 12px;
    overflow: hidden; display: flex; flex-direction: column;
  }
  .card img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; display: block; }
  .card-body { padding: 16px 18px 20px; }
  .meta { display: flex; justify-content: space-between; font-size: 12px; color: #ff6b35; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .meta .time { color: #7a7a7a; text-transform: none; letter-spacing: 0; font-variant-numeric: tabular-nums; }
  .card h2 { font-size: 18px; line-height: 1.3; margin: 0 0 10px; }
  details summary { cursor: pointer; color: #ffcc00; font-size: 13px; font-weight: 600; margin-bottom: 8px; }
  .body { font-size: 14px; line-height: 1.5; color: #d0d0d0; margin: 8px 0; }
  .caption { font-size: 13px; color: #a8a8a8; margin-top: 12px; }
  .source { font-size: 12px; color: #7a7a7a; margin-top: 10px; }
  .source a { color: #6ab7ff; }
  footer { max-width: 1080px; margin: 40px auto 0; color: #7a7a7a; font-size: 12px; text-align: center; }
</style>
</head>
<body>
  <header>
    <h1>Tafri Times — POC Archive</h1>
    <p>${totalCount} generated posts across ${dayCount} day${dayCount === 1 ? "" : "s"} · fictional publication, not real news · auto-updated by the hourly-trending-publish workflow</p>
  </header>
  <div class="tabs">
    ${tabs}
  </div>
  ${panels}
  <footer>Generated ${new Date().toISOString()}</footer>
  <script>
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.day-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.target).classList.add('active');
      });
    });
  </script>
</body>
</html>
`;

export function buildGallery() {
  const posts = loadPosts();
  mkdirSync(path.join(DOCS_DIR, "images"), { recursive: true });
  // .nojekyll: GitHub Pages otherwise runs Jekyll over docs/, which can
  // mangle/ignore files starting with underscores and adds build latency
  // this static page doesn't need.
  writeFileSync(path.join(DOCS_DIR, ".nojekyll"), "");

  for (const post of posts) {
    copyFileSync(post.imagePath, path.join(DOCS_DIR, "images", `${post.dirName}.png`));
  }

  const groups = groupByDate(posts);
  const { tabs, panels } = renderDateGroups(groups);
  writeFileSync(
    path.join(DOCS_DIR, "index.html"),
    PAGE_TEMPLATE({ tabs, panels, totalCount: posts.length, dayCount: groups.length })
  );

  return { postCount: posts.length, dayCount: groups.length };
}

async function main() {
  const result = buildGallery();
  console.error(`Built gallery: ${result.postCount} posts across ${result.dayCount} day(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
