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
  windows: { create(options: { url: string; type: "popup"; width: number; height: number }): Promise<unknown> };
};

/** Keep the save flow floating even when action.openPopup requires a gesture. */
export async function openExtensionSaveSurface(
  api: ExtensionSaveSurfaceApi = browser as unknown as ExtensionSaveSurfaceApi
): Promise<void> {
  const actionApi = api.action?.openPopup ? api.action : api.browserAction;
  if (actionApi?.openPopup) {
    try {
      await actionApi.openPopup();
      return;
    } catch {
      // Some browser versions reject action popups after asynchronous work.
    }
  }
  await openExtensionSaveWindow(api);
}

/** OAuth returns to an independent window so closing its tab cannot dismiss it. */
export async function openExtensionSaveWindow(
  api: Pick<ExtensionSaveSurfaceApi, "runtime" | "windows"> = browser as unknown as ExtensionSaveSurfaceApi
): Promise<void> {
  await api.windows.create({
    url: api.runtime.getURL("/popup.html"), type: "popup", width: 400, height: 560,
  });
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
