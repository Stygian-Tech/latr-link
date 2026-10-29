import {
  createExtensionAuthorizationUrl,
  getExtensionSession,
} from "../../lib/auth";
import { getPagePreview, shortenPageUrl } from "../../lib/pagePreview";
import { extensionWebAppUrl } from "../../lib/config";
import { saveTabUrl } from "../../lib/save";
import {
  getPendingSave,
  queuePendingSave,
  takePendingSave,
} from "../../lib/pendingSave";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import {
  normalizeBookmarkTags,
  splitAuthoredBookmarkTags,
} from "latr-web-client/bookmarkTags";

const signedOut = document.getElementById("signed-out")!;
const signedIn = document.getElementById("signed-in")!;
const handleInput = document.getElementById("handle") as HTMLInputElement;
const signInBtn = document.getElementById("sign-in") as HTMLButtonElement;
const loading = document.getElementById("loading")!;
const saveHeading = document.getElementById("save-heading")!;
const description = document.getElementById("page-description")!;
const siteName = document.getElementById("site-name")!;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const tabUrlEl = document.getElementById("tab-url")!;
const tagInput = document.getElementById("save-tags") as HTMLInputElement;
const tagChips = document.getElementById("tag-chips")!;
const tagError = document.getElementById("tag-error")!;
const saveStatus = document.getElementById("save-status")!;
const authError = document.getElementById("auth-error")!;
const openLibrary = document.getElementById("open-library") as HTMLAnchorElement;
const settings = document.getElementById("settings") as HTMLAnchorElement;
let activeSession: OAuthSession | null = null;
let selectedUrl: string | null = null;
let selectedTags: string[] = [];

openLibrary.href = `${extensionWebAppUrl()}/library`;
settings.href = browser.runtime.getURL("/settings.html");
settings.target = "_blank";
settings.rel = "noopener";

function showSignedOut(): void {
  loading.classList.add("hidden");
  signedOut.classList.remove("hidden");
  signedIn.classList.add("hidden");
}

function showSignedIn(): void {
  loading.classList.add("hidden");
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

function setTagError(message: string | null): void {
  tagError.textContent = message ?? "";
  tagError.classList.toggle("hidden", !message);
}

function renderTags(): void {
  tagChips.replaceChildren();
  tagChips.classList.toggle("hidden", selectedTags.length === 0);
  for (const tag of selectedTags) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    const text = document.createElement("span");
    text.textContent = tag;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${tag}`);
    remove.addEventListener("click", () => {
      selectedTags = selectedTags.filter((candidate) => candidate !== tag);
      renderTags();
      tagInput.focus();
    });
    chip.append(text, remove);
    tagChips.append(chip);
  }
}

function commitTagInput(): string[] | null {
  try {
    selectedTags = normalizeBookmarkTags([
      ...selectedTags,
      ...splitAuthoredBookmarkTags(tagInput.value),
    ]);
    tagInput.value = "";
    setTagError(null);
    renderTags();
    return selectedTags;
  } catch (error) {
    setTagError(error instanceof Error ? error.message : "Invalid tag.");
    return null;
  }
}

async function refreshTabPreview(preferredUrl?: string): Promise<string | null> {
  const preview = await getPagePreview(preferredUrl ?? selectedUrl ?? undefined);
  selectedUrl = preview?.url ?? null;
  tabUrlEl.textContent = preview ? shortenPageUrl(preview.url) : "No page selected";
  saveHeading.textContent = preview?.title || "Save This Page";
  description.textContent = preview?.description ?? "";
  description.classList.toggle("hidden", !preview?.description);
  siteName.textContent = preview?.siteName ?? "";
  siteName.classList.toggle("hidden", !preview?.siteName);
  saveBtn.disabled = !selectedUrl;
  return selectedUrl;
}

async function performSave(
  url: string,
  session: OAuthSession,
  tags: readonly string[]
): Promise<boolean> {
  saveBtn.disabled = true;
  tagInput.disabled = true;
  setSaveStatus("Saving…");
  try {
    const result = await saveTabUrl(url, session, tags);
    if (result.ok) {
      setSaveStatus("Saved to your library.");
      selectedTags = [];
      renderTags();
      return true;
    } else {
      setSaveStatus(result.message);
      await queuePendingSave(url, tags);
      return false;
    }
  } catch (error) {
    setSaveStatus(
      error instanceof Error ? error.message : "Could not save this link."
    );
    await queuePendingSave(url, tags);
    return false;
  } finally {
    saveBtn.disabled = false;
    tagInput.disabled = false;
  }
}

async function bootstrap(): Promise<void> {
  // Restore OAuth and read local state concurrently; metadata never blocks login.
  const sessionPromise = getExtensionSession();
  const pending = await getPendingSave();
  selectedTags = pending?.tags ?? [];
  renderTags();
  const previewPromise = refreshTabPreview(pending?.url);
  activeSession = await sessionPromise;
  if (!activeSession) {
    showSignedOut();
    await previewPromise;
    return;
  }
  showSignedIn();
  const url = await previewPromise;
  if (pending && url && await performSave(url, activeSession, pending.tags)) {
    await takePendingSave();
  }
}

tagInput.addEventListener("keydown", (event) => {
  if (event.key === "," || (event.key === "Enter" && tagInput.value.trim())) {
    event.preventDefault();
    commitTagInput();
  }
});

tagInput.addEventListener("blur", () => {
  if (tagInput.value.trim()) commitTagInput();
});

document.getElementById("login-form")!.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    setAuthError(null);
    const handle = handleInput.value.trim();
    if (!handle) {
      setAuthError("Enter your Bluesky handle.");
      return;
    }
    const tags = commitTagInput();
    if (!tags) return;
    signInBtn.disabled = true;
    try {
      const url = selectedUrl ?? await refreshTabPreview();
      if (url) await queuePendingSave(url, tags);
      const authorizationUrl = await createExtensionAuthorizationUrl(handle);
      await browser.tabs.create({ url: authorizationUrl });
      window.close();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : "Could not start sign-in."
      );
      signInBtn.disabled = false;
    }
  })();
});

saveBtn.addEventListener("click", () => {
  void (async () => {
    const session = activeSession;
    if (!session) {
      showSignedOut();
      return;
    }
    const url = selectedUrl;
    if (!url) {
      setSaveStatus("No URL to save on this tab.");
      return;
    }
    const tags = commitTagInput();
    if (!tags) return;
    await performSave(url, session, tags);
  })();
});

void bootstrap().catch((error) => {
  showSignedOut();
  setAuthError(error instanceof Error ? error.message : "Could not open the extension. Try again.");
});
