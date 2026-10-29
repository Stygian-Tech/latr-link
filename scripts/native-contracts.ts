import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { LATR_XRPC, bookmarkUpstreamProofPlanForGatewayRequest, latrXrpcPath } from "latr-packages/gateway-client";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webMetadata = JSON.parse(readFileSync(resolve(root, "apps/web/public/client-metadata.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
export const nativeEnvironments = [
  { name: "development", origin: "https://testing.latr.link", suffix: "-testing", scheme: "link.latr.testing", applicationId: "link.latr.development" },
  { name: "production", origin: "https://latr.link", suffix: "", scheme: "link.latr", applicationId: "link.latr" },
] as const;

export function nativeMetadata(platform: "ios" | "android", environment: typeof nativeEnvironments[number]) {
  return {
    client_id: `${environment.origin}/oauth/${platform}${environment.suffix}-client-metadata.json`,
    application_type: "native",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    redirect_uris: [`${environment.scheme}:/oauth/${platform}`],
    scope: webMetadata.scope,
    token_endpoint_auth_method: "none",
    dpop_bound_access_tokens: true,
    client_name: `L@tr.link ${platform === "ios" ? "iOS" : "Android"}${environment.name === "development" ? " Development" : ""}`,
    client_uri: environment.origin,
    logo_uri: `${environment.origin}/icon.png`,
  };
}

export function nativeProofPlans() {
  return Object.values(LATR_XRPC)
    .filter(({ nsid }) => nsid.startsWith("link.latr.bookmarks."))
    .map(descriptor => {
      // LTR-19: the deployed gateway still accepts PATCH for this procedure.
      const method = descriptor.nsid === "link.latr.bookmarks.setState" ? "PATCH" : descriptor.method;
      const path = latrXrpcPath(descriptor);
      const plan = bookmarkUpstreamProofPlanForGatewayRequest(method, path);
      if (!plan) throw new Error(`Missing proof plan: ${method} ${path}`);
      return { nsid: descriptor.nsid, canonicalMethod: descriptor.method, method, path, ...plan };
    });
}

export function generatedNativeFiles() {
  const files = new Map<string, unknown>();
  for (const environment of nativeEnvironments) {
    for (const platform of ["ios", "android"] as const) {
      files.set(`apps/web/public/oauth/${platform}${environment.suffix}-client-metadata.json`, nativeMetadata(platform, environment));
    }
  }
  files.set("packages/native-contracts/contracts.v1.json", {
    version: 1,
    source: manifest.dependencies["latr-packages"],
    scope: webMetadata.scope,
    environments: nativeEnvironments.map(environment => ({
      name: environment.name, applicationId: environment.applicationId,
      proxyBase: `${environment.origin}/api/latr-gateway`,
      ios: nativeMetadata("ios", environment), android: nativeMetadata("android", environment),
    })),
    proofPlans: nativeProofPlans(),
  });
  return files;
}

export function writeOrCheckNativeContracts(check: boolean) {
  const mismatches: string[] = [];
  for (const [relative, value] of generatedNativeFiles()) {
    const path = resolve(root, relative);
    const content = JSON.stringify(value, null, 2) + "\n";
    if (check) {
      let actual: string | undefined;
      try { actual = readFileSync(path, "utf8"); } catch { /* Report missing file as drift. */ }
      if (actual !== content) mismatches.push(relative);
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
  }
  if (mismatches.length) throw new Error(`Native contract drift; run bun scripts/native-contracts.ts:\n${mismatches.join("\n")}`);
}

if (import.meta.main) {
  writeOrCheckNativeContracts(process.argv.includes("--check"));
  console.log(process.argv.includes("--check") ? "Native contracts and metadata match canonical sources." : "Generated native contracts and OAuth metadata.");
}
