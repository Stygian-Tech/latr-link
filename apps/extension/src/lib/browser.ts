export async function getActiveTabUrl(): Promise<string | null> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const url = tabs[0]?.url?.trim();
  return url && url.length > 0 ? url : null;
}

type ExtensionActionApi = {
  openPopup?: () => Promise<void>;
};

type ExtensionSaveSurfaceApi = {
  action?: ExtensionActionApi;
  browserAction?: ExtensionActionApi;
  runtime: { getURL(path: string): string };
  tabs: { create(options: { url: string }): Promise<unknown> };
};

/** Open the action popup when supported, otherwise use a normal extension tab. */
export async function openExtensionSaveSurface(
  api: ExtensionSaveSurfaceApi = browser as unknown as ExtensionSaveSurfaceApi
): Promise<void> {
  const actionApi = api.action?.openPopup ? api.action : api.browserAction;
  if (actionApi?.openPopup) {
    try {
      await actionApi.openPopup();
      return;
    } catch {
      // Firefox MV2 and some browser versions only allow popup opening from a
      // narrower set of gestures. The extension tab works everywhere.
    }
  }
  await api.tabs.create({ url: api.runtime.getURL("/popup.html") });
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
