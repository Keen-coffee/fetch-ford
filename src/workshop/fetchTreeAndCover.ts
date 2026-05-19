import client from "../client";
import { stringify } from "qs";
import { FetchManualPageParams } from "./fetchManualPage";
import { JSDOM } from "jsdom";
import { basename, posix } from "path";
import { buildManualLeafFilename, sanitizeName } from "../utils";

export interface FetchTreeAndCoverParams extends FetchManualPageParams {}

interface FetchTreeAndCoverOptions {
  leafExtension?: "pdf" | "html";
}

interface FeatureHints {
  primaryFeatureCodes: string[];
  minorFeatureCodes: string[];
}

export interface WorkshopTreeBranch {
  kind: "branch";
  title: string;
  pathSegments: string[];
  folderSegments: string[];
  dataGroup?: string;
  dataId?: string;
  dataSubSectionName?: string;
  featureHints: FeatureHints;
  children: WorkshopTreeNode[];
}

export interface WorkshopTreeLeaf {
  kind: "leaf";
  id: string;
  title: string;
  pathSegments: string[];
  folderSegments: string[];
  dataGroup?: string;
  dataFor: string;
  procUid?: string;
  linkClass: string;
  leafType: "procedure" | "url";
  searchNumber?: string;
  url?: string;
  featureHints: FeatureHints;
  localRelativePathPdf: string;
  localRelativePathHtml: string;
}

export type WorkshopTreeNode = WorkshopTreeBranch | WorkshopTreeLeaf;

export interface WorkshopDownloadEntry {
  id: string;
  title: string;
  breadcrumbs: string[];
  folderSegments: string[];
  leafType: "procedure" | "url";
  dataFor: string;
  procUid?: string;
  searchNumber?: string;
  url?: string;
  localRelativePathPdf: string;
  localRelativePathHtml: string;
  primaryFeatureCodes: string[];
  minorFeatureCodes: string[];
}

export interface CoverLinkEntry {
  title: string;
  entryID: string;
  searchNumber?: string;
  relativePath: string;
}

export interface FetchTreeAndCoverResult {
  tableOfContents: any;
  tree: WorkshopTreeNode[];
  pageHTML: string;
  coverLinkIndex: CoverLinkEntry[];
  downloadIndex: WorkshopDownloadEntry[];
}

export default async function fetchTreeAndCover(
  params: FetchTreeAndCoverParams,
  options: FetchTreeAndCoverOptions = {}
): Promise<FetchTreeAndCoverResult> {
  const treeBookPath = params.treeBookPath || `~W${params.book}`;

  const req = await client({
    method: "POST",
    url: `https://www.fordservicecontent.com/Ford_Content/PublicationRuntimeRefreshPTS//publication/${params.environment}/TreeAndCover/workshop/${params.category}/${treeBookPath}/${params.vehicleId}`,
    params: {
      bookTitle: params.bookTitle,
      WiringBookTitle: params.WiringBookTitle,
    },
    data: stringify(
      {
        fromPageBase:
          params.fromPageBase ||
          "https://www.fordtechservice.dealerconnection.com",
        isMobile: "no",
        vin: params.vin,
        vehicleId: params.vehicleId,
        modelYear: params.modelYear,
        searchNumber: "0",
        channel: params.channel,
        category: params.category,
        CategoryDescription: params.CategoryDescription,
        book: params.book,
        booktype: params.booktype,
        country: params.country,
        language: params.language,
        contentmarket: params.contentmarket,
        contentlanguage: params.contentlanguage,
        languageOdysseyCode: params.languageOdysseyCode,
        contentgroup: params.contentgroup,
        WiringBookCode: params.WiringBookCode,
        WiringFormat: params.WiringFormat,
        strVehLine: params.strVehLine,
        strProdType: params.strProdType,
      },
      {
        skipNulls: true,
      }
    ),
  });

  return processTreeAndCoverResponse(
    req.data,
    params,
    options.leafExtension || "pdf"
  );
}

function normalizeCodeList(codes: string[] | undefined): string[] {
  if (!codes || codes.length === 0) {
    return [];
  }

  return Array.from(
    new Set(
      codes
        .map((code) => code.trim())
        .filter(Boolean)
        .map((code) => code.toUpperCase())
    )
  );
}

function parsePipeCodeList(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  return normalizeCodeList(raw.split("|"));
}

function buildFolderSegment(
  title: string,
  dataId?: string,
  dataGroup?: string
): string {
  const id = (dataId || "").trim();
  if (id) {
    return sanitizeName(id);
  }

  const group = (dataGroup || "").trim();
  if (group) {
    return sanitizeName(group);
  }

  // Some top-level PTS tree branches do not expose IDs.
  return sanitizeName(title);
}

