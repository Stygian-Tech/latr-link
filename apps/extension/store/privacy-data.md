# Store privacy and data-use declarations

These answers must remain aligned with the visible popup disclosure and `https://latr.link/privacy`.

## Data handled

| Store category | Collected or transmitted | Purpose | Storage |
| --- | --- | --- | --- |
| Authentication information | Yes | AT Protocol OAuth sign-in and authorized save requests | OAuth session in browser extension storage; authorization sent to the selected auth server and L@tr.link gateway |
| Browsing activity | Yes, limited to the page the user explicitly saves | Create the saved record and resolve its preview | Selected URL stored on the user’s Personal Data Server; preview cache up to seven days |
| User-provided content | Yes | Store optional tags authored in the popup | Tags stored with the user’s on-protocol saved record |
| Personal communications | No | Not applicable | Not applicable |
| Location | No | Not applicable | Not applicable |
| Financial and payment information | No | Not applicable | Not applicable |
| Health information | No | Not applicable | Not applicable |
| Web history collected in the background | No | Not applicable | Not applicable |

The selected page URL is declared as browsing activity because the user transmits it to L@tr.link. The extension does not monitor, retain, or transmit other pages visited.

## Chrome Web Store certifications

- Data use is limited to the extension’s single purpose: saving a user-selected page to L@tr.link.
- Data is not sold or transferred for advertising.
- Data is not used for creditworthiness or lending.
- Data is not used for unrelated profiling or personalized advertising.
- Human access is limited to security, support, legal, and service-maintenance needs.
- Data is transmitted over HTTPS.
- The extension complies with the Chrome Web Store User Data Policy, including Limited Use requirements.

## Firefox built-in consent mapping

The manifest declares these required categories:

- `authenticationInfo`
- `browsingActivity`

Firefox’s `browsingActivity` category covers the URL the user explicitly chooses to save. The popup disclosure is shown before the sign-in and save controls.

## Local browser storage

- AT Protocol OAuth client state and session material.
- A pending URL and optional tags during the sign-in handoff.
- Pending saves expire after five minutes and are removed after a successful save or sign-out.

Removing the extension clears its local extension storage through the browser. On-protocol records remain until the user deletes them from their library or Personal Data Server.
