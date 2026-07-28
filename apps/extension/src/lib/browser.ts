export async function getActiveTabUrl(): Promise<string | null> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const url = tabs[0]?.url?.trim();
  return url && url.length > 0 ? url : null;
}

/** Lightweight guard for URLs queued by the background service worker. */
export function isSupportedExtensionSaveUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
