export function extensionCallbackUrlForHostedUrl(
  candidate: string,
  configuredRedirectUri: string,
  extensionCallbackUrl: string
): string | null {
  let incoming: URL;
  let expected: URL;
  try {
    incoming = new URL(candidate);
    expected = new URL(configuredRedirectUri);
  } catch {
    return null;
  }

  if (incoming.origin !== expected.origin || incoming.pathname !== expected.pathname) {
    return null;
  }
  if (!incoming.searchParams.has("state")) return null;
  const hasCode = incoming.searchParams.has("code");
  const hasError = incoming.searchParams.has("error");
  if (hasCode === hasError) return null;

  const callback = new URL(extensionCallbackUrl);
  callback.search = incoming.search;
  return callback.href;
}
