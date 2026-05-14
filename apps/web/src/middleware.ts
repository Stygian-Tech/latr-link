import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * PKCE OAuth `state` is stored in IndexedDB per origin. Loopback `client_id`
 * uses redirect_uri on 127.0.0.1, while devs often open http://localhost —
 * different origins, different IDB. Redirect those hosts to 127.0.0.1 at the
 * HTTP layer so the document and all /_next assets share one origin.
 *
 * Note: the request URL has no fragment; OAuth callbacks from Bluesky already
 * use the registered 127.0.0.1 redirect_uri. This mainly fixes /login et al.
 */
export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  if (url.protocol !== "http:") {
    return NextResponse.next();
  }

  const h = url.hostname;
  if (h === "localhost" || h === "::1" || h === "[::1]") {
    url.hostname = "127.0.0.1";
    return NextResponse.redirect(url, 307);
  }

  return NextResponse.next();
}

export const config = {
  // Match all pathnames so /_next chunks and HMR use the same host as the document after redirect.
  matcher: ["/:path*"],
};
