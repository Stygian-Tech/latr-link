import { getExtensionSession, signOutExtension } from "../../lib/auth";
import { extensionWebAppUrl } from "../../lib/config";
import { takePendingSave } from "../../lib/pendingSave";

for (const [id, path] of [["library", "/library"], ["privacy", "/privacy"], ["support", "/support"]]) {
  (document.getElementById(id) as HTMLAnchorElement).href = `${extensionWebAppUrl()}${path}`;
}
const account = document.getElementById("account")!;
const signOut = document.getElementById("sign-out") as HTMLButtonElement;
void getExtensionSession().then((session) => {
  account.textContent = session ? `Signed in as ${session.did}` : "You're signed out.";
  signOut.classList.toggle("hidden", !session);
});
signOut.addEventListener("click", () => {
  signOut.disabled = true;
  void (async () => {
    try {
      await signOutExtension();
      await takePendingSave();
      account.textContent = "You're signed out.";
      signOut.classList.add("hidden");
    } catch {
      account.textContent = "Could not sign out. Try again.";
    } finally {
      signOut.disabled = false;
    }
  })();
});
