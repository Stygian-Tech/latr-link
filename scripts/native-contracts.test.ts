import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { generatedNativeFiles, nativeEnvironments, nativeMetadata, nativeProofPlans, writeOrCheckNativeContracts } from "./native-contracts";
import { normalizeBookmarkTags } from "../packages/latr-web-client/src/bookmarkTags";

const fixture = JSON.parse(readFileSync(new URL("../packages/native-contracts/behavior.v1.json", import.meta.url), "utf8"));

describe("native public OAuth metadata", () => {
  it("matches checked-in canonical scopes and proof plans", () => {
    expect(() => writeOrCheckNativeContracts(true)).not.toThrow();
    expect(generatedNativeFiles().size).toBe(5);
  });
  it("uses separate native identities and protocol-compliant callback schemes", () => {
    const ids = new Set<string>();
    const callbacks = new Set<string>();
    for (const environment of nativeEnvironments) {
      for (const platform of ["ios", "android"] as const) {
        const metadata = nativeMetadata(platform, environment);
        const client = new URL(metadata.client_id);
        const redirect = metadata.redirect_uris[0];
        expect(metadata.application_type).toBe("native");
        expect(metadata.token_endpoint_auth_method).toBe("none");
        expect(metadata.dpop_bound_access_tokens).toBe(true);
        expect(redirect).toBe(`${client.hostname.split(".").reverse().join(".")}:/oauth/${platform}`);
        expect(metadata.scope).toContain("include:app.userinput.authFull");
        expect(metadata.scope).toContain("blob:*/*");
        expect(JSON.stringify(metadata)).not.toMatch(/client_secret|api_key|private_key/);
        ids.add(metadata.client_id);
        callbacks.add(redirect);
      }
    }
    expect(ids.size).toBe(4);
    expect(callbacks.size).toBe(4);
  });
});

describe("native gateway compatibility", () => {
  it("keeps PATCH state isolated while the canonical interface is POST", () => {
    const state = nativeProofPlans().find(plan => plan.nsid === "link.latr.bookmarks.setState")!;
    expect(state.method).toBe("PATCH");
    expect(state.canonicalMethod).toBe("POST");
    expect(state.specs).toEqual([
      { xrpcMethod: "com.atproto.repo.getRecord", httpMethod: "GET", count: 2 },
      { xrpcMethod: "com.atproto.repo.applyWrites", httpMethod: "POST", count: 1 },
    ]);
  });
  it("sends migration proofs in the body and uses current bookmark save calls", () => {
    const plans = nativeProofPlans();
    expect(plans.find(plan => plan.nsid.endsWith("migrateLegacy"))!.transport).toBe("body");
    const save = plans.find(plan => plan.nsid.endsWith("saveBookmark"))!;
    expect(save.specs.reduce((sum, spec) => sum + (spec.count ?? 1), 0)).toBe(11);
    expect(save.specs.some(spec => spec.xrpcMethod === "com.atproto.repo.createRecord")).toBe(false);
  });
});

describe("cross-platform bookmark tag fixtures", () => {
  for (const testCase of fixture.tagCases) {
    it(testCase.name, () => {
      if (testCase.error) expect(() => normalizeBookmarkTags(testCase.input)).toThrow();
      else expect(normalizeBookmarkTags(testCase.input)).toEqual(testCase.expected);
    });
  }
  it("enforces grapheme and byte boundaries independently", () => {
    expect(normalizeBookmarkTags(["👨‍👩‍👧‍👦".repeat(25)])).toHaveLength(1);
    expect(() => normalizeBookmarkTags(["👨‍👩‍👧‍👦".repeat(26)])).toThrow();
    expect(normalizeBookmarkTags(["e\u0301".repeat(64)])).toHaveLength(1);
    expect(() => normalizeBookmarkTags(["e\u0301".repeat(65)])).toThrow();
    expect(() => normalizeBookmarkTags(Array.from({ length: 101 }, (_, i) => `tag${i}`))).toThrow();
  });
});
