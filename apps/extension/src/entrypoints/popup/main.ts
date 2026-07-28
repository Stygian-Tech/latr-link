import {
  createExtensionAuthorizationUrl,
  getExtensionSession,
  signOutExtension,
} from "../../lib/auth";
import { getActiveTabUrl } from "../../lib/browser";
import { extensionWebAppUrl } from "../../lib/config";
import { saveTabUrl } from "../../lib/save";
import { takePendingSave } from "../../lib/pendingSave";
import type { OAuthSession } from "@atproto/oauth-client-browser";

const signedOut = document.getElementById("signed-out")!;
const signedIn = document.getElementById("signed-in")!;
const handleInput = document.getElementById("handle") as HTMLInputElement;
const signInBtn = document.getElementById("sign-in") as HTMLButtonElement;
const signOutBtn = document.getElementById("sign-out") as HTMLButtonElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const tabUrlEl = document.getElementById("tab-url")!;
const saveStatus = document.getElementById("save-status")!;
const authError = document.getElementById("auth-error")!;
const openLibrary = document.getElementById("open-library") as HTMLAnchorElement;
let selectedUrl: string | null = null;

openLibrary.href = `${extensionWebAppUrl()}/library`;

function showSignedOut(): void {
  signedOut.classList.remove("hidden");
  signedIn.classList.add("hidden");
}

function showSignedIn(): void {
  signedOut.classList.add("hidden");
  signedIn.classList.remove("hidden");
}

function setAuthError(message: string | null): void {
  if (!message) {
    authError.classList.add("hidden");
    authError.textContent = "";
    return;
  }
  authError.textContent = message;
  authError.classList.remove("hidden");
}

function setSaveStatus(message: string): void {
  saveStatus.textContent = message;
}

async function refreshTabPreview(preferredUrl?: string): Promise<string | null> {
  const url = preferredUrl ?? selectedUrl ?? (await getActiveTabUrl());
  selectedUrl = url;
  tabUrlEl.textContent = url ?? "No Active Tab URL.";
  return url;
}

async function performSave(url: string, session: OAuthSession): Promise<void> {
  saveBtn.disabled = true;
  setSaveStatus("Saving…");
  try {
    const result = await saveTabUrl(url, session);
    if (result.ok) {
      setSaveStatus(
        result.kind === "subject" ? "Saved AT Proto Record." : "Saved Link."
      );
    } else {
      setSaveStatus(result.message);
    }
  } finally {
    saveBtn.disabled = false;
  }
}

async function bootstrap(): Promise<void> {
  const session = await getExtensionSession();
  if (!session) {
    showSignedOut();
    return;
  }
  showSignedIn();
  const pending = await takePendingSave();
  const url = await refreshTabPreview(pending?.url);
  if (pending && url) await performSave(url, session);
}

signInBtn.addEventListener("click", () => {
  void (async () => {
    setAuthError(null);
    const handle = handleInput.value.trim();
    if (!handle) {
      setAuthError("Enter Your Bluesky Handle.");
      return;
    }
    signInBtn.disabled = true;
    try {
      const authorizationUrl = await createExtensionAuthorizationUrl(handle);
      await browser.tabs.create({ url: authorizationUrl });
      window.close();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : "Could Not Start Sign-In."
      );
      signInBtn.disabled = false;
    }
  })();
});

signOutBtn.addEventListener("click", () => {
  void (async () => {
    await signOutExtension();
    showSignedOut();
    setSaveStatus("");
  })();
});

saveBtn.addEventListener("click", () => {
  void (async () => {
    const session = await getExtensionSession();
    if (!session) {
      showSignedOut();
      return;
    }
    const url = await refreshTabPreview();
    if (!url) {
      setSaveStatus("No URL to Save on This Tab.");
      return;
    }
    saveBtn.disabled = true;
    await performSave(url, session);
  })();
});

void bootstrap();
