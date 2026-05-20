import { Page } from "playwright";
import { JSDOM } from "jsdom";
import fetchPageList from "./fetchPageList";
import {
  WiringFetchParams,
  WiringTableOfContentsEntry,
} from "./fetchTableOfContents";
import fetchSvg from "./fetchSvg";
import { join, relative } from "path";
import { writeFile } from "fs/promises";
import { sanitizeName } from "../utils";

export interface WiringFetchPageParams extends WiringFetchParams {
  vehicleId: string;
  country: string;
}

export interface WiringSaveOptions {
  saveHTML?: boolean;
  htmlOnly?: boolean;
}

function normalizeWiringLinkTarget(href: string): string {
  const value = href.trim();
  if (!value) {
    return "";
  }

  const hashIndex = value.indexOf("#");
  if (hashIndex === 0) {
    return value;
  }

  if (hashIndex > 0) {
    return value.slice(0, hashIndex);
  }

  return value;
}

function rewriteSvgLinksToLocalTargets(
  svgHtml: string,
  currentFolderPath: string,
  pagePathMap: Map<string, string>
): string {
  const dom = new JSDOM(svgHtml);
  const document = dom.window.document;

  const rewrite = (anchor: Element, hrefAttr: string) => {
    const href = anchor.getAttribute(hrefAttr);
    if (!href) {
      return;
    }

    const normalized = normalizeWiringLinkTarget(href);
    const hashIndex = href.indexOf("#");
    const fragment = hashIndex >= 0 ? href.slice(hashIndex) : "";

    const targetPath =
      pagePathMap.get(normalized) || pagePathMap.get(href) || pagePathMap.get(`${normalized}.html`) || pagePathMap.get(`${normalized}.svg`);
    if (!targetPath) {
      return;
    }

    const relativeTarget = relative(currentFolderPath, targetPath).replaceAll("\\", "/");
    anchor.setAttribute(hrefAttr, encodeURI(`${relativeTarget}${fragment}`));
  };

  document.querySelectorAll("a").forEach((anchor) => {
    rewrite(anchor, "href");
    rewrite(anchor, "xlink:href");
  });

  return dom.serialize();
}

