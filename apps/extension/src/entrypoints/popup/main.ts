import {
  createExtensionAuthorizationUrl,
  getExtensionSession,
  signOutExtension,
} from "../../lib/auth";
import { getActiveTabUrl } from "../../lib/browser";
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
const signOutBtn = document.getElementById("sign-out") as HTMLButtonElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const tabUrlEl = document.getElementById("tab-url")!;
const tagInput = document.getElementById("save-tags") as HTMLInputElement;
const tagChips = document.getElementById("tag-chips")!;
const tagError = document.getElementById("tag-error")!;
const saveStatus = document.getElementById("save-status")!;
const authError = document.getElementById("auth-error")!;
const openLibrary = document.getElementById("open-library") as HTMLAnchorElement;
let selectedUrl: string | null = null;
let selectedTags: string[] = [];

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
  const url = preferredUrl ?? selectedUrl ?? (await getActiveTabUrl());
  selectedUrl = url;
  tabUrlEl.textContent = url ?? "No Active Tab URL.";
  return url;
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
      setSaveStatus("Saved Link.");
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
      error instanceof Error ? error.message : "Could Not Save This Link."
    );
    await queuePendingSave(url, tags);
    return false;
  } finally {
    saveBtn.disabled = false;
    tagInput.disabled = false;
  }
}

async function bootstrap(): Promise<void> {
  const pending = await getPendingSave();
  selectedTags = pending?.tags ?? [];
  renderTags();
  const url = await refreshTabPreview(pending?.url);
  const session = await getExtensionSession();
  if (!session) {
    showSignedOut();
    return;
  }
  showSignedIn();
  if (pending && url) {
    if (await performSave(url, session, pending.tags)) {
      await takePendingSave();
    }
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

signInBtn.addEventListener("click", () => {
  void (async () => {
    setAuthError(null);
    const handle = handleInput.value.trim();
    if (!handle) {
      setAuthError("Enter Your Bluesky Handle.");
      return;
    }
    const tags = commitTagInput();
    if (!tags) return;
    signInBtn.disabled = true;
    try {
      const url = await refreshTabPreview();
      if (url) await queuePendingSave(url, tags);
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
    const tags = commitTagInput();
    if (!tags) return;
    await performSave(url, session, tags);
  })();
});

void bootstrap();
