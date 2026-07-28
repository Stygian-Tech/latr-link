import { getActiveTabUrl } from "../lib/browser";
import { extensionOAuthRedirectUri } from "../lib/config";
import { extensionCallbackUrlForHostedUrl } from "../lib/oauthCallback";
import { queuePendingSave } from "../lib/pendingSave";

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: "latr-save-page",
      title: "Save to L@tr.link",
      contexts: ["page", "link"],
    });
  });

  async function openSaveSurface(): Promise<void> {
    if (browser.action.openPopup) {
      try {
        await browser.action.openPopup();
        return;
      } catch {
        // Some browser/version combinations only allow popup opening from a
        // narrower set of user gestures. The extension tab works everywhere.
      }
    }
    await browser.tabs.create({ url: browser.runtime.getURL("/popup.html") });
  }

  async function queueActiveTab(): Promise<void> {
    const url = await getActiveTabUrl();
    if (!url || !(await queuePendingSave(url))) return;
    await openSaveSurface();
  }

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== "latr-save-page") return;
    void (async () => {
      const url =
        info.linkUrl?.trim() ||
        info.pageUrl?.trim() ||
        tab?.url?.trim() ||
        (await getActiveTabUrl());
      if (!url || !(await queuePendingSave(url))) return;
      await openSaveSurface();
    })();
  });

  browser.commands?.onCommand.addListener((command) => {
    if (command !== "save-current-tab") return;
    void queueActiveTab();
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url) return;
    let callbackUrl: string | null = null;
    try {
      callbackUrl = extensionCallbackUrlForHostedUrl(
        changeInfo.url,
        extensionOAuthRedirectUri(),
        browser.runtime.getURL("/callback.html")
      );
    } catch (error) {
      console.warn("[latr-extension] Invalid OAuth callback configuration", error);
      return;
    }
    if (!callbackUrl) return;
    void browser.tabs.update(tabId, { url: callbackUrl });
  });
});
