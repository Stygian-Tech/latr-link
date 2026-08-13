import type { OAuthSession } from "@atproto/oauth-client-browser";
import type {
  CreateDeveloperApiKeyResponse,
  CreateDeveloperClientRequest,
  DeveloperApiKeySummary,
  DeveloperClientSummary,
  DeveloperUsageSummary,
} from "latr-packages/gateway-client";

import { latrGatewayFetch, latrGatewayJson } from "./latrGatewayClient";
import { LATR_XRPC, latrXrpcPath } from "./xrpcMethods";

const managementOptions = { skipClientCredential: true } as const;

type ListDeveloperClientsResponse = { clients: DeveloperClientSummary[] };
type ListDeveloperApiKeysResponse = { keys: DeveloperApiKeySummary[] };
type ListDeveloperUsageResponse = { usage: DeveloperUsageSummary[] };

export async function listDeveloperClients(
  oauthSession: OAuthSession
): Promise<DeveloperClientSummary[]> {
  const body = await latrGatewayJson<ListDeveloperClientsResponse>(
    oauthSession,
    latrXrpcPath(LATR_XRPC.listDeveloperClients),
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
    latrXrpcPath(LATR_XRPC.createDeveloperClient),
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
    latrXrpcPath(LATR_XRPC.deleteDeveloperClient),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId }),
    },
    managementOptions
  );
}

export async function listDeveloperApiKeys(
  oauthSession: OAuthSession,
  clientId: string
): Promise<DeveloperApiKeySummary[]> {
  const body = await latrGatewayJson<ListDeveloperApiKeysResponse>(
    oauthSession,
    `${latrXrpcPath(LATR_XRPC.listDeveloperKeys)}?${new URLSearchParams({ clientId })}`,
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
    latrXrpcPath(LATR_XRPC.createDeveloperKey),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, label }),
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
    latrXrpcPath(LATR_XRPC.revokeDeveloperKey),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, keyId }),
    },
    managementOptions
  );
}

export async function listDeveloperUsage(
  oauthSession: OAuthSession
): Promise<DeveloperUsageSummary[]> {
  const body = await latrGatewayJson<ListDeveloperUsageResponse>(
    oauthSession,
    latrXrpcPath(LATR_XRPC.getDeveloperUsage),
    undefined,
    managementOptions
  );
  return body.usage;
}
