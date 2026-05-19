import client from "../client";
import { stringify } from "qs";
import { FetchManualPageParams } from "./fetchManualPage";
import { JSDOM } from "jsdom";
import { basename, posix } from "path";
import { buildManualLeafFilename, sanitizeName } from "../utils";

export interface FetchTreeAndCoverParams extends FetchManualPageParams {
  CategoryDescription: string;
  category: string;
}

interface FetchTreeAndCoverOptions {
  leafExtension?: "pdf" | "html";
}

export interface CoverLinkEntry {
  title: string;
  docID: string;
  relativePath: string;
}

export default async function fetchTreeAndCover(
  params: FetchTreeAndCoverParams,
  options: FetchTreeAndCoverOptions = {}
): Promise<{ tableOfContents: any; pageHTML: string; coverLinkIndex: CoverLinkEntry[] }> {
  const req = await client({
    method: "POST",
    url: `https://www.fordservicecontent.com/Ford_Content/PublicationRuntimeRefreshPTS//publication/prod_1_3_362022/TreeAndCover/workshop/${params.category}/~WS8B/${params.vehicleId}`,
    params: {
      bookTitle: params.bookTitle,
      WiringBookTitle: params.WiringBookTitle,
    },
    data: stringify({
      fromPageBase: "https://www.fordtechservice.dealerconnection.com",
      isMobile: "no",
      usertype: "Retailer",
      ...params,
    }),
  });

  return processTableOfContents(req.data, options.leafExtension || "pdf");
}

// recursively ignore <i> elements with only a single <i> element inside
function ignoreital(el: Element): HTMLCollection {
  if (!el.children.length) {
    console.log("children");

    return el.parentElement!.children;
  }

  if (el.children[0].tagName === "I") {
    return ignoreital(el.children[0]);
  }

  return el.children;
}

function parseul(
  objectpath: { [branchName: string]: object | string } = {},
  ul: Element
): object {
  // all list items' children
  // each item has a span and either a <ul> or an <a>
  const items = Array.from(ul.children)
    .filter((el) => el.tagName === "LI")
    .map((el) => ignoreital(el));

  items.forEach((i) => {
    const iArr = Array.from(i);

    const a = iArr.find((el) => el.tagName === "A");

    if (a) {
      // we're done with this leaf of the branch
      const name = a.textContent;
      const docid = a.getAttribute("data-for");

      // @ts-ignore
      objectpath[name] = docid;
      // this is a foreach, equivalent to a continue;
      return;
    }

    // if no <a> detected, we have a <span> and a <ul>
    const span = iArr.find((el) => el.tagName === "SPAN");
    const childUl = iArr.find((el) => el.tagName === "UL");

    if (!span || !childUl) {
      throw new Error("error code 1");
    }

    // continue recursion
    objectpath[span.textContent || "null-span-textcontent"] = parseul(
      {},
      childUl
    );
  });

  return objectpath;
}

interface TableOfContentsLeaf {
  [documentName: string]: string;
}

function processTableOfContents(toc: string, leafExtension: "pdf" | "html"): {
  tableOfContents: any;
  pageHTML: string;
  coverLinkIndex: CoverLinkEntry[];
} {
  const { window } = new JSDOM(toc);
  const document = window.document;

  const tree = document.getElementsByClassName("tree")[0];
  const parsed = parseul({}, tree);
  const coverLinkIndex = buildCoverLinkIndex(parsed, [], leafExtension);

  const linkByDocID = new Map<string, string>();
  coverLinkIndex.forEach((entry) => {
    if (!linkByDocID.has(entry.docID)) {
      linkByDocID.set(entry.docID, entry.relativePath);
    }
  });

  document.querySelectorAll("a[data-for]").forEach((anchor) => {
    const docID = anchor.getAttribute("data-for");
    if (!docID) return;

    const relativePath = linkByDocID.get(docID);
    if (!relativePath) return;

    anchor.setAttribute("href", encodeURI(relativePath));
    anchor.setAttribute("target", "_self");
    anchor.removeAttribute("onclick");
  });

  // Remove non-functional PTS-only controls and add a local navigation note.
  const imageElement = document.getElementById("imgCollapseTreeDiv");
  imageElement?.insertAdjacentHTML(
    "afterend",
    "<h1><strong>Links below open local downloaded files.</strong></h1><p>This table of contents is now linkable for local browsing. " +
      "Manual downloaded using <a href='https://github.com/iamtheyammer/fetch-ford-service-manuals'>iamtheyammer's Ford manual downloader.</a> " +
      "Refer to the README for more information.</p>"
  );
  imageElement?.remove();

  // reveal the table of contents
  document.getElementById("wsm-tree")?.attributes.removeNamedItem("style");

  return {
    tableOfContents: parsed,
    pageHTML: document.documentElement.outerHTML,
    coverLinkIndex,
  };
}

function buildCoverLinkIndex(
  node: any,
  parentSegments: string[] = [],
  leafExtension: "pdf" | "html" = "pdf"
): CoverLinkEntry[] {
  const out: CoverLinkEntry[] = [];

  Object.entries(node).forEach(([name, value]) => {
    if (typeof value === "string") {
      const docID = value;
      const relativePath = getLocalRelativePath(
        parentSegments,
        name,
        docID,
        leafExtension
      );
      if (!relativePath) return;

      out.push({
        title: name,
        docID,
        relativePath,
      });
      return;
    }

    const nextSegments = [...parentSegments, sanitizeName(name)];
    out.push(...buildCoverLinkIndex(value, nextSegments, leafExtension));
  });

  return out;
}

function getLocalRelativePath(
  parentSegments: string[],
  title: string,
  docID: string,
  leafExtension: "pdf" | "html"
): string | null {
  if (docID.startsWith("http") && docID.includes(".pdf")) {
    if (leafExtension === "pdf") {
      return posix.join(...parentSegments, basename(docID));
    }

    // In HTML-only mode, direct PDF leaves are represented by local HTML wrappers.
    return posix.join(
      ...parentSegments,
      `${buildManualLeafFilename(title, docID)}.html`
    );
  }

  if (docID.includes("/")) {
    // These are relative/unsupported leaves that are skipped during save.
    return null;
  }

  const filename = `${buildManualLeafFilename(title, docID)}.${leafExtension}`;
  return posix.join(...parentSegments, filename);
}
