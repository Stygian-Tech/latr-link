import { describe, expect, test } from "bun:test";

import { decodeHtmlText } from "./decodeHtmlText";

describe("Decode HTML Text", () => {
  test("Decodes Named, Decimal, Hex, and Unicode Escapes", () => {
    expect(decodeHtmlText("It&apos;s fine")).toBe("It's fine");
    expect(decodeHtmlText("Don&#39;t stop")).toBe("Don't stop");
    expect(decodeHtmlText("Don&#039;t stop")).toBe("Don't stop");
    expect(decodeHtmlText("Don&#x27;t stop")).toBe("Don't stop");
    expect(decodeHtmlText("Say \\u0027hello\\u0027")).toBe("Say 'hello'");
  });

  test("Decodes Double-encoded Entities", () => {
    expect(decodeHtmlText("Tom&amp;#39;s")).toBe("Tom's");
  });

  test("Preserves Unknown Entities", () => {
    expect(decodeHtmlText("&unknown; entity")).toBe("&unknown; entity");
  });
});
