# L@tr.link browser extension store listing

## Shared product details

- Name: `L@tr.link`
- Category: `Productivity`
- Language: `English (United States)`
- Homepage: `https://latr.link`
- Support URL: `https://latr.link/support`
- Privacy policy URL: `https://latr.link/privacy`

### Short summary

Save the current page to your L@tr.link read-later library, with optional tags.

### Full description

L@tr.link is a calm read-later library built on AT Protocol.

Use the extension to save the page you are viewing without breaking your flow. Add optional tags in the popup, use the toolbar button, context menu, or keyboard shortcut, and open your library in a new tab when you are ready to read.

Features:

- Save HTTP and HTTPS pages to your own L@tr.link library.
- Add exact, case-sensitive tags while saving.
- Sign in securely with your AT Protocol or Bluesky handle.
- Save from the toolbar, page context menu, or keyboard shortcut.
- Keep the saved URL, tags, and preview metadata on-protocol in your Personal Data Server.
- Open saved articles in normal browser tabs.

The extension only accesses the active page when you invoke L@tr.link. It does not collect browsing history in the background, display ads, sell personal data, or run content scripts on pages.

An AT Protocol account is required. Learn more at https://latr.link/privacy.

## Chrome Web Store

### Single purpose

Save the user-selected current page, with optional user-authored tags, to the signed-in user’s L@tr.link read-later library.

### Permission justifications

- `activeTab`: Reads the URL of the active tab only after the user invokes the extension.
- `storage`: Stores the AT Protocol OAuth session and a pending save locally so sign-in can complete without losing the selected URL or tags.
- `contextMenus`: Adds an explicit “Save to L@tr.link” action to the page context menu.
- `https://*/*` host access: The user may save a page from any HTTPS website. Extension pages also need cross-origin access to the user-selected AT Protocol authorization server and Personal Data Server, plus the L@tr.link save proxy. No content script is injected.

### Suggested listing fields

- Visibility: Public
- Regions: All regions where AT Protocol and L@tr.link are available
- Mature content: No
- Contains ads: No
- In-app purchases: No

## Firefox Add-ons

### Suggested metadata

- Add-on ID: `latr-link@stygian.tech`
- Minimum Firefox version: `142.0`
- Platforms: Firefox for Desktop
- Categories: `Bookmarks`, `Tabs`
- License: All Rights Reserved until the repository owner selects a public license

### Release notes for 0.2.0

- Add optional tags when saving pages.
- Use the current L@tr.link lexicons and gateway contracts.
- Preserve Open Graph preview metadata when items are saved from the extension.
- Restore the branded transparent extension icons.
- Route public store traffic through the L@tr.link server proxy so no client API key is distributed.

## Required artwork

- Chrome icon: `store/assets/icon-128.png`
- Chrome small promo tile: `store/assets/chrome-small-promo-440x280.png`
- Chrome screenshot: `store/assets/chrome-screenshot-1280x800.png`
- Firefox icon: `store/assets/icon-128.png`
- Firefox screenshot: `store/assets/firefox-screenshot-1280x800.png`

Use the PNG files at their native dimensions. Do not substitute the old blue-square icon.
