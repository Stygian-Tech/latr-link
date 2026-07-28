import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AT_PROTO_OAUTH_SCOPES } from "@/lib/atprotoOAuthScopes";
import {
  buildWebOAuthClientMetadata,
  gatewayWebOAuthClientMetadataUrl,
  hostedOAuthClientIdForOrigin,
  resolveHostedOAuthClientId,
} from "@/lib/oauthClientMetadata";

describe("Buildweboauthclientmetadata", () => {
  test("Uses the Request Origin for Client_id and Redirect_uris", () => {
    const metadata = buildWebOAuthClientMetadata(
      "https://preview.example.vercel.app"
    );
    expect(metadata.client_id).toBe(
      "https://preview.example.vercel.app/client-metadata.json"
    );
    expect(metadata.redirect_uris).toEqual([
      "https://preview.example.vercel.app/callback",
    ]);
    expect(metadata.scope).toBe(AT_PROTO_OAUTH_SCOPES);
    expect(metadata.logo_uri).toBe(
      "https://preview.example.vercel.app/icon.png"
    );
  });
});

describe("static OAuth client metadata", () => {
  test("keeps web and extension documents on the shared minimal scopes", () => {
    const web = JSON.parse(
      readFileSync(
        resolve(import.meta.dir, "../../public/client-metadata.json"),
        "utf8"
      )
    ) as { scope: string; logo_uri: string };
    const extension = JSON.parse(
      readFileSync(
        resolve(import.meta.dir, "../../public/extension/client-metadata.json"),
        "utf8"
      )
    ) as { scope: string; logo_uri: string };

    expect(web.scope).toBe(AT_PROTO_OAUTH_SCOPES);
    expect(extension.scope).toBe(AT_PROTO_OAUTH_SCOPES);
    expect(web.logo_uri).toBe("https://latr.link/icon.png");
    expect(extension.logo_uri).toBe("https://latr.link/icon.png");
  });
});

describe("Hostedoauthclientidfororigin", () => {
  test("Uses Same-origin Metadata for Unmapped Preview Hosts", () => {
    expect(
      hostedOAuthClientIdForOrigin("https://preview.example.vercel.app")
    ).toBe("https://preview.example.vercel.app/client-metadata.json");
  });

  test("Uses Testing API Gateway Metadata for Testing.latr.link", () => {
    expect(hostedOAuthClientIdForOrigin("https://testing.latr.link")).toBe(
      "https://api.testing.latr.link/oauth/client-metadata.json"
    );
  });
});

describe("Resolvehostedoauthclientid", () => {
  test("Uses Same-origin Metadata on Preview Hosts instead of Prod Default", () => {
    expect(
      resolveHostedOAuthClientId("https://testing-latr-link.vercel.app")
    ).toBe("https://testing-latr-link.vercel.app/client-metadata.json");
  });

  test("Uses Gateway Metadata for Deployment-protected Testing Host", () => {
    expect(resolveHostedOAuthClientId("https://testing.latr.link")).toBe(
      "https://api.testing.latr.link/oauth/client-metadata.json"
    );
  });

  test("Honors NEXT_PUBLIC_ATPROTO_CLIENT_ID on Unmapped Preview Hosts", () => {
    const prevClientId = process.env.NEXT_PUBLIC_ATPROTO_CLIENT_ID;
    process.env.NEXT_PUBLIC_ATPROTO_CLIENT_ID =
      "https://custom.example/client-metadata.json";
    try {
      expect(
        resolveHostedOAuthClientId("https://preview.example.vercel.app")
      ).toBe("https://custom.example/client-metadata.json");
    } finally {
      if (prevClientId === undefined) {
        delete process.env.NEXT_PUBLIC_ATPROTO_CLIENT_ID;
      } else {
        process.env.NEXT_PUBLIC_ATPROTO_CLIENT_ID = prevClientId;
      }
    }
  });

  test("Ignores Prod Default NEXT_PUBLIC_ATPROTO_CLIENT_ID on Preview Hosts", () => {
    const prevClientId = process.env.NEXT_PUBLIC_ATPROTO_CLIENT_ID;
    process.env.NEXT_PUBLIC_ATPROTO_CLIENT_ID =
      "https://latr.link/client-metadata.json";
    try {
      expect(
        resolveHostedOAuthClientId("https://preview.example.vercel.app")
      ).toBe("https://preview.example.vercel.app/client-metadata.json");
    } finally {
      if (prevClientId === undefined) {
        delete process.env.NEXT_PUBLIC_ATPROTO_CLIENT_ID;
      } else {
        process.env.NEXT_PUBLIC_ATPROTO_CLIENT_ID = prevClientId;
      }
    }
  });
});

describe("Gatewayweboauthclientmetadataurl", () => {
  test("Builds the Gateway Discoverable Client_id URL", () => {
    expect(
      gatewayWebOAuthClientMetadataUrl("https://latr-link-dev-gateway.fly.dev")
    ).toBe(
      "https://latr-link-dev-gateway.fly.dev/oauth/client-metadata.json"
    );
  });
});