function buildWiringHtmlWrapper(
  title: string,
  svgHtml: string,
  currentFolderPath: string
): string {
  const folderHref = encodeURI(
    `file://${currentFolderPath.endsWith("/") ? currentFolderPath : `${currentFolderPath}/`}`
  );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base href="${folderHref}" />
  <title>${title}</title>
  <style>
    html, body { margin: 0; height: 100%; }
    body { overflow: hidden; background: #fff; }
    .wrap { width: 100vw; height: 100vh; }
    svg { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div class="wrap">
    ${svgHtml}
  </div>
</body>
</html>`;
}

export default async function savePage(
  params: WiringFetchPageParams,
  doc:
    | (WiringTableOfContentsEntry & { Type: "Page" })
    | (WiringTableOfContentsEntry & { Type: "BasicPage" }),
  browserPage: Page,
  folderPath: string,
  ignoreSaveErrors: boolean = false,
  options: WiringSaveOptions = {}
): Promise<void> {
  const pageList = await fetchPageList({
    ...params,
    cell: doc.Number,
    title: doc.Title,
    page: "1",
  });

  await writeFile(
    join(folderPath, "pageList.json"),
    JSON.stringify(pageList, null, 2)
  );

  const subPages: string[] = [];
  for (const subPage of pageList as any[]) {
    if (typeof subPage === "string") {
      subPages.push(subPage);
      continue;
    }

    if (subPage && typeof subPage === "object") {
      if ("page" in subPage && subPage.page) {
        subPages.push(String(subPage.page));
      }
    }
  }

  const pagePathMap = new Map<string, string>();
  for (const pageNumber of subPages) {
    const cleanPageNumber = sanitizeName(pageNumber);
    const localHtmlPath = join(folderPath, `${cleanPageNumber}.html`);
    const localSvgPath = join(folderPath, `${cleanPageNumber}.svg`);
    pagePathMap.set(cleanPageNumber, localHtmlPath);
    pagePathMap.set(pageNumber, localHtmlPath);
    pagePathMap.set(`${cleanPageNumber}.html`, localHtmlPath);
    pagePathMap.set(`${cleanPageNumber}.svg`, localSvgPath);
  }

  for (const subPage of pageList as any[]) {
    let pageNumber: string | null = null;

    if (typeof subPage === "string") {
      pageNumber = subPage;
    } else if (subPage && typeof subPage === "object") {
      // Current Ford format: {cell, page, Code, Startdate, Enddate}
      if ("page" in subPage && subPage.page) {
        pageNumber = String(subPage.page);
      } else if ("Value" in subPage && subPage.Value) {
        // Legacy BasicPage format - skip
        console.warn(
          `  Skipping legacy BasicPage subpage in ${doc.Title}`
        );
        continue;
      }
    }

    if (!pageNumber) {
      console.warn(
        `  Skipping unrecognized subpage format in ${doc.Title}: ${JSON.stringify(
          subPage
        )}`
      );
      continue;
    }

    try {
      console.log(`Saving page ${pageNumber} of ${doc.Title}...`);

      const svg = await fetchSvg(
        doc.Number,
        pageNumber,
        params.environment,
        params.vehicleId,
        params.book,
        params.languageCode
      );

      const dom = new JSDOM(svg);
      const svgElement = dom.window.document.querySelector("svg");
      if (!svgElement) {
        console.error(
          `  No SVG element found in Wiring SVG for ${doc.Title} ${pageNumber}`
        );
        continue;
      }

      svgElement.setAttribute("xmlns", "http://www.w3.org/2000/svg");

      const cleanPageNumber = sanitizeName(pageNumber);
      let title = cleanPageNumber;

      const headerElement = dom.window.document.getElementById("Header");
      if (headerElement) {
        const child = headerElement.firstElementChild;
        if (child && child.textContent) {
          title += ` ${sanitizeName(child.textContent)}`;
        }
      }

      const currentFolderPath = folderPath;
      const svgString = rewriteSvgLinksToLocalTargets(
        dom.serialize(),
        currentFolderPath,
        pagePathMap
      );

      const svgPath = join(folderPath, `${cleanPageNumber}.svg`);
      await writeFile(svgPath, svgString);

      const htmlPath = join(folderPath, `${cleanPageNumber}.html`);
      const htmlWrapper = buildWiringHtmlWrapper(title, svgString, currentFolderPath);

      if (options.saveHTML || options.htmlOnly) {
        await writeFile(htmlPath, htmlWrapper);
      }

      if (!options.htmlOnly) {
        await browserPage.setContent(htmlWrapper, { waitUntil: "load" });
        const pdfPath = join(folderPath, `${cleanPageNumber}.pdf`);
        await browserPage.pdf({
          path: pdfPath,
          landscape: true,
        });
      }
    } catch (e: any) {
      if (ignoreSaveErrors) {
        console.error(
          `  Failed to save subpage ${pageNumber} of ${doc.Title}: ${e.message}`
        );
        continue;
      }
      throw e;
    }
  }

  if (options.saveHTML || options.htmlOnly) {
    const subPageLinks = subPages
      .map((pageNumber) => {
        const cleanPageNumber = sanitizeName(pageNumber);
        return `<li><a href="${encodeURI(`${cleanPageNumber}.html`)}" target="_self">Page ${pageNumber}</a></li>`;
      })
      .join("\n");

    const indexHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base href="./" />
  <title>${doc.Title}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 16px; }
    h1 { margin: 0 0 8px; }
    ul { line-height: 1.6; }
  </style>
</head>
<body>
  <h1>${doc.Title}</h1>
  <p>Select a page below.</p>
  <ul>${subPageLinks}</ul>
</body>
</html>`;

    await writeFile(join(folderPath, "index.html"), indexHTML);
  }
}