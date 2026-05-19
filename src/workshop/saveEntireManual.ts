import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, relative, resolve } from "path";
import fetchManualPage, {
  FetchManualPageParams,
  ManualProcedureRequest,
} from "./fetchManualPage";
import { WorkshopDownloadEntry } from "./fetchTreeAndCover";
import client from "../client";
import { Page } from "playwright";
import { CLIArgs } from "../processCLIArgs";
import saveStream, { sanitizeName } from "../utils";
import { JSDOM } from "jsdom";

export type SaveOptions = Pick<
  CLIArgs,
  | "saveHTML"
  | "ignoreSaveErrors"
  | "expandInteractive"
  | "followDiagnosticLinks"
  | "htmlOnly"
> & {
  manualRootPath?: string;
  docIDToRelativePath?: Record<string, string>;
};

interface DiagnosticLink {
  id: string;
  title?: string;
}

function resolveWorkshopURL(rawURL: string): string {
  if (rawURL.startsWith("http://") || rawURL.startsWith("https://")) {
    return rawURL;
  }

  // PTS quick links often provide /publication/... paths that are relative to
  // the PublicationRuntimeRefreshPTS app root, not the site root.
  if (rawURL.startsWith("/publication/")) {
    return `https://www.fordservicecontent.com/Ford_Content/PublicationRuntimeRefreshPTS//${rawURL.replace(/^\//, "")}`;
  }

  if (rawURL.startsWith("/")) {
    return `https://www.fordservicecontent.com${rawURL}`;
  }

  return `https://www.fordservicecontent.com/${rawURL}`;
}

function buildProcedureRequestPayload(
  params: FetchManualPageParams,
  entry: WorkshopDownloadEntry,
  searchNumberOverride?: string
): ManualProcedureRequest {
  const searchNumber = searchNumberOverride || entry.searchNumber;
  if (!searchNumber) {
    throw new Error(`Missing searchNumber for procedure entry ${entry.id}`);
  }

  const payload: Record<string, string | string[]> = {
    isMobile: "no",
    usertype: params.usertype || "Retailer",
    userQsPilot: params.userQsPilot || "||",
    vehicleId: params.vehicleId,
    modelYear: params.modelYear,
    channel: params.channel,
    category: params.category,
    book: params.book,
    bookTitle: params.bookTitle,
    booktype: params.booktype,
    country: params.country,
    language: params.language,
    contentmarket: params.contentmarket,
    contentlanguage: params.contentlanguage,
    languageOdysseyCode: params.languageOdysseyCode,
    searchNumber,
    procUid: entry.procUid || searchNumber,
    Vid: params.Vid,
    byvin: params.byvin,
    marketGroup: params.marketGroup,
    WiringBookCode: params.WiringBookCode,
    WiringBookTitle: params.WiringBookTitle,
    fromPageBase:
      params.fromPageBase ||
      "https://www.fordtechservice.dealerconnection.com",
  };

  if (params.vin) payload.vin = params.vin;
  if (params.contentgroup) payload.contentgroup = params.contentgroup;
  if (params.WiringFormat) payload.WiringFormat = params.WiringFormat;
  if (params.adt) payload.adt = params.adt;
  if (params.diagTool) payload.diagTool = params.diagTool;
  if (params.otx) payload.otx = params.otx;
  if (params.adtLocation) payload.adtLocation = params.adtLocation;

  const primaryCodes =
    params.primaryFeatureCodes && params.primaryFeatureCodes.length > 0
      ? params.primaryFeatureCodes
      : entry.primaryFeatureCodes;
  const minorCodes =
    params.minorFeatureCodes && params.minorFeatureCodes.length > 0
      ? params.minorFeatureCodes
      : entry.minorFeatureCodes;

  if (primaryCodes.length > 0) {
    payload.primaryFeatureCodes = primaryCodes;
  }
  if (minorCodes.length > 0) {
    payload.minorFeatureCodes = minorCodes;
  }

  return {
    environment: params.environment,
    payload,
  };
}

