import { describe, expect, test } from "bun:test";

import { extractSiteStandardDocumentAtUri } from "./standardSiteAtUri";

describe("extractSiteStandardDocumentAtUri", () => {
  test("parses rel-before-href ordering", () => {
    const html = `<html><head>
      <meta charset="utf-8"/>
      <link rel="site.standard.document" href="at://did:plc:z/site.standard.document/abc123xyz"/>
      </head><body>x</body></html>`;
    expect(extractSiteStandardDocumentAtUri(html)).toBe(
      "at://did:plc:z/site.standard.document/abc123xyz"
    );
  });

  test("parses href-before-rel ordering", () => {
    const html = `<link href="at://did:plc:a/com.example.lex/zzz" rel="site.standard.document">`;
    expect(extractSiteStandardDocumentAtUri(html)).toBe(
      "at://did:plc:a/com.example.lex/zzz"
    );
  });

  test("rejects non-at href values", () => {
    expect(
      extractSiteStandardDocumentAtUri(
        `<link rel="site.standard.document" href="https://example.invalid/x"/>`
      )
    ).toBeNull();
  });
});
