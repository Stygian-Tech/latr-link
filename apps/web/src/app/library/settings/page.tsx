"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useLatrRepo } from "@/hooks/useLatrRepo";

export default function SettingsPage() {
  const { session, isLoading } = useAuth();
  const router = useRouter();
  const repo = useLatrRepo();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !session) {
      router.replace("/login");
    }
  }, [isLoading, session, router]);

  async function exportJson() {
    if (!repo) return;
    setMessage(null);
    try {
      const items = await repo.listSavedItems();
      const payload = {
        exportedAt: new Date().toISOString(),
        did: repo.did,
        savedItems: items.map((r) => ({
          uri: r.uri,
          cid: r.cid,
          value: r.value,
        })),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `latr-export-${repo.did.slice(-8)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMessage("Download Started.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Export Failed.");
    }
  }

  if (!session) return null;

  return (
    <>
      <header className="border-b border-zinc-200 px-4 py-4 dark:border-zinc-800">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold leading-tight">Settings</h1>
          <p className="text-sm leading-snug text-zinc-500 dark:text-zinc-400">
            Local Data and Exports.
          </p>
        </div>
      </header>
      <div className="space-y-6 p-4">
        <section>
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Export
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Download a JSON Snapshot of Your `com.latr.saved.item` Records (Raw
            Repo Payloads). Resolved Previews Are Not Included.
          </p>
          <button
            type="button"
            disabled={!repo}
            onClick={() => void exportJson()}
            className="mt-3 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Download JSON
          </button>
          {message && (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {message}
            </p>
          )}
        </section>
        <section>
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Clear Local Cache
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Remove Persisted React Query Data From This Browser (Saved List
            Cache). Your PDS Records Are Unchanged.
          </p>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.removeItem("latr.link.react-query.v1");
                setMessage("Cleared Local React Query Cache.");
              } catch {
                setMessage("Could Not Clear Storage.");
              }
            }}
            className="mt-3 rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-600"
          >
            Clear Browser Cache
          </button>
        </section>
      </div>
    </>
  );
}