function extractLookupKeysFromAnchor(anchor: HTMLAnchorElement): string[] {
  const keys: string[] = [];
  const dataFor = anchor.getAttribute("data-for")?.trim();
  if (dataFor) {
    keys.push(dataFor);
    keys.push(dataFor.toUpperCase());
  }

  const procUid = anchor.getAttribute("data-procuid")?.trim();
  if (procUid) {
    keys.push(procUid);
    keys.push(procUid.toUpperCase());
  }

  const href = anchor.getAttribute("href") || "";
  const searchNumberMatch = href.match(/[?&]searchNumber=([A-Z0-9]+)/i);
  if (searchNumberMatch?.[1]) {
    keys.push(searchNumberMatch[1]);
    keys.push(searchNumberMatch[1].toUpperCase());
  }

  const onclick = anchor.getAttribute("onclick") || "";
  const onclickSearchNumberMatch = onclick.match(/searchNumber[=:]([A-Z0-9]+)/i);
  if (onclickSearchNumberMatch?.[1]) {
    keys.push(onclickSearchNumberMatch[1]);
    keys.push(onclickSearchNumberMatch[1].toUpperCase());
  }

  return Array.from(new Set(keys));
}

function extractHashFragmentFromAnchor(anchor: HTMLAnchorElement): string {
  const hrefAttr = (anchor.getAttribute("href") || "").trim();
  if (hrefAttr.startsWith("#") && hrefAttr.length > 1) {
    return hrefAttr;
  }

  if (hrefAttr.includes("#")) {
    const idx = hrefAttr.indexOf("#");
    const fragment = hrefAttr.slice(idx);
    if (fragment.length > 1) {
      return fragment;
    }
  }

  const onclick = anchor.getAttribute("onclick") || "";
  const onclickHashMatch = onclick.match(/#([A-Za-z0-9_\-:]+)/);
  if (onclickHashMatch?.[1]) {
    return `#${onclickHashMatch[1]}`;
  }

  return "";
}

function preparePageHTMLForLocalBrowsing(
  html: string,
  currentFolderPath: string,
  options: SaveOptions
): string {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  if (document.head && !document.querySelector("head > base")) {
    const base = document.createElement("base");
    // Keep unresolved relative links local when browsing downloaded HTML.
    base.setAttribute("href", "./");
    document.head.prepend(base);
  }

  if (!options.manualRootPath || !options.docIDToRelativePath) {
    return dom.serialize();
  }

  const manualRootPath = options.manualRootPath;
  const docIDToRelativePath = options.docIDToRelativePath;

  const normalizedDocPathMap = Object.fromEntries(
    Object.entries(docIDToRelativePath).map(([k, v]) => [k, v])
  );

  document.querySelectorAll("a").forEach((anchorEl) => {
    const anchor = anchorEl as HTMLAnchorElement;
    const lookupKeys = extractLookupKeysFromAnchor(anchor);
    const fragment = extractHashFragmentFromAnchor(anchor);
    const targetRelativePathFromRoot = lookupKeys
      .map((key) => normalizedDocPathMap[key])
      .find(Boolean);

    if (!targetRelativePathFromRoot) {
      return;
    }

    const absoluteTargetPath = join(
      manualRootPath,
      targetRelativePathFromRoot
    );
    const relativeTargetPath = relative(currentFolderPath, absoluteTargetPath)
      .replaceAll("\\", "/");
    const rewrittenTarget = fragment
      ? `${relativeTargetPath}${fragment}`
      : relativeTargetPath;

    anchor.setAttribute("href", encodeURI(rewrittenTarget));
    anchor.setAttribute("target", "_self");
    anchor.removeAttribute("onclick");
  });

  return dom.serialize();
}

function expandInteractiveHTML(html: string): string {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  document.querySelectorAll('div[id^="PPT"]').forEach((div) => {
    (div as HTMLElement).style.display = "block";
  });

  document
    .querySelectorAll('tr[data-content-type="step"]')
    .forEach((row) => {
      (row as HTMLElement).style.display = "";
    });

  document
    .querySelectorAll('a[data-pptlinktype="clickfordetails"]')
    .forEach((link) => {
      (link as HTMLElement).style.display = "none";
      const nextSpan = link.nextElementSibling;
      if (nextSpan && nextSpan.tagName === "SPAN") {
        (nextSpan as HTMLElement).style.display = "inline";
      }
    });

  document.querySelectorAll(".isipppt").forEach((el) => {
    (el as HTMLElement).setAttribute("aria-expanded", "true");
  });

  return dom.serialize();
}

function extractDiagnosticLinks(html: string): DiagnosticLink[] {
  const links: DiagnosticLink[] = [];
  const seen = new Set<string>();
  const searchNumberPattern = /searchNumber[=:]([A-Z0-9]+)/gi;

  let match: RegExpExecArray | null;
  while ((match = searchNumberPattern.exec(html)) !== null) {
    const id = match[1];
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    links.push({ id });
  }

  return links;
}

async function expandInteractiveElements(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll(".isipppt").forEach((header) => {
      try {
        (header as HTMLElement).click();
      } catch {
        // no-op
      }
    });

    document.querySelectorAll('div[id^="PPT"]').forEach((div) => {
      (div as HTMLElement).style.display = "block";
    });

    document
      .querySelectorAll('tr[data-content-type="step"]')
      .forEach((row) => {
        (row as HTMLElement).style.display = "";
      });

    document
      .querySelectorAll('a[data-pptlinktype="clickfordetails"]')
      .forEach((link) => {
        try {
          (link as HTMLElement).style.display = "none";
          const nextSpan = link.nextElementSibling;
          if (nextSpan && nextSpan.tagName === "SPAN") {
            (nextSpan as HTMLElement).style.display = "inline";
          }
        } catch {
          // no-op
        }
      });
  });

  await page.waitForTimeout(2000);
  try {
    await page.waitForLoadState("networkidle", { timeout: 5000 });
  } catch {
    // Continue if there are still active requests.
  }
}

