import { browser } from "wxt/browser";
import { isSupportedExtensionSaveUrl } from "./browser";

export type PagePreview = {
  url: string;
  title: string;
  description: string;
  siteName: string;
};

/** Omit queries/fragments, which can be long and contain private state. */
export function shortenPageUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname;
    const label = `${url.hostname}${path}`;
    return label.length > 64 ? `${label.slice(0, 61)}…` : label;
  } catch {
    return "No page selected";
  }
}

/** Runs only on the selected page; never fetches metadata or preview images. */
export function readDocumentPreview(): Omit<PagePreview, "url"> {
  const meta = (key: string): string =>
    document.querySelector<HTMLMetaElement>(`meta[property="${key}"], meta[name="${key}"]`)
      ?.content.trim().slice(0, 500) ?? "";
  return {
    title: (meta("og:title") || document.title).slice(0, 200),
    description: meta("og:description") || meta("description"),
    siteName: meta("og:site_name").slice(0, 100),
  };
}

export async function getPagePreview(preferredUrl?: string): Promise<PagePreview | null> {
  // A fallback popup window is itself active; find the explicitly queued page.
  const tabs = await browser.tabs.query(preferredUrl ? {} : { active: true, currentWindow: true });
  const tab = preferredUrl ? tabs.find((candidate) => candidate.url === preferredUrl) : tabs[0];
  const url = preferredUrl ?? tab?.url;
  if (!url || !isSupportedExtensionSaveUrl(url)) return null;
  const preview: PagePreview = { url, title: tab?.title ?? "", description: "", siteName: "" };
  if (tab?.id !== undefined && tab.url === url) {
    try {
      const results = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: readDocumentPreview });
      const metadata = results[0]?.result;
      if (metadata) Object.assign(preview, metadata);
    } catch {
      // Restricted pages or expired activeTab grants still allow a URL-only save.
    }
  }
  return preview;
}
