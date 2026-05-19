import { readFile } from "fs/promises";
import { fileExists } from "./utils";
import { join } from "path";
import type { FetchManualPageParams } from "./workshop/fetchManualPage";

export interface Config {
  workshop: FetchManualPageParams;
  wiring: {
    environment: string;
    bookType: string;
    languageCode: string;
  };
  pre_2003: {
    alphabeticalIndexURL: string;
  };
}

const WORKSHOP_VALIDATE_FIELDS: (keyof Config["workshop"])[] = [
  "environment",
  "category",
  "CategoryDescription",
  "vehicleId",
  "modelYear",
  "book",
  "bookTitle",
  "WiringBookCode",
  "WiringBookTitle",
];

// These values are often legitimately stable across many vehicles/manuals.
const WORKSHOP_FIELDS_ALLOWED_TO_MATCH_TEMPLATE: (keyof Config["workshop"])[] = [
  "category",
  "CategoryDescription",
];

const WIRING_VALIDATABLE_FIELDS: (keyof Config["wiring"])[] = ["environment"];

export default async function readConfig(
  path: string,
  validate: boolean
): Promise<Config> {
  const fileContent = await readFile(path, { encoding: "utf-8" });
  const params = JSON.parse(fileContent) as Partial<Config>;

  if (!validate) return params as Config;

  let paramsValid = true;

  const templatePath = join("templates", "params.json.template");
  const templateExists = await fileExists(templatePath);

  if (!templateExists) {
    console.error(
      `Your params.json file couldn't be validated because the template file couldn't be found at ${templatePath}.`
    );
    return params as Config;
  }

  const templateContent = await readFile(templatePath, { encoding: "utf-8" });
  const template = JSON.parse(templateContent) as Config;

  const ws = params.workshop || ({} as Config["workshop"]);
  const tws = template.workshop;

  if (!params.workshop) {
    console.error("Missing field workshop in config");
    paramsValid = false;
  }

  for (const param of WORKSHOP_VALIDATE_FIELDS) {
    if (!ws[param] || typeof ws[param] !== typeof tws[param]) {
      console.error(`Invalid or missing field ${param} in workshop config`);
      paramsValid = false;
    }

    if (
      ws[param] === tws[param] &&
      !WORKSHOP_FIELDS_ALLOWED_TO_MATCH_TEMPLATE.includes(param)
    ) {
      console.error(
        `Field ${param} in workshop config (${ws[param]}) is the same as the template (${tws[param]})`
      );
      paramsValid = false;
    }
  }

  const w = params.wiring || ({} as Config["wiring"]);
  const tw = template.wiring;

  if (!params.wiring) {
    console.error("Missing field wiring in config");
    paramsValid = false;
  }

  for (const param of WIRING_VALIDATABLE_FIELDS) {
    if (!w[param] || typeof w[param] !== typeof tw[param]) {
      console.error(`Invalid or missing field ${param} in wiring config`);
      paramsValid = false;
    }

    if (w[param] === tw[param]) {
      console.error(
        `Field ${param} in wiring config (${w[param]}) is the same as the template (${tw[param]})`
      );
      paramsValid = false;
    }
  }

  if (
    ws.modelYear &&
    parseInt(ws.modelYear) < 2003 &&
    params.pre_2003?.alphabeticalIndexURL ===
      template.pre_2003.alphabeticalIndexURL
  ) {
    console.error(
      "Please set the URL for the pre-2003 alphabetical index in the config file."
    );
    paramsValid = false;
  }

  if (!paramsValid) {
    console.error(
      "\nErrors were found in your config file. Please fix them and try again.\n" +
        "If you're sure your config is correct, disable config validation with the --noParamsValidation flag."
    );
    process.exit(1);
  }

  return params as Config;
}
