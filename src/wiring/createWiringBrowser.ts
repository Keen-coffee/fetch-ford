import { writeFile } from "fs/promises";
import { join } from "path";
import { WiringTableOfContentsEntry } from "./fetchTableOfContents";

function normalizeSectionTitle(title: string): string {
  return title.replace(/\//g, "-");
}

function getLocalEntryHref(entry: WiringTableOfContentsEntry): string {
  if (entry.Type === "Connectors" || entry.Type === "LocIndex") {
    return "Wiring/Connector Views/index.html";
  }

  return `Wiring/${normalizeSectionTitle(entry.Title)}/index.html`;
}

function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export default async function createWiringBrowser(
  outputPath: string,
  toc: WiringTableOfContentsEntry[]
): Promise<void> {
  const items = toc
    .map((entry) => {
      const href = getLocalEntryHref(entry);
      const label =
        entry.Type === "Connectors"
          ? "Connector Views"
          : entry.Type === "LocIndex"
            ? "Connector Location Index"
            : `${entry.Title}`;

      return `<li><a href="${escapeHTML(href)}" target="viewer">${escapeHTML(label)}</a></li>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Wiring Browser</title>
    <style>
      :root {
        --bg: #f4f6f8;
        --panel: #ffffff;
        --line: #d4dae1;
        --ink: #1a2330;
        --muted: #607086;
      }

      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; font-family: Arial, sans-serif; color: var(--ink); background: var(--bg); }
      .shell { display: flex; height: 100%; }
      .nav { width: 360px; min-width: 280px; background: var(--panel); border-right: 1px solid var(--line); display: flex; flex-direction: column; }
      .header { padding: 12px; border-bottom: 1px solid var(--line); }
      .header h1 { margin: 0 0 8px; font-size: 16px; }
      .header input { width: 100%; padding: 8px; border: 1px solid #acb7c4; border-radius: 4px; }
      .treeWrap { flex: 1; overflow: auto; padding: 8px 10px 16px; }
      ul { list-style: none; padding-left: 0; margin: 0; }
      li { margin: 2px 0; }
      li a { display: block; padding: 4px 6px; border-radius: 4px; color: var(--ink); text-decoration: none; }
      li a:hover { background: #eef3f8; }
      .viewer { flex: 1; display: flex; flex-direction: column; min-width: 0; }
      .toolbar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); background: linear-gradient(180deg, #fff, #f4f7fb); }
      .toolbar button { border: 1px solid #9eb2c8; background: #f7fbff; color: #153b63; border-radius: 4px; padding: 6px 10px; cursor: pointer; font-weight: 600; }
      .path { margin-left: auto; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      iframe { border: 0; width: 100%; flex: 1; background: #fff; }
      .section { margin-bottom: 14px; }
      .section h2 { margin: 10px 0 6px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
      @media (max-width: 1000px) { .shell { flex-direction: column; } .nav { width: 100%; height: 42vh; } .viewer { min-height: 58vh; } }
    </style>
  </head>
  <body>
    <div class="shell">
      <aside class="nav">
        <div class="header">
          <h1>Wiring Navigation</h1>
          <input id="filter" type="search" placeholder="Filter sections" />
        </div>
        <div class="treeWrap">
          <div class="section">
            <h2>Contents</h2>
            <ul id="tree">${items}</ul>
          </div>
        </div>
      </aside>
      <section class="viewer">
        <div class="toolbar">
          <button id="openToc" type="button">Open TOC</button>
          <div id="currentPath" class="path">Wiring/toc.json</div>
        </div>
        <iframe name="viewer" id="frame" title="Wiring content" src="Wiring/toc.json"></iframe>
      </section>
    </div>
    <script>
      const filter = document.getElementById("filter");
      const currentPath = document.getElementById("currentPath");
      const frame = document.getElementById("frame");
      document.getElementById("openToc").addEventListener("click", () => {
        frame.src = "Wiring/toc.json";
        currentPath.textContent = "Wiring/toc.json";
      });
      document.querySelectorAll("#tree a").forEach((a) => {
        a.addEventListener("click", () => {
          currentPath.textContent = a.getAttribute("href") || "";
          setTimeout(() => {
            frame.src = a.getAttribute("href") || "Wiring/toc.json";
          }, 0);
        });
      });
      filter.addEventListener("input", () => {
        const query = filter.value.trim().toLowerCase();
        document.querySelectorAll("#tree li").forEach((li) => {
          const text = (li.textContent || "").toLowerCase();
          li.style.display = !query || text.includes(query) ? "" : "none";
        });
      });
    </script>
  </body>
</html>`;

  await writeFile(join(outputPath, "wiring-browser.html"), html);
}
