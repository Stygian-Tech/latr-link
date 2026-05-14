/** Block obvious SSRF / non-public targets before server-side OG fetches (issue #2). */

/** Returns a short reason message if rejected, otherwise `undefined`. */
export function blockingReasonOgFetch(hostname: string): string | undefined {
  const norm = hostname.trim().replace(/^\[|\]$/g, "").toLowerCase();

  if (norm === "localhost" || norm === "localhost." || norm === "0") {
    return "blocked_host";
  }
  if (
    norm === "broadcasthost" ||
    norm.endsWith(".local") ||
    norm.endsWith(".localhost")
  ) {
    return "blocked_host";
  }
  // IPv6 loopback / unspecified
  if (
    norm === "::1" ||
    norm === "::" ||
    norm === "0000:0000:0000:0000:0000:0000:0000:0000"
  ) {
    return "blocked_host";
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(norm);
  if (ipv4) {
    const parts = ipv4.slice(1, 5).map((s) => Number(s));
    if (parts.some((n) => n > 255 || n !== Math.floor(n))) {
      return "invalid_host";
    }
    const [a, b] = parts;

    if (a === 127 || a === 10) return "blocked_ipv4";
    if (a === 0) return "blocked_ipv4";
    if (a === 169 && b === 254) return "blocked_ipv4";
    if (a === 192 && b === 168) return "blocked_ipv4";
    if (a === 172 && b >= 16 && b <= 31) return "blocked_ipv4";

    return undefined;
  }

  const looksLikeIpv6 = /^[0-9a-f:]+$/i.test(norm);
  if (
    looksLikeIpv6 &&
    (norm.includes("fc00:") || norm.includes("fd00:") || norm.startsWith("fe80"))
  ) {
    return "blocked_ipv6_scope";
  }

  return undefined;
}
