import type { OAuthSession } from "@atproto/oauth-client-browser";
import {
  createUpstreamDpopProof,
  refreshPdsDpopNonce,
  type UpstreamDpopProofOptions,
  type UpstreamProofSpec,
} from "latr-packages/gateway-client";

async function cacheNonce(
  oauthSession: OAuthSession,
  origin: string,
  nonce: string
): Promise<void> {
  try {
    await oauthSession.server.dpopNonces.set(origin, nonce);
  } catch {
    // Ignore cache write failures.
  }
}

async function readCachedNonce(
  oauthSession: OAuthSession,
  origin: string
): Promise<string | undefined> {
  try {
    const cached = await oauthSession.server.dpopNonces.get(origin);
    return cached || undefined;
  } catch {
    return undefined;
  }
}

/** Advance nonce via invalid POST body (400 still rotates DPoP-Nonce). */
async function advanceNonceViaWriteProbe(
  oauthSession: OAuthSession,
  pdsBase: string,
  origin: string,
  xrpcMethod: string
): Promise<string | undefined> {
  const response = await oauthSession.fetchHandler(`${pdsBase}/xrpc/${xrpcMethod}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const headerNonce =
    response.headers.get("DPoP-Nonce") ?? response.headers.get("dpop-nonce") ?? undefined;
  if (headerNonce) {
    await cacheNonce(oauthSession, origin, headerNonce);
    return headerNonce;
  }
  return readCachedNonce(oauthSession, origin);
}

/**
 * Mint a comma-separated upstream proof pool while chaining PDS nonces.
 * After the first refresh, subsequent proofs advance via write probes only
 * (avoids a listRecords round-trip per proof when reads omit DPoP-Nonce).
 */
export async function createChainedUpstreamDpopProofPool(
  oauthSession: OAuthSession,
  specs: UpstreamProofSpec[],
  options: UpstreamDpopProofOptions = {}
): Promise<string> {
  const tokenInfo = await oauthSession.getTokenInfo();
  const pdsBase = tokenInfo.aud.replace(/\/$/, "");
  const origin = new URL(`${pdsBase}/`).origin;

  const proofs: string[] = [];
  let seeded = Boolean(options.pdsDpopNonce);

  for (const spec of specs) {
    const count = spec.count ?? 1;
    for (let index = 0; index < count; index += 1) {
      let pdsDpopNonce = options.pdsDpopNonce;
      if (!pdsDpopNonce) {
        if (!seeded) {
          pdsDpopNonce = await refreshPdsDpopNonce(
            oauthSession,
            spec.xrpcMethod,
            spec.httpMethod
          );
          seeded = true;
        } else {
          const probeMethod =
            spec.httpMethod === "GET"
              ? "com.atproto.repo.createRecord"
              : spec.xrpcMethod;
          pdsDpopNonce = await advanceNonceViaWriteProbe(
            oauthSession,
            pdsBase,
            origin,
            probeMethod
          );
        }
      } else {
        seeded = true;
        options = { ...options, pdsDpopNonce: undefined };
      }

      if (!pdsDpopNonce) {
        throw new Error("PDS DPoP nonce unavailable after priming; retry the request");
      }

      proofs.push(
        await createUpstreamDpopProof(oauthSession, spec.xrpcMethod, spec.httpMethod, {
          ...options,
          pdsDpopNonce,
        })
      );
    }
  }

  return proofs.join(",");
}