function mergeFeatureHints(
  inherited: FeatureHints,
  ownPrimary: string[],
  ownMinor: string[]
): FeatureHints {
  return {
    primaryFeatureCodes:
      ownPrimary.length > 0 ? ownPrimary : inherited.primaryFeatureCodes,
    minorFeatureCodes: ownMinor.length > 0 ? ownMinor : inherited.minorFeatureCodes,
  };
}

function collectDirectChildrenByTag(parent: Element, tag: string): Element[] {
  return Array.from(parent.children).filter(
    (child) => child.tagName.toLowerCase() === tag
  );
}

function findTopLevelTagThroughIconWrappers(
  parent: Element,
  tag: string
): Element | null {
  const wanted = tag.toLowerCase();

  const queue: Element[] = [parent];
  while (queue.length > 0) {
    const node = queue.shift()!;

    for (const child of Array.from(node.children)) {
      const childTag = child.tagName.toLowerCase();
      if (childTag === wanted) {
        return child;
      }

      // PTS markup frequently wraps top-level elements in unclosed/self-closing icon tags.
      if (childTag === "i") {
        queue.push(child);
      }
    }
  }

  return null;
}

function getPrimaryAnchor(li: Element): HTMLAnchorElement | null {
  const anchor = findTopLevelTagThroughIconWrappers(li, "a");
  return anchor as HTMLAnchorElement | null;
}

function getBranchSpan(li: Element): HTMLSpanElement | null {
  const span = findTopLevelTagThroughIconWrappers(li, "span");
  return span as HTMLSpanElement | null;
}

function getBranchChildList(li: Element): HTMLUListElement | null {
  const ul = findTopLevelTagThroughIconWrappers(li, "ul");
  return ul as HTMLUListElement | null;
}

function isUrlLike(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/");
}

function buildLeafRelativePaths(
  folderSegments: string[],
  title: string,
  leafType: "procedure" | "url",
  dataFor: string,
  searchNumber?: string,
  url?: string
): { localRelativePathPdf: string; localRelativePathHtml: string } {
  if (leafType === "procedure") {
    const leafID = searchNumber || dataFor;
    const filename = sanitizeName(leafID);

    return {
      localRelativePathPdf: posix.join(...folderSegments, `${filename}.pdf`),
      localRelativePathHtml: posix.join(...folderSegments, `${filename}.html`),
    };
  }

  const isPdfURL = !!url && /\.pdf(?:$|\?)/i.test(url);
  if (isPdfURL && url) {
    const urlPath = url.startsWith("http") ? new URL(url).pathname : url;
    const baseName = basename(urlPath) || `${buildManualLeafFilename(title, dataFor)}.pdf`;

    return {
      localRelativePathPdf: posix.join(...folderSegments, baseName),
      localRelativePathHtml: posix.join(
        ...folderSegments,
        `${buildManualLeafFilename(title, dataFor)}.html`
      ),
    };
  }

  const htmlName = buildManualLeafFilename(title, dataFor);
  return {
    localRelativePathPdf: posix.join(...folderSegments, `${htmlName}.pdf`),
    localRelativePathHtml: posix.join(...folderSegments, `${htmlName}.html`),
  };
}

function parseTreeList(
  ul: Element,
  parentPath: string[],
  parentFolderSegments: string[],
  inheritedHints: FeatureHints,
  downloadIndex: WorkshopDownloadEntry[]
): WorkshopTreeNode[] {
  const nodes: WorkshopTreeNode[] = [];
  const liChildren = collectDirectChildrenByTag(ul, "li");

  liChildren.forEach((li) => {
    const dataGroup = li.getAttribute("data-group") || undefined;
    const dataId = li.getAttribute("data-id") || undefined;
    const dataSubSectionName = li.getAttribute("data-subSectionName") || undefined;

    const anchor = getPrimaryAnchor(li);
    if (anchor) {
      const title = anchor.textContent?.trim() || "Untitled";
      const dataFor = (anchor.getAttribute("data-for") || "").trim();
      const procUid = (anchor.getAttribute("data-procuid") || "").trim() || undefined;
      const linkClass = anchor.className || "";
      const leafType: "procedure" | "url" = isUrlLike(dataFor)
        ? "url"
        : "procedure";
      const searchNumber = leafType === "procedure" ? dataFor : undefined;
      const url = leafType === "url" ? dataFor : undefined;
      const folderSegments = [...parentFolderSegments];
      const paths = buildLeafRelativePaths(
        folderSegments,
        title,
        leafType,
        dataFor,
        searchNumber,
        url
      );
      const entryID = `${folderSegments.join("/")}::${dataFor}::${procUid || ""}`;

      const leafNode: WorkshopTreeLeaf = {
        kind: "leaf",
        id: entryID,
        title,
        pathSegments: [...parentPath],
        folderSegments,
        dataGroup,
        dataFor,
        procUid,
        linkClass,
        leafType,
        searchNumber,
        url,
        featureHints: inheritedHints,
        localRelativePathPdf: paths.localRelativePathPdf,
        localRelativePathHtml: paths.localRelativePathHtml,
      };

      nodes.push(leafNode);
      downloadIndex.push({
        id: entryID,
        title,
        breadcrumbs: [...parentPath, title],
        folderSegments,
        leafType,
        dataFor,
        procUid,
        searchNumber,
        url,
        localRelativePathPdf: paths.localRelativePathPdf,
        localRelativePathHtml: paths.localRelativePathHtml,
        primaryFeatureCodes: inheritedHints.primaryFeatureCodes,
        minorFeatureCodes: inheritedHints.minorFeatureCodes,
      });
      return;
    }

    const span = getBranchSpan(li);
    const childList = getBranchChildList(li);
    if (!span || !childList) {
      return;
    }

    const title = span.textContent?.trim() || "Untitled";
    const ownPrimary = parsePipeCodeList(span.getAttribute("data-feature-pfcs"));
    const ownMinor = parsePipeCodeList(span.getAttribute("data-feature-mfcs"));
    const mergedHints = mergeFeatureHints(inheritedHints, ownPrimary, ownMinor);
    const folderSegment = buildFolderSegment(title, dataId, dataGroup);
    const nextFolderSegments = [...parentFolderSegments, folderSegment];

    const children = parseTreeList(
      childList,
      [...parentPath, title],
      nextFolderSegments,
      mergedHints,
      downloadIndex
    );

    nodes.push({
      kind: "branch",
      title,
      pathSegments: [...parentPath],
      folderSegments: nextFolderSegments,
      dataGroup,
      dataId,
      dataSubSectionName,
      featureHints: mergedHints,
      children,
    });
  });

  return nodes;
}

