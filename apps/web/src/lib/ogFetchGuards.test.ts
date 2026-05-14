import { describe, expect, test } from "bun:test";

import { blockingReasonOgFetch } from "./ogFetchGuards";

describe("blockingReasonOgFetch", () => {
  test("allows public hosts", () => {
    expect(blockingReasonOgFetch("example.com")).toBeUndefined();
    expect(blockingReasonOgFetch("news.example.co.uk")).toBeUndefined();
  });

  test("blocks localhost-ish", () => {
    expect(blockingReasonOgFetch("localhost")).toBe("blocked_host");
    expect(blockingReasonOgFetch("LocalHost")).toBe("blocked_host");
    expect(blockingReasonOgFetch("printer.local")).toBe("blocked_host");
    expect(blockingReasonOgFetch("staging.localhost")).toBe("blocked_host");
    expect(blockingReasonOgFetch("broadcasthost")).toBe("blocked_host");
  });

  test("blocks private ipv4 literals", () => {
    expect(blockingReasonOgFetch("127.5.6.7")).toBe("blocked_ipv4");
    expect(blockingReasonOgFetch("10.0.0.5")).toBe("blocked_ipv4");
    expect(blockingReasonOgFetch("192.168.0.12")).toBe("blocked_ipv4");
    expect(blockingReasonOgFetch("172.20.0.1")).toBe("blocked_ipv4");
    expect(blockingReasonOgFetch("169.254.169.254")).toBe("blocked_ipv4");
    expect(blockingReasonOgFetch("0.0.0.0")).toBe("blocked_ipv4");
  });

  test("allows public ipv4", () => {
    expect(blockingReasonOgFetch("8.8.8.8")).toBeUndefined();
  });

  test("blocks common ipv6 scopes", () => {
    expect(blockingReasonOgFetch("fc00::1")).toBe("blocked_ipv6_scope");
    expect(blockingReasonOgFetch("FD00::1")).toBe("blocked_ipv6_scope");
    expect(blockingReasonOgFetch("FE80::1")).toBe("blocked_ipv6_scope");
  });

  test("blocks ipv6 loopback shorthand", () => {
    expect(blockingReasonOgFetch("::1")).toBe("blocked_host");
  });
});
