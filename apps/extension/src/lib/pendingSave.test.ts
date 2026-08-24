import { describe, expect, test } from "bun:test";

import { PENDING_SAVE_TTL_MS, parsePendingSave } from "./pendingSave";

describe("Pending Quick Save", () => {
  const now = 10_000_000;

  test("Accepts a current supported URL", () => {
    expect(
      parsePendingSave(
        { version: 1, url: " https://example.com/article ", requestedAt: now - 1 },
        now
      )
    ).toEqual({
      version: 2,
      url: "https://example.com/article",
      tags: [],
      requestedAt: now - 1,
    });
  });

  test("Preserves canonical tags across OAuth continuation", () => {
    expect(
      parsePendingSave(
        {
          version: 2,
          url: "https://example.com/article",
          tags: ["  funny videos ", "Work", "Work"],
          requestedAt: now - 1,
        },
        now
      )
    ).toEqual({
      version: 2,
      url: "https://example.com/article",
      tags: ["funny videos", "Work"],
      requestedAt: now - 1,
    });
  });

  test("Rejects expired, future, malformed, and unsupported values", () => {
    expect(
      parsePendingSave(
        {
          version: 1,
          url: "https://example.com",
          requestedAt: now - PENDING_SAVE_TTL_MS - 1,
        },
        now
      )
    ).toBeNull();
    expect(
      parsePendingSave(
        { version: 1, url: "https://example.com", requestedAt: now + 1 },
        now
      )
    ).toBeNull();
    expect(parsePendingSave({ version: 2 }, now)).toBeNull();
    expect(
      parsePendingSave(
        {
          version: 2,
          url: "https://example.com",
          tags: ["a".repeat(65)],
          requestedAt: now,
        },
        now
      )
    ).toBeNull();
    expect(
      parsePendingSave(
        { version: 1, url: "about:config", requestedAt: now },
        now
      )
    ).toBeNull();
  });
});
