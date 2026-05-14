"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { OAUTH_CALLBACK_TIMEOUT_MS, handleCallback } from "@/lib/auth";

const WATCHDOG_MS = OAUTH_CALLBACK_TIMEOUT_MS + 15_000;

function goToLoginWithError(message: string): void {
  const clipped = message.slice(0, 280);
  window.location.replace(
    `/login?error=callback_failed&message=${encodeURIComponent(clipped)}`
  );
}

export default function CallbackPage() {
  const handled = useRef(false);
  const flowFinished = useRef(false);
  const [slowHint, setSlowHint] = useState(false);

  useLayoutEffect(() => {
    if (handled.current) return;
    handled.current = true;

    handleCallback()
      .then(() => {
        flowFinished.current = true;
        // Full navigation: session is already in IndexedDB/localStorage from
        // initCallback — avoids relying on client Router + React state.
        window.location.replace("/library");
      })
      .catch((err: unknown) => {
        flowFinished.current = true;
        console.error("OAuth callback error:", err);
        const raw = err instanceof Error ? err.message : String(err);
        goToLoginWithError(raw);
      });
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setSlowHint(true), 20_000);
    return () => window.clearTimeout(t);
  }, []);

  // If the promise never settles (blocked thread, extreme IDB bug), still leave the page.
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (flowFinished.current) return;
      window.location.replace(
        `/login?error=callback_watchdog&message=${encodeURIComponent(
          `No response after ${WATCHDOG_MS}ms — try NEXT_PUBLIC_OAUTH_RESPONSE_MODE=query in .env.local or a regular Chrome window (not embedded preview).`
        )}`
      );
    }, WATCHDOG_MS);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="flex min-h-app items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-md space-y-3 px-4 text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
        <p className="text-sm text-zinc-500">Completing sign-in…</p>
        {slowHint ? (
          <p className="text-xs text-zinc-400">
            If this lasts more than ~{Math.ceil(OAUTH_CALLBACK_TIMEOUT_MS / 1000)}s,
            add{" "}
            <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">
              NEXT_PUBLIC_OAUTH_RESPONSE_MODE=query
            </code>{" "}
            to <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">.env.local</code>{" "}
            and sign in again (uses query params instead of URL hash). HMR WebSocket
            errors are unrelated.
          </p>
        ) : null}
      </div>
    </div>
  );
}
