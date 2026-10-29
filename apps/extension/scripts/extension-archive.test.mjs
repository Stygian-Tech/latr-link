import { describe, expect, test } from "bun:test";
import { assertRootManifest } from "./extension-archive.mjs";

describe("store upload archive layout", () => {
  test("accepts the extension manifest directly at the archive root", () => {
    expect(() => assertRootManifest(["manifest.json", "background.js"], "Firefox")).not.toThrow();
  });
  test("rejects an archive containing the extension's parent folder", () => {
    expect(() => assertRootManifest(["firefox/manifest.json"], "Firefox")).toThrow("archive root");
  });
  test("rejects duplicate root manifests", () => {
    expect(() => assertRootManifest(["manifest.json", "manifest.json"], "Firefox")).toThrow("exactly one");
  });
  test("rejects the reviewer source archive as an add-on upload", () => {
    expect(() => assertRootManifest(["package.json", "apps/extension/src/entrypoints/popup/index.html"], "Firefox")).toThrow("not the source archive");
  });
});
