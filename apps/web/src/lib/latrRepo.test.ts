import { describe, expect, test } from "bun:test";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { LatrRepo } from "./latrRepo";

function mockOAuthSession(
  handler: (url: string, init?: RequestInit) => Promise<Response>
): OAuthSession {
  return {
    fetchHandler: handler,
  } as unknown as OAuthSession;
}

describe("LatrRepo gateway facade", () => {
  test("listSavedItems calls GET /v1/latr/saves", async () => {
    const calls: string[] = [];
    const oauth = mockOAuthSession(async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(
        JSON.stringify({
          records: [
            {
              uri: "at://did/item/com.latr.saved.item/rkey",
              cid: "bafy",
              value: {
                $type: "com.latr.saved.item",
                subjectUri: "at://did/ext/com.latr.saved.external/x",
                savedAt: "2026-01-01T00:00:00.000Z",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const repo = new LatrRepo(oauth, "did:plc:viewer");
    const items = await repo.listSavedItems();
    expect(items).toHaveLength(1);
    expect(calls[0]).toContain("/v1/latr/saves");
  });

  test("saveExternalUrl POSTs url body", async () => {
    let body = "";
    const oauth = mockOAuthSession(async (_url, init) => {
      body = String(init?.body ?? "");
      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    });

    const repo = new LatrRepo(oauth, "did:plc:viewer");
    await repo.saveExternalUrl("https://example.com/a");
    expect(JSON.parse(body)).toEqual({
      kind: "url",
      url: "https://example.com/a",
    });
  });

  test("setItemState PATCHes state route", async () => {
    let path = "";
    const oauth = mockOAuthSession(async (url) => {
      path = url;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const repo = new LatrRepo(oauth, "did:plc:viewer");
    await repo.setItemState("abc123", "archived");
    expect(path).toContain("/v1/latr/saves/abc123/state");
  });

  test("unsave DELETEs item route", async () => {
    let method = "";
    const oauth = mockOAuthSession(async (_url, init) => {
      method = init?.method ?? "";
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const repo = new LatrRepo(oauth, "did:plc:viewer");
    await repo.unsave("item-rkey");
    expect(method).toBe("DELETE");
  });
});

describe("latrGatewayBaseUrl", () => {
  test("defaults to local gateway", async () => {
    const prev = process.env.NEXT_PUBLIC_LATR_GATEWAY_URL;
    delete process.env.NEXT_PUBLIC_LATR_GATEWAY_URL;
    const { latrGatewayBaseUrl } = await import("./latrGatewayClient");
    expect(latrGatewayBaseUrl()).toBe("http://127.0.0.1:8080");
    if (prev) process.env.NEXT_PUBLIC_LATR_GATEWAY_URL = prev;
  });
});
