import { writeFile } from "fs/promises";
import { join } from "path";
import { CoverLinkEntry } from "./fetchTreeAndCover";

export default async function createWorkshopBrowser(
  outputPath: string,
  toc: any,
  coverLinkIndex: CoverLinkEntry[]
): Promise<void> {
  const docIDToRelativePath = Object.fromEntries(
    coverLinkIndex.map((entry) => [entry.docID, entry.relativePath])
  );
  const tocJSON = JSON.stringify(toc).replaceAll("</script", "<\\/script");
  const docIDMapJSON = JSON.stringify(docIDToRelativePath).replaceAll(
    "</script",
    "<\\/script"
  );

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Workshop Browser</title>
    <style>
      :root {
        --bg: #f3f5f7;
        --panel: #ffffff;
        --line: #d6dbe1;
        --ink: #182230;
        --muted: #5d6978;
        --accent: #0f5ca8;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        height: 100%;
        margin: 0;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        color: var(--ink);
        background: var(--bg);
      }

      .shell {
        height: 100%;
        display: flex;
      }

      .content {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        border-right: 1px solid var(--line);
        background: var(--panel);
      }

      .toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--line);
        background: linear-gradient(180deg, #ffffff, #f4f7fb);
      }

      .toolbar button {
        border: 1px solid #9eb2c8;
        background: #f7fbff;
        color: #153b63;
        border-radius: 4px;
        padding: 6px 10px;
        cursor: pointer;
        font-weight: 600;
      }

      .toolbar .path {
        margin-left: auto;
        color: var(--muted);
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #viewer {
        flex: 1;
        width: 100%;
        border: 0;
        background: #fff;
      }

      .nav {
        width: 420px;
        min-width: 280px;
        max-width: 50vw;
        background: var(--panel);
        display: flex;
        flex-direction: column;
      }

      .navHeader {
        padding: 12px;
        border-bottom: 1px solid var(--line);
      }

      .navHeader h1 {
        margin: 0 0 8px;
        font-size: 16px;
      }

      .navHeader input {
        width: 100%;
        border: 1px solid #aab7c6;
        border-radius: 4px;
        padding: 8px;
        font-size: 13px;
      }

      .treeWrap {
        flex: 1;
        overflow: auto;
        padding: 10px 10px 16px;
      }

      .tree,
      .tree ul {
        list-style: none;
        margin: 0;
        padding-left: 16px;
      }

      .tree {
        padding-left: 0;
      }

      .branch > button,
      .leaf {
        width: 100%;
        text-align: left;
        border: 0;
        background: transparent;
        color: var(--ink);
        padding: 4px 6px;
        border-radius: 4px;
        font-size: 13px;
        cursor: pointer;
      }

      .branch > button {
        font-weight: 600;
      }

      .branch > button::before {
        content: "▸";
        display: inline-block;
        margin-right: 6px;
        transition: transform 120ms ease;
        color: #4a5d75;
      }

      .branch.open > button::before {
        transform: rotate(90deg);
      }

      .branch > ul {
        display: none;
      }

      .branch.open > ul {
        display: block;
      }

      .leaf:hover,
      .branch > button:hover {
        background: #eef4fb;
      }

      .leaf.active {
        background: #deecfb;
        color: #083a6e;
        font-weight: 600;
      }

      .hidden {
        display: none !important;
      }

      @media (max-width: 1000px) {
        .shell {
          flex-direction: column;
        }

        .content {
          border-right: 0;
          border-bottom: 1px solid var(--line);
          min-height: 52vh;
        }

        .nav {
          width: 100%;
          max-width: 100%;
          min-width: 0;
          height: 48vh;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="content">
        <div class="toolbar">
          <button id="openCover" type="button">Open Cover</button>
          <button id="clearSelection" type="button">Clear Selection</button>
          <div class="path" id="currentPath">cover.html</div>
        </div>
        <iframe id="viewer" title="Workshop content" src="cover.html"></iframe>
      </section>

      <aside class="nav">
        <div class="navHeader">
          <h1>Workshop Navigation</h1>
          <input id="filter" type="search" placeholder="Filter chapters/pages" />
        </div>
        <div class="treeWrap">
          <ul class="tree" id="tree"></ul>
        </div>
      </aside>
    </div>

    <script>
      const toc = ${tocJSON};
      const docIDToPath = ${docIDMapJSON};

      const treeRoot = document.getElementById("tree");
      const viewer = document.getElementById("viewer");
      const currentPath = document.getElementById("currentPath");
      const filterInput = document.getElementById("filter");
      let activeLeaf = null;

      function createBranch(title, value) {
        const li = document.createElement("li");
        li.className = "branch";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = title;
        li.appendChild(btn);

        const list = document.createElement("ul");
        li.appendChild(list);

        btn.addEventListener("click", () => {
          li.classList.toggle("open");
        });

        Object.entries(value).forEach(([childTitle, childValue]) => {
          list.appendChild(createNode(childTitle, childValue));
        });

        return li;
      }

      function createLeaf(title, docID) {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "leaf";
        button.textContent = title;

        const localPath = docIDToPath[docID];
        if (!localPath) {
          button.disabled = true;
          button.title = "No local file mapped for this entry";
          button.style.opacity = "0.6";
          button.style.cursor = "not-allowed";
        }

        button.addEventListener("click", () => {
          if (!localPath) return;

          if (activeLeaf) {
            activeLeaf.classList.remove("active");
          }
          activeLeaf = button;
          activeLeaf.classList.add("active");

          const encodedPath = encodeURI(localPath);
          viewer.src = encodedPath;
          currentPath.textContent = localPath;
        });

        li.appendChild(button);
        return li;
      }

      function createNode(title, value) {
        if (typeof value === "string") {
          return createLeaf(title, value);
        }
        return createBranch(title, value);
      }

      Object.entries(toc).forEach(([title, value]) => {
        treeRoot.appendChild(createNode(title, value));
      });

      document.getElementById("openCover").addEventListener("click", () => {
        viewer.src = "cover.html";
        currentPath.textContent = "cover.html";
      });

      document.getElementById("clearSelection").addEventListener("click", () => {
        if (activeLeaf) {
          activeLeaf.classList.remove("active");
          activeLeaf = null;
        }
      });

      filterInput.addEventListener("input", () => {
        const query = filterInput.value.trim().toLowerCase();
        const items = treeRoot.querySelectorAll("li");

        items.forEach((item) => {
          item.classList.remove("hidden");
        });

        if (!query) {
          return;
        }

        // Hide leaves first based on text match.
        const leaves = treeRoot.querySelectorAll(".leaf");
        leaves.forEach((leaf) => {
          const matches = (leaf.textContent || "").toLowerCase().includes(query);
          leaf.parentElement.classList.toggle("hidden", !matches);
        });

        // Show branches that have visible descendants, hide empty ones.
        const branches = Array.from(treeRoot.querySelectorAll(".branch")).reverse();
        branches.forEach((branch) => {
          const hasVisibleChild = !!Array.from(branch.querySelectorAll(":scope > ul > li")).find(
            (child) => !child.classList.contains("hidden")
          );
          branch.classList.toggle("hidden", !hasVisibleChild);
          if (hasVisibleChild) {
            branch.classList.add("open");
          }
        });
      });
    </script>
  </body>
</html>`;

  await writeFile(join(outputPath, "workshop-browser.html"), html);
}