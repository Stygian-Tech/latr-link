import { describe, expect, test } from "bun:test";

import { GET } from "@/app/api/oauth/web-client-metadata/route";

describe("GET /api/oauth/web-client-metadata", () => {
  test("returns metadata for the forwarded host", async () => {
    const request = new Request(
      "https://internal/api/oauth/web-client-metadata",
      {
        headers: {
          "x-forwarded-host": "testing.latr.link",
          "x-forwarded-proto": "https",
        },
      }
    );

    const res = GET(request);
    const body = await res.json();
    expect(body.client_id).toBe(
      "https://testing.latr.link/client-metadata.json"
    );
    expect(body.redirect_uris).toEqual(["https://testing.latr.link/callback"]);
  });
});
