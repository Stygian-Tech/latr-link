import type { OAuthSession } from "@atproto/oauth-client-browser";
import {
  createUpstreamDpopProof,
  refreshPdsDpopNonce,
  type UpstreamDpopProofOptions,
  type UpstreamProofSpec,
} from "latr-packages/gateway-client";

/**
 * Mint distinct, request-bound proofs using one freshly obtained PDS nonce.
 * Server nonces can cover multiple requests; each proof's jti must be unique.
 * Refreshing between proofs adds a network round trip per unused pool slot and
 * does not improve freshness when all proofs are sent together to the gateway.
 * https://atproto.com/specs/oauth#demonstrating-proof-of-possession-dpop
 */
export async function createChainedUpstreamDpopProofPool(
  oauthSession: OAuthSession,
  specs: UpstreamProofSpec[],
  options: UpstreamDpopProofOptions = {}
): Promise<string> {
  const first = specs.find((spec) => (spec.count ?? 1) > 0);
  if (!first) return "";

  const pdsDpopNonce = options.pdsDpopNonce ?? await refreshPdsDpopNonce(
    oauthSession,
    first.xrpcMethod,
    first.httpMethod
  );
  if (!pdsDpopNonce) {
    throw new Error("PDS DPoP nonce unavailable after priming; retry the request");
  }

  const proofs: string[] = [];
  for (const spec of specs) {
    for (let index = 0; index < (spec.count ?? 1); index += 1) {
      proofs.push(await createUpstreamDpopProof(
        oauthSession,
        spec.xrpcMethod,
        spec.httpMethod,
        { ...options, pdsDpopNonce }
      ));
    }
  }
  return proofs.join(",");
}