function buildSimpleTableOfContents(tree: WorkshopTreeNode[]): any {
  const out: Record<string, any> = {};

  tree.forEach((node) => {
    if (node.kind === "leaf") {
      out[node.title] = node.searchNumber || node.dataFor;
      return;
    }

    out[node.title] = buildSimpleTableOfContents(node.children);
  });

  return out;
}

function processTreeAndCoverResponse(
  html: string,
  params: FetchTreeAndCoverParams,
  leafExtension: "pdf" | "html"
): FetchTreeAndCoverResult {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  const treeRoot = document.querySelector("#treeNodesDiv > ul.tree");
  if (!treeRoot) {
    throw new Error("Could not find workshop tree root (#treeNodesDiv > ul.tree)");
  }

  const downloadIndex: WorkshopDownloadEntry[] = [];
  const defaultFeatureHints: FeatureHints = {
    primaryFeatureCodes: normalizeCodeList(params.primaryFeatureCodes),
    minorFeatureCodes: normalizeCodeList(params.minorFeatureCodes),
  };

  const parsedTree = parseTreeList(
    treeRoot,
    [],
    [],
    defaultFeatureHints,
    downloadIndex
  );
  const tableOfContents = buildSimpleTableOfContents(parsedTree);

  const pathBySearchNumber = new Map<string, string>();
  const pathByDataFor = new Map<string, string>();

  downloadIndex.forEach((entry) => {
    const relativePath =
      leafExtension === "html" ? entry.localRelativePathHtml : entry.localRelativePathPdf;

    pathByDataFor.set(entry.dataFor, relativePath);
    if (entry.searchNumber) {
      pathBySearchNumber.set(entry.searchNumber.toUpperCase(), relativePath);
    }
  });

  document.querySelectorAll("a[data-for]").forEach((anchor) => {
    const dataFor = anchor.getAttribute("data-for");
    if (!dataFor) {
      return;
    }

    const normalizedDataFor = dataFor.trim();
    const searchPath = pathBySearchNumber.get(normalizedDataFor.toUpperCase());
    const dataForPath = pathByDataFor.get(normalizedDataFor);
    const relativePath = searchPath || dataForPath;

    if (!relativePath) {
      return;
    }

    anchor.setAttribute("href", encodeURI(relativePath));
    anchor.setAttribute("target", "_self");
    anchor.removeAttribute("onclick");
  });

  const treeContainer = document.getElementById("wsm-tree");
  if (treeContainer) {
    treeContainer.removeAttribute("style");
  }

  const introTarget = document.getElementById("imgCollapseTreeDiv");
  if (introTarget) {
    introTarget.insertAdjacentHTML(
      "afterend",
      "<p><strong>Local navigation enabled.</strong> Links in this tree open downloaded files in your output folder.</p>"
    );
  }

  const coverLinkIndex: CoverLinkEntry[] = downloadIndex.map((entry) => ({
    title: entry.title,
    entryID: entry.id,
    searchNumber: entry.searchNumber,
    relativePath:
      leafExtension === "html" ? entry.localRelativePathHtml : entry.localRelativePathPdf,
  }));

  return {
    tableOfContents,
    tree: parsedTree,
    pageHTML: dom.serialize(),
    coverLinkIndex,
    downloadIndex,
  };
}
