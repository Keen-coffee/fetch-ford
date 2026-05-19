import client from "../client";
import { stringify } from "qs";

export interface FetchManualPageParams {
  environment: string;
  category: string;
  CategoryDescription: string;
  treeBookPath?: string;

  vehicleId: string;
  modelYear: string;
  channel: string;
  vin?: string;
  book: string;
  bookTitle: string;
  booktype: string;
  country: string;
  language: string;
  contentmarket: string;
  contentlanguage: string;
  languageOdysseyCode: string;
  contentgroup?: string;
  WiringFormat?: string;
  fromPageBase?: string;
  strVehLine?: string;
  strProdType?: string;

  usertype?: string;
  userQsPilot?: string;
  adt?: string;
  diagTool?: string;
  otx?: string;
  adtLocation?: string;

  Vid: string;
  byvin: string;
  marketGroup: string;
  WiringBookCode: string;
  WiringBookTitle: string;
  primaryFeatureCodes?: string[];
  minorFeatureCodes?: string[];
}

export interface ManualProcedureRequest {
  environment: string;
  payload: Record<string, string | string[]>;
}

export default async function fetchManualPage(
  request: ManualProcedureRequest
): Promise<string> {
  const req = await client({
    method: "POST",
    url: "https://www.fordservicecontent.com/Ford_Content/PublicationRuntimeRefreshPTS//publication/Proc",
    params: {
      environment: request.environment,
    },
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    data: stringify(request.payload, {
      arrayFormat: "brackets",
    }),
  });

  return req.data;
  // returns HTML
}
