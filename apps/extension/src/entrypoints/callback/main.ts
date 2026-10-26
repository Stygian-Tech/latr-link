import { handleExtensionOAuthCallback } from "../../lib/auth";
import { openExtensionSaveWindow } from "../../lib/browser";
import { getPendingSave } from "../../lib/pendingSave";

void (async () => {
  const status = document.getElementById("status");
  try {
    await handleExtensionOAuthCallback();
    if (await getPendingSave()) {
      await openExtensionSaveWindow();
      window.close();
      return;
    }
    if (status) status.textContent = "Signed In. You Can Close This Tab.";
    globalThis.setTimeout(() => window.close(), 1200);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "OAuth Callback Failed.";
    if (status) status.textContent = message;
  }
})();
