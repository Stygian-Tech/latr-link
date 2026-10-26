/** AMO expects the built extension files, not a containing folder or sources. */
export function assertRootManifest(entries, browserName) {
  if (entries.filter((entry) => entry === "manifest.json").length !== 1) {
    throw new Error(`${browserName} add-on ZIP must contain exactly one manifest.json at the archive root. Upload the browser store ZIP, not the source archive or a containing folder.`);
  }
}
