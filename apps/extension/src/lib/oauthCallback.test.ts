import { describe, expect, test } from "bun:test";

import { extensionCallbackUrlForHostedUrl } from "./oauthCallback";

const redirect = "https://testing.latr.link/extension/callback";
const callback = "moz-extension://extension-id/callback.html";

describe("Hosted OAuth Callback Relay", () => {
  test("Forwards valid callback parameters to the extension page", () => {
    expect(
      extensionCallbackUrlForHostedUrl(
        `${redirect}?code=abc&state=state-1&iss=https%3A%2F%2Fbsky.social`,
        redirect,
        callback
      )
    ).toBe(
      "moz-extension://extension-id/callback.html?code=abc&state=state-1&iss=https%3A%2F%2Fbsky.social"
    );
  });

  test("Forwards OAuth errors", () => {
    expect(
      extensionCallbackUrlForHostedUrl(
        `${redirect}?error=access_denied&state=state-1`,
        redirect,
        callback
      )
    ).toBe(
      "moz-extension://extension-id/callback.html?error=access_denied&state=state-1"
    );
  });

  test("Rejects foreign origins and wrong paths", () => {
    expect(
      extensionCallbackUrlForHostedUrl(
        "https://evil.example/extension/callback?code=abc&state=state-1",
        redirect,
        callback
      )
    ).toBeNull();
    expect(
      extensionCallbackUrlForHostedUrl(
        "https://testing.latr.link/callback?code=abc&state=state-1",
        redirect,
        callback
      )
    ).toBeNull();
  });

  test("Rejects incomplete callbacks", () => {
    expect(
      extensionCallbackUrlForHostedUrl(`${redirect}?code=abc`, redirect, callback)
    ).toBeNull();
    expect(
      extensionCallbackUrlForHostedUrl(`${redirect}?state=state-1`, redirect, callback)
    ).toBeNull();
    expect(
      extensionCallbackUrlForHostedUrl(
        `${redirect}?code=abc&error=access_denied&state=state-1`,
        redirect,
        callback
      )
    ).toBeNull();
  });
});
