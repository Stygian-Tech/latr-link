import { describe, expect, test } from "bun:test";

import { metadata as callbackMetadata } from "./callback/layout";
import { metadata as extensionCallbackMetadata } from "./extension/callback/layout";
import { metadata as libraryMetadata } from "./library/layout";
import { metadata as archiveMetadata } from "./library/archive/layout";
import { metadata as settingsMetadata } from "./library/settings/layout";
import { metadata as loginMetadata } from "./login/layout";

describe("route title metadata", () => {
  test("preserves the site title template for nested library routes", () => {
    expect(libraryMetadata.title).toEqual({
      default: "Library",
      template: "%s · L@tr.link",
    });
  });

  test.each([
    ["/login", loginMetadata, "Sign In"],
    ["/callback", callbackMetadata, "Signing In"],
    ["/extension/callback", extensionCallbackMetadata, "Extension Sign In"],
    ["/library/archive", archiveMetadata, "Archive"],
    ["/library/settings", settingsMetadata, "Settings"],
  ])("defines a contextual title for %s", (_route, metadata, expectedTitle) => {
    expect(metadata.title).toBe(expectedTitle);
  });
});
