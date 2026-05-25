import { describe, expect, test } from "bun:test";

import { AT_PROTO_OAUTH_SCOPES } from "@/lib/atprotoOAuthScopes";
import {
  buildWebOAuthClientMetadata,
  hostedOAuthClientIdForOrigin,
  resolveHostedOAuthClientId,
} from "@/lib/oauthClientMetadata";

describe("buildWebOAuthClientMetadata", () => {
  test("uses the request origin for client_id and redirect_uris", () => {
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
  });
});

describe("hostedOAuthClientIdForOrigin", () => {
  test("uses same-origin metadata for preview hosts", () => {
    expect(
      hostedOAuthClientIdForOrigin("https://preview.example.vercel.app")
    ).toBe("https://preview.example.vercel.app/client-metadata.json");
  });

  test("uses same-origin metadata for testing.latr.link", () => {
    expect(hostedOAuthClientIdForOrigin("https://testing.latr.link")).toBe(
      "https://testing.latr.link/client-metadata.json"
    );
  });
});

describe("resolveHostedOAuthClientId", () => {
  test("uses same-origin metadata on preview hosts instead of prod default", () => {
    expect(
      resolveHostedOAuthClientId("https://testing-latr-link.vercel.app")
    ).toBe("https://testing-latr-link.vercel.app/client-metadata.json");
  });

  test("honors NEXT_PUBLIC_ATPROTO_CLIENT_ID on unmapped preview hosts", () => {
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

  test("ignores prod default NEXT_PUBLIC_ATPROTO_CLIENT_ID on preview hosts", () => {
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
