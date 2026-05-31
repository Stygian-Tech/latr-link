import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const latrPackagesRoot = join(import.meta.dir, "../../../node_modules/latr-packages");
const canonicalLexicon = join(
  latrPackagesRoot,
  "packages/lexicons/com.latr.saved.item.json"
);
const localLexicon = join(import.meta.dir, "../com.latr.saved.item.json");

describe("Com.latr.saved.item Lexicon Drift", () => {
  it("Matches Latr-packages Canonical Schema", () => {
    const canonical = JSON.parse(readFileSync(canonicalLexicon, "utf8"));
    const local = JSON.parse(readFileSync(localLexicon, "utf8"));
    expect(local).toEqual(canonical);
  });
});
