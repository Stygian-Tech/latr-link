import { handleExtensionOAuthCallback } from "../../lib/auth";

void (async () => {
  const status = document.getElementById("status");
  try {
    await handleExtensionOAuthCallback();
    if (status) status.textContent = "Signed In. You Can Close This Tab.";
    setTimeout(() => window.close(), 1200);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "OAuth Callback Failed.";
    if (status) status.textContent = message;
  }
})();
