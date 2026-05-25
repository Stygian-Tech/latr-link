"use client";

import { FormEvent, useState, useSyncExternalStore } from "react";
import Link from "next/link";

import { useAuth } from "@/hooks/useAuth";

const callbackErrorMessage =
  "Sign-in callback failed. Try an external browser (Chrome/Safari) if preview tools block WebSockets or storage.";

function getInitialCallbackError(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  if (error !== "callback_failed" && error !== "callback_watchdog") return null;
  return params.get("message") || callbackErrorMessage;
}

function subscribeToLoginSearchParams(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function readCallbackErrorFromUrl(): string | null {
  return getInitialCallbackError();
}

export default function LoginPage() {
  const { signIn } = useAuth();
  const [handle, setHandle] = useState("");
  const callbackError = useSyncExternalStore(
    subscribeToLoginSearchParams,
    readCallbackErrorFromUrl,
    () => null
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const displayError = error ?? callbackError;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      await signIn(handle.trim());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Sign-in failed. Check your handle and try again."
      );
      setIsPending(false);
    }
  }

  return (
    <div className="flex min-h-app flex-1 flex-col items-center justify-center gap-3 bg-zinc-50 p-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">L@tr.link</h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Read later — stored on your PDS, not our servers.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="handle" className="text-sm font-medium">
              Handle
            </label>
            <input
              id="handle"
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="you.bsky.social"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              spellCheck={false}
              required
              disabled={isPending}
              className="flex h-10 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:ring-offset-zinc-950"
            />
          </div>

          {displayError && (
            <p className="text-sm text-red-600 dark:text-red-400">{displayError}</p>
          )}

          <button
            type="submit"
            disabled={isPending || !handle.trim()}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {isPending ? "Signing in…" : "Continue with ATProto"}
          </button>
        </form>
      </div>
      <p className="text-center text-xs text-zinc-500">
        New here?{" "}
        <Link
          href="https://bsky.app"
          className="underline underline-offset-2"
        >
          Join Bluesky
        </Link>
      </p>
    </div>
  );
}
