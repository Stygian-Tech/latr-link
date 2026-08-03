/** Matches gateway `normalizeClientID` (lowercase slug for `X-Latr-Client-Id`). */
export const GATEWAY_CLIENT_ID_PATTERN = /^[a-z][a-z0-9_-]{0,62}$/;

export function normalizeGatewayClientId(raw: string): string {
  const clientId = raw.trim().toLowerCase();
  if (!clientId) {
    throw new Error("Client ID is required.");
  }
  if (!GATEWAY_CLIENT_ID_PATTERN.test(clientId)) {
    throw new Error(
      "Client ID must start with a letter and contain only lowercase letters, digits, hyphens, and underscores."
    );
  }
  return clientId;
}
