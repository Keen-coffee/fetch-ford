import { WiringFetchPageParams } from "./savePage";
import { WiringTableOfContentsEntry } from "./fetchTableOfContents";
import { Page } from "playwright";
import fetchConnectorList from "./fetchConnectorList";
import { sanitizeName } from "../utils";
import { join } from "path";
import { writeFile } from "fs/promises";
import { WiringSaveOptions } from "./savePage";

export default async function saveConnector(
  params: WiringFetchPageParams,
  doc: WiringTableOfContentsEntry & { Type: "Connectors" },
  browserPage: Page,
  folderPath: string,
  options: WiringSaveOptions = {}
): Promise<void> {
  const connectors = await fetchConnectorList(params);
  const indexEntries: Array<{ title: string; htmlName: string }> = [];

  await writeFile(
    join(folderPath, "connectors.json"),
    JSON.stringify(connectors, null, 2)
  );

  for (const connector of connectors) {
    console.log(`Saving connector ${connector.Desc} (${connector.Name})...`);

    let title = `${sanitizeName(connector.Desc)} - ${connector.Name}`;
    if (title.length > 200) {
      title = `${title.slice(0, 150)} (truncated) - ${connector.Name}`;
    }
    const path = join(folderPath, `${title}.pdf`);

    const url = new URL(
      "https://www.fordtechservice.dealerconnection.com/wiring/face/"
    );
    url.searchParams.set("book", params.book);
    url.searchParams.set("vehicleId", params.vehicleId);
    url.searchParams.set("cell", doc.Number);
    url.searchParams.set("item", connector.FaceView);
    url.searchParams.set("bookType", params.bookType);
    url.searchParams.set("languageCode", params.languageCode);

    try {
      await browserPage.goto(url.toString(), { waitUntil: "domcontentloaded" });
      await browserPage.waitForSelector("table.pintable");
    } catch (e) {
      console.error(
        `Error loading connector ${connector.Desc} (${connector.Name}), skipping...`
      );
      await browserPage.waitForTimeout(500);
      continue;
    }

    // wait up to 150ms for the page to finish loading.
    // if the timeout is hit, Playwright throws an error
    // which doesn't matter here.
    try {
      await browserPage.waitForLoadState("networkidle", { timeout: 150 });
    } catch {
      // pass
    }

    // Click the "Terminal Part" button if it exists
    await browserPage.evaluate(
      'document.getElementById("TerminalPartBtn")?.click()'
    );

    const html = await browserPage.content();

    if (options.saveHTML || options.htmlOnly) {
      const htmlPath = join(folderPath, `${title}.html`);
      await writeFile(htmlPath, html);
      indexEntries.push({ title, htmlName: `${title}.html` });
    }

    if (!options.htmlOnly) {
      await browserPage.pdf({
        path: path,
        landscape: true,
      });
    }
  }

  if (options.saveHTML || options.htmlOnly) {
    const listItems = indexEntries
      .map(
        (entry) =>
          `<li><a href="${encodeURI(entry.htmlName)}" target="_self">${entry.title}</a></li>`
      )
      .join("\n");

    const indexHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base href="./" />
  <title>Connector Views</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 16px; }
    h1 { margin: 0 0 8px; }
    ul { line-height: 1.6; }
  </style>
</head>
<body>
  <h1>Connector Views</h1>
  <p>Select a connector below.</p>
  <ul>${listItems}</ul>
</body>
</html>`;

    await writeFile(join(folderPath, "index.html"), indexHTML);
  }
}
