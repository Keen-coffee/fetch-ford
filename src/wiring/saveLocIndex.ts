import { WiringFetchPageParams } from "./savePage";
import { WiringTableOfContentsEntry } from "./fetchTableOfContents";
import { Page } from "playwright";
import fetchLocIndexComponentType, {
  CONNECTOR_LOC_INDEX_TYPES,
  LocIndexComponentType,
} from "./fetchLocIndexComponentType";
import { join } from "path";
import { createWriteStream } from "fs";
import { writeFile } from "fs/promises";

const csvHeader = [
  // From
  "Connector ID",
  // Item + Qual
  "Connector",
  // Page
  "Connector Location Views Page Number",
  // GridRef
  "Grid Reference",
  // LocationDesc
  "Location in Vehicle",
].join(",");

export async function saveLocIndex(
  params: WiringFetchPageParams,
  doc: WiringTableOfContentsEntry & { Type: "LocIndex" },
  folderPath: string
): Promise<void> {
  console.log(
    "Saving Connectors.csv, which tells you which diagram to find which connector..."
  );

  const csvPath = join(folderPath, "Connectors.csv");
  const writeStream = createWriteStream(csvPath, { encoding: "utf-8" });
  writeStream.write(csvHeader + "\n");

  for (const connectorType of CONNECTOR_LOC_INDEX_TYPES) {
    let entries: LocIndexComponentType[];
    try {
      entries = await fetchLocIndexComponentType({
        ...params,
        cell: doc.Number,
        componentType: connectorType,
      });
    } catch (e: any) {
      console.log(
        `Error fetching ${connectorType} for cell ${doc.Number} (it may not exist): ${e}`
      );
      console.log(e);
      continue;
    }

    for (const entry of entries) {
      writeStream.write(
        [
          entry.From || "",
          `"${entry.Item}${entry.Qual ? ` (${entry.Qual})` : ""}"`,
          entry.Page || "",
          entry.GridRef || "",
          entry.LocationDesc ? `"${entry.LocationDesc}"` : "",
        ].join(",") + "\n"
      );
    }
  }

  writeStream.end();

  const indexHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base href="./" />
  <title>Connector Location Index</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 16px; }
    h1 { margin: 0 0 8px; }
    ul { line-height: 1.6; }
  </style>
</head>
<body>
  <h1>Connector Location Index</h1>
  <p>Open the generated data files below.</p>
  <ul>
    <li><a href="Connectors.csv" target="_self">Connectors.csv</a></li>
  </ul>
</body>
</html>`;

  await writeFile(join(folderPath, "index.html"), indexHTML);
}