export default async function saveEntireManual(
  rootPath: string,
  downloadIndex: WorkshopDownloadEntry[],
  fetchPageParams: FetchManualPageParams,
  browserPage: Page,
  options: SaveOptions
) {
  const shouldSaveHTML = options.saveHTML || options.htmlOnly;

  for (const entry of downloadIndex) {
    const folderPath = join(rootPath, ...entry.folderSegments);
    await mkdir(folderPath, { recursive: true });

    const htmlPath = resolve(join(rootPath, entry.localRelativePathHtml));
    const pdfPath = resolve(join(rootPath, entry.localRelativePathPdf));
    const outputAlreadyExists = options.htmlOnly
      ? existsSync(htmlPath)
      : existsSync(pdfPath);

    if (outputAlreadyExists) {
      console.log(`Skipping manual page ${entry.title} (already exists)`);
      continue;
    }

    try {
      if (entry.leafType === "url") {
        if (!entry.url) {
          throw new Error(`Missing URL for entry ${entry.id}`);
        }

        const url = resolveWorkshopURL(entry.url);
        const isPdfUrl = /\.pdf(?:$|\?)/i.test(url);

        try {
          if (isPdfUrl && options.htmlOnly) {
            const wrapperHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${entry.title}</title>
</head>
<body style="margin:0; font-family: Arial, sans-serif;">
  <p style="padding:8px 12px; margin:0; border-bottom:1px solid #ddd; background:#f7f7f7;">
    This item is served by Ford as PDF. If it does not render below, <a href="${url}" target="_blank" rel="noopener noreferrer">open it directly</a>.
  </p>
  <iframe src="${url}" title="${entry.title}" style="width:100%; height:calc(100vh - 42px); border:0;"></iframe>
</body>
</html>`;

            await writeFile(htmlPath, wrapperHTML);
            continue;
          }

          if (isPdfUrl && !options.htmlOnly) {
            console.log(`Downloading workshop PDF ${entry.title} (${url})`);
            const pdfReq = await client({
              url,
              responseType: "stream",
            });
            await saveStream(pdfReq.data, pdfPath);
            continue;
          }

          console.log(`Downloading workshop URL page ${entry.title} (${url})`);
          const pageReq = await client({
            url,
            responseType: "text",
          });

          const pageHTML = preparePageHTMLForLocalBrowsing(
            String(pageReq.data),
            folderPath,
            options
          );

          await writeFile(htmlPath, pageHTML);

          if (!options.htmlOnly) {
            await browserPage.setContent(pageHTML, { waitUntil: "load" });
            await browserPage.pdf({ path: pdfPath });
          }
        } catch (urlError) {
          const status = (urlError as any)?.response?.status;
          if (status === 404) {
            console.warn(
              `Skipping URL leaf ${entry.title} due to 404 (${url})`
            );
            continue;
          }

          throw urlError;
        }

        continue;
      }

      console.log(
        `Downloading manual page ${entry.title} as ${
          options.htmlOnly ? "HTML" : shouldSaveHTML ? "HTML and PDF" : "PDF"
        }`
      );

      const request = buildProcedureRequestPayload(fetchPageParams, entry);
      const pageHTML = await fetchManualPage(request);
      const localLinkedHTML = preparePageHTMLForLocalBrowsing(
        pageHTML,
        folderPath,
        options
      );
      const pageHTMLWithLocalLinks = options.expandInteractive
        ? expandInteractiveHTML(localLinkedHTML)
        : localLinkedHTML;

      if (shouldSaveHTML) {
        await writeFile(htmlPath, pageHTMLWithLocalLinks);
      }

      if (!options.htmlOnly) {
        await browserPage.setContent(pageHTMLWithLocalLinks, {
          waitUntil: "load",
        });
        await browserPage.evaluate(
          'document.querySelectorAll("body > div > table > tbody > tr > td:nth-child(2)").forEach(e => e.remove())'
        );

        if (options.expandInteractive) {
          await expandInteractiveElements(browserPage);
        }

        await browserPage.pdf({ path: pdfPath });
      }

      if (options.followDiagnosticLinks) {
        const links = extractDiagnosticLinks(pageHTML);
        for (const link of links) {
          if (!link.id || !/^([A-Z0-9]+)$/.test(link.id)) {
            continue;
          }

          const linkedFilename = sanitizeName(link.id);
          const linkedHtmlPath = resolve(join(folderPath, `${linkedFilename}.html`));
          const linkedPdfPath = resolve(join(folderPath, `${linkedFilename}.pdf`));

          if (options.htmlOnly ? existsSync(linkedHtmlPath) : existsSync(linkedPdfPath)) {
            continue;
          }

          try {
            const linkedRequest = buildProcedureRequestPayload(
              fetchPageParams,
              entry,
              link.id
            );
            const linkedPageHTML = await fetchManualPage(linkedRequest);
            const linkedLocalLinkedHTML = preparePageHTMLForLocalBrowsing(
              linkedPageHTML,
              folderPath,
              options
            );
            const linkedPageHTMLWithLocalLinks = options.expandInteractive
              ? expandInteractiveHTML(linkedLocalLinkedHTML)
              : linkedLocalLinkedHTML;

            if (shouldSaveHTML) {
              await writeFile(linkedHtmlPath, linkedPageHTMLWithLocalLinks);
            }

            if (!options.htmlOnly) {
              await browserPage.setContent(linkedPageHTMLWithLocalLinks, {
                waitUntil: "load",
              });
              await browserPage.pdf({ path: linkedPdfPath });
            }
          } catch (linkError) {
            if (!options.ignoreSaveErrors) {
              throw linkError;
            }

            console.error(
              `Continuing after error on linked diagnostic ${link.id}: ${linkError}`
            );
          }
        }
      }
    } catch (e) {
      if (options.ignoreSaveErrors) {
        console.error(
          `Continuing after error downloading ${entry.title} (${entry.id}): ${e}`
        );
      } else {
        throw e;
      }
    }
  }
}
