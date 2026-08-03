"use client";

import { FormEvent, useState } from "react";

import { LatrKitLogo } from "@/components/LatrKitLogo";
import { useAuth } from "@/hooks/useAuth";

export default function LoginPage() {
  const { signIn } = useAuth();
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      await signIn(handle.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setIsPending(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-center">
          <div className="flex items-center justify-center gap-3">
            <LatrKitLogo size={44} />
            <h1 className="text-2xl font-semibold tracking-tight">LatrKit</h1>
          </div>
          <p className="mt-2 text-sm text-zinc-500">Developer console</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm font-medium" htmlFor="handle">
            ATProto handle
          </label>
          <input
            id="handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="you.bsky.social"
            required
            disabled={isPending}
            className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm dark:border-zinc-600 dark:bg-zinc-950"
          />
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={isPending || !handle.trim()}
            className="h-10 w-full rounded-md bg-zinc-900 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {isPending ? "Signing in…" : "Continue with ATProto"}
          </button>
        </form>
      </div>
    </div>
  );
}
