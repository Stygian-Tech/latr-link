/**
 * Brand mark served from `public/`, not `app/`.
 *
 * Next's `app/icon.*` file convention would emit a second `<link rel="icon">`
 * alongside `app/favicon.ico`, and it labels both with the largest frame it
 * finds (`sizes="256x256"`). With two same-sized candidates the browser picks
 * arbitrarily and downscales a 256px bitmap into a 16px tab slot, so the tab
 * icon rendered inconsistently. Keeping the mark in `public/` leaves
 * `favicon.ico` as the only `rel="icon"` candidate, letting browsers use its
 * purpose-built 16/32/48 frames.
 *
 * The path is also the OAuth `logo_uri`, so the `/icon.png` URL must keep
 * resolving.
 */
export const BRAND_ICON_PATH = "/icon.png";
