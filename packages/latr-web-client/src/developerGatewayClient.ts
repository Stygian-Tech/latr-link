import type { OAuthSession } from "@atproto/oauth-client-browser";
import type {
  CreateDeveloperApiKeyResponse,
  CreateDeveloperClientRequest,
  DeveloperApiKeySummary,
  DeveloperClientSummary,
  DeveloperUsageSummary,
} from "latr-packages/gateway-client";

import { latrGatewayFetch, latrGatewayJson } from "./latrGatewayClient";

const managementOptions = { skipClientCredential: true } as const;

type ListDeveloperClientsResponse = { clients: DeveloperClientSummary[] };
type ListDeveloperApiKeysResponse = { keys: DeveloperApiKeySummary[] };
type ListDeveloperUsageResponse = { usage: DeveloperUsageSummary[] };

export async function listDeveloperClients(
  oauthSession: OAuthSession
): Promise<DeveloperClientSummary[]> {
  const body = await latrGatewayJson<ListDeveloperClientsResponse>(
    oauthSession,
    "/v1/latr/developer/clients",
    undefined,
    managementOptions
  );
  return body.clients;
}

export async function createDeveloperClient(
  oauthSession: OAuthSession,
  request: CreateDeveloperClientRequest
): Promise<DeveloperClientSummary> {
  return latrGatewayJson<DeveloperClientSummary>(
    oauthSession,
    "/v1/latr/developer/clients",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    managementOptions
  );
}

export async function deleteDeveloperClient(
  oauthSession: OAuthSession,
  clientId: string
): Promise<void> {
  await latrGatewayFetch(
    oauthSession,
    `/v1/latr/developer/clients/${encodeURIComponent(clientId)}`,
    { method: "DELETE" },
    managementOptions
  );
}

export async function listDeveloperApiKeys(
  oauthSession: OAuthSession,
  clientId: string
): Promise<DeveloperApiKeySummary[]> {
  const body = await latrGatewayJson<ListDeveloperApiKeysResponse>(
    oauthSession,
    `/v1/latr/developer/clients/${encodeURIComponent(clientId)}/keys`,
    undefined,
    managementOptions
  );
  return body.keys;
}

export async function createDeveloperApiKey(
  oauthSession: OAuthSession,
  clientId: string,
  label?: string
): Promise<CreateDeveloperApiKeyResponse> {
  return latrGatewayJson<CreateDeveloperApiKeyResponse>(
    oauthSession,
    `/v1/latr/developer/clients/${encodeURIComponent(clientId)}/keys`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    },
    managementOptions
  );
}

export async function revokeDeveloperApiKey(
  oauthSession: OAuthSession,
  clientId: string,
  keyId: string
): Promise<void> {
  await latrGatewayFetch(
    oauthSession,
    `/v1/latr/developer/clients/${encodeURIComponent(clientId)}/keys/${encodeURIComponent(keyId)}`,
    { method: "DELETE" },
    managementOptions
  );
}

export async function listDeveloperUsage(
  oauthSession: OAuthSession
): Promise<DeveloperUsageSummary[]> {
  const body = await latrGatewayJson<ListDeveloperUsageResponse>(
    oauthSession,
    "/v1/latr/developer/usage",
    undefined,
    managementOptions
  );
  return body.usage;
}
