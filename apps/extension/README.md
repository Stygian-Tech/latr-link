# L@tr.link Extension

The toolbar action opens the quick-save popup. Keyboard and context-menu entry points try the native action popup first and fall back to a floating extension window. OAuth returns to an independent floating window before closing its callback tab.

Signed-out users see the login prompt. Signed-in users see page title, description, site name, a shortened URL, tags, and Save to Library. The original full URL is saved. The settings page contains account sign-out, the privacy explanation, support, and library links.

Page previews read metadata from the explicitly selected tab using the active-tab grant. They do not fetch remote preview images or send browsing metadata to preview providers before a save. Restricted pages and expired grants fall back to URL/title only.

From the monorepo root:

```sh
bun run --cwd apps/extension test
bun run --cwd apps/extension typecheck
bun run --cwd apps/extension build
```

The actual browser APIs and OAuth/PDS behavior still need authenticated acceptance in both Chrome and Firefox when testing unpacked artifacts. See [extension operations and packaging](../../docs/apps/extension.md).

## Native Popup Layout Check

Run `node apps/extension/scripts/check-native-popup.mjs` from the monorepo root
after building store packages. This optional check needs Playwright and its full
Chromium browser; the script header shows how to install them outside the repo
and set `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` when needed.

The check loads the actual extension in a temporary browser profile and opens
its toolbar action without setting a viewport. It asserts a readable popup
width, no horizontal overflow, and visible header/login controls, then saves
metrics and a screenshot outside the repository. A fixed-width browser tab
cannot catch Chrome's intrinsic popup sizing regressions. No account is used.
