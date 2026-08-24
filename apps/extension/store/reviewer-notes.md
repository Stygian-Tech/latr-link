# Browser store reviewer notes

## Test prerequisites

- Firefox 142 or newer, or a current stable Chrome release.
- Any valid AT Protocol account. A Bluesky account works; there is no separate L@tr.link invitation or paid plan.
- A normal HTTP or HTTPS page to save.

## Review flow

1. Install the submitted package.
2. Open the extension popup on an HTTP or HTTPS page.
3. Review the data-use disclosure displayed above the sign-in controls.
4. Enter the handle for the reviewer’s AT Protocol account and select **Sign In**.
5. Complete the authorization flow in the newly opened tab.
6. Reopen the extension popup. Add an optional tag and select **Save Current Tab**.
7. Select **Open Library**. Confirm the saved item appears with the URL, tag, and resolved page preview.
8. Open the saved item and confirm it opens in a normal browser tab.
9. Select **Sign Out** in the extension when finished.

## Permission review

- The extension has no content scripts.
- `activeTab` reads the active page URL only after an explicit toolbar or command invocation.
- `contextMenus` provides the explicit save action.
- `storage` holds the OAuth session and short-lived pending save.
- HTTPS host access is required because the selected page, AT Protocol authorization server, Personal Data Server, and L@tr.link proxy can be on different HTTPS hosts.
- Private browsing is disabled with `incognito: not_allowed`.

## Authentication and network behavior

The submitted store packages contain no L@tr.link API key. They call `https://latr.link/api/latr-gateway`, which injects the first-party credential on the server. The reviewer’s AT Protocol access token remains bound to its DPoP key and is forwarded in proxy-specific headers before the gateway validates it.

The extension also creates upstream DPoP proofs for writes to the reviewer’s Personal Data Server. This is why the save request must originate from an authenticated extension session.

## Firefox validator warning

Mozilla’s validator may identify `Function("return this")` inside the bundled `core-js` compatibility path used by the AT Protocol OAuth dependency. The extension manifest does not permit unsafe evaluation, and the modern browser path uses `globalThis`; this fallback is not executed in supported Firefox versions. There is no extension-authored remote code or dynamic code download.

## Support

- Privacy: https://latr.link/privacy
- Support: https://latr.link/support
- Public feedback board: https://userinput.app/s/did:plc:qy5pluw2bsuq2x6albsgkvx3/3msgeiqdplp2m?lang=en
