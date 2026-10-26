import { afterEach, describe, expect, test } from "bun:test";
import { readDocumentPreview, shortenPageUrl } from "./pagePreview";

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
afterEach(() => {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

describe("Local page previews", () => {
  test("Shortens URLs without exposing query strings, fragments or credentials", () => {
    expect(shortenPageUrl("https://user:pass@example.com/article?token=secret#state")).toBe("example.com/article");
    expect(shortenPageUrl("https://example.com/")).toBe("example.com");
    expect(shortenPageUrl(`https://example.com/${"a".repeat(100)}`)).toHaveLength(62);
    expect(shortenPageUrl("bad url")).toBe("No page selected");
  });

  test("Reads authored OpenGraph metadata directly from the document", () => {
    const metadata: Record<string, string> = { "og:title": "Article title", "og:description": "A short description", "og:site_name": "Publication" };
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      title: "Fallback title",
      querySelector: (selector: string) => {
        const key = selector.match(/property="([^"]+)"/)?.[1] ?? "";
        return metadata[key] ? { content: metadata[key] } : null;
      },
    } });
    expect(readDocumentPreview()).toEqual({ title: "Article title", description: "A short description", siteName: "Publication" });
  });

  test("Falls back to the tab title when metadata is unavailable", () => {
    Object.defineProperty(globalThis, "document", { configurable: true, value: { title: "Page title", querySelector: () => null } });
    expect(readDocumentPreview()).toEqual({ title: "Page title", description: "", siteName: "" });
  });
});
