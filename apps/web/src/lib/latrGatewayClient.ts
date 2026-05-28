import {
  latrGatewayFetch as sharedLatrGatewayFetch,
  latrGatewayJson as sharedLatrGatewayJson,
} from "latr-web-client/latrGatewayClient";

import {
  latrGatewayBaseUrl,
  syncLatrGatewayFromBrowser,
} from "@/lib/latrGatewayUrl";

export {
  LATR_OFFICIAL_CLIENT_HEADER,
  LATR_UPSTREAM_DPOP_HEADER,
} from "latr-web-client/latrGatewayClient";

export { latrGatewayBaseUrl };

syncLatrGatewayFromBrowser();

export async function latrGatewayFetch(
  ...args: Parameters<typeof sharedLatrGatewayFetch>
): Promise<Response> {
  syncLatrGatewayFromBrowser();
  return sharedLatrGatewayFetch(...args);
}

export async function latrGatewayJson<T>(
  ...args: Parameters<typeof sharedLatrGatewayJson>
): Promise<T> {
  syncLatrGatewayFromBrowser();
  return sharedLatrGatewayJson<T>(...args);
}
