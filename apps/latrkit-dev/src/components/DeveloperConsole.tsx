"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type {
  CreateDeveloperApiKeyResponse,
  DeveloperApiKeySummary,
  DeveloperClientSummary,
  DeveloperUsageSummary,
} from "latr-packages/gateway-client";
import {
  createDeveloperApiKey,
  createDeveloperClient,
  deleteDeveloperClient,
  listDeveloperApiKeys,
  listDeveloperClients,
  listDeveloperUsage,
  revokeDeveloperApiKey,
} from "@/lib/developerGatewayClient";

import { LatrKitLogo } from "@/components/LatrKitLogo";
import { useAuth } from "@/hooks/useAuth";
import { normalizeGatewayClientId } from "@/lib/gatewayClientId";

export function DeveloperConsole() {
  const { session, getOAuthSession, signOut } = useAuth();
  const [clients, setClients] = useState<DeveloperClientSummary[]>([]);
  const [usage, setUsage] = useState<DeveloperUsageSummary[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [keys, setKeys] = useState<DeveloperApiKeySummary[]>([]);
  const [keysClientId, setKeysClientId] = useState<string | null>(null);
  const [newClientId, setNewClientId] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [revealedKey, setRevealedKey] = useState<CreateDeveloperApiKeyResponse | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const visibleKeys =
    selectedClientId !== null && keysClientId === selectedClientId ? keys : [];

  const loadConsoleData = useCallback(async () => {
    const oauth = getOAuthSession();
    if (!oauth) return null;
    const [nextClients, nextUsage] = await Promise.all([
      listDeveloperClients(oauth),
      listDeveloperUsage(oauth),
    ]);
    return { nextClients, nextUsage };
  }, [getOAuthSession]);

  const refresh = useCallback(async () => {
    setError(null);
    const data = await loadConsoleData();
    if (!data) return;
    setClients(data.nextClients);
    setUsage(data.nextUsage);
  }, [loadConsoleData]);

  const refreshKeys = useCallback(
    async (clientId: string) => {
      const oauth = getOAuthSession();
      if (!oauth) return;
      const nextKeys = await listDeveloperApiKeys(oauth, clientId);
      setKeysClientId(clientId);
      setKeys(nextKeys);
    },
    [getOAuthSession]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await loadConsoleData();
        if (cancelled || !data) return;
        setClients(data.nextClients);
        setUsage(data.nextUsage);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load console data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadConsoleData]);

  useEffect(() => {
    if (!selectedClientId) return;
    let cancelled = false;
    void (async () => {
      try {
        const oauth = getOAuthSession();
        if (!oauth) return;
        const nextKeys = await listDeveloperApiKeys(oauth, selectedClientId);
        if (cancelled) return;
        setKeysClientId(selectedClientId);
        setKeys(nextKeys);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load API keys");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedClientId, getOAuthSession]);

  async function handleCreateClient(e: FormEvent) {
    e.preventDefault();
    const oauth = getOAuthSession();
    if (!oauth) return;
    setError(null);
    try {
      const clientId = normalizeGatewayClientId(newClientId);
      await createDeveloperClient(oauth, {
        clientId,
        displayName: newClientName.trim() || undefined,
      });
      setNewClientId("");
      setNewClientName("");
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create client");
    }
  }

  async function handleCreateKey() {
    if (!selectedClientId) return;
    const oauth = getOAuthSession();
    if (!oauth) return;
    setError(null);
    try {
      const created = await createDeveloperApiKey(oauth, selectedClientId);
      setRevealedKey(created);
      await refreshKeys(selectedClientId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create API key");
    }
  }

  async function handleDeleteClient(clientId: string) {
    const oauth = getOAuthSession();
    if (!oauth) return;
    setError(null);
    try {
      await deleteDeveloperClient(oauth, clientId);
      if (selectedClientId === clientId) {
        setSelectedClientId(null);
        setKeysClientId(null);
        setKeys([]);
      }
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete client");
    }
  }

  async function handleRevokeKey(keyId: string) {
    if (!selectedClientId) return;
    const oauth = getOAuthSession();
    if (!oauth) return;
    setError(null);
    try {
      await revokeDeveloperApiKey(oauth, selectedClientId, keyId);
      await refreshKeys(selectedClientId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to revoke API key");
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading developer console…</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-3">
          <LatrKitLogo size={40} />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">LatrKit Developer Console</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Signed in as{" "}
              <code className="break-all font-mono text-xs">{session?.did}</code>
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600"
        >
          Sign out
        </button>
      </header>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {revealedKey ? (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <h2 className="font-medium text-amber-900 dark:text-amber-100">API key (shown once)</h2>
          <p className="mt-2 font-mono text-sm break-all">{revealedKey.apiKey}</p>
          <p className="mt-2 text-xs leading-5 text-amber-800 dark:text-amber-200">
            Use headers{" "}
            <code className="font-mono break-all">
              X-Latr-Client-Id: {revealedKey.clientId}
            </code>{" "}
            and <code className="font-mono">X-Latr-API-Key</code> on gateway requests.
          </p>
          <button
            type="button"
            className="mt-3 text-sm underline"
            onClick={() => setRevealedKey(null)}
          >
            Dismiss
          </button>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Your clients</h2>
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {clients.length === 0 ? (
            <li className="px-4 py-3 text-sm text-zinc-500">No clients yet.</li>
          ) : (
            clients.map((client) => (
              <li
                key={client.clientId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <button
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => setSelectedClientId(client.clientId)}
                >
                  <span className="block truncate font-medium">
                    {client.displayName ?? client.clientId}
                  </span>
                  {client.displayName ? (
                    <span className="mt-1 block font-mono text-xs break-all text-zinc-500">
                      {client.clientId}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="text-xs text-red-600"
                  onClick={() =>
                    void handleDeleteClient(client.clientId)
                  }
                >
                  Delete
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Create client</h2>
        <p className="mt-1 text-sm text-zinc-500">
          First-party apps use the same flow as any other developer. Issue keys after creating a
          client.
        </p>
        <form onSubmit={handleCreateClient} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input
            value={newClientId}
            onChange={(e) => setNewClientId(e.target.value.toLowerCase())}
            placeholder="client-id"
            required
            autoComplete="off"
            spellCheck={false}
            className="h-10 rounded-md border border-zinc-300 px-3 font-mono text-sm dark:border-zinc-600 dark:bg-zinc-950"
          />
          <input
            value={newClientName}
            onChange={(e) => setNewClientName(e.target.value)}
            placeholder="Display name (optional, any characters)"
            className="h-10 rounded-md border border-zinc-300 px-3 text-sm dark:border-zinc-600 dark:bg-zinc-950"
          />
          <button
            type="submit"
            className="h-10 rounded-md bg-zinc-900 text-sm font-medium text-white sm:col-span-2 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Create client
          </button>
        </form>
      </section>

      {selectedClientId ? (
        <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="min-w-0 text-lg font-medium">
              API keys for{" "}
              <span className="font-mono break-all text-base">{selectedClientId}</span>
            </h2>
            <button
              type="button"
              onClick={() => void handleCreateKey()}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Create key
            </button>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {visibleKeys.map((key) => (
              <li
                key={key.keyId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-zinc-100 px-3 py-2 dark:bg-zinc-900"
              >
                <span className="min-w-0">
                  <span className="font-mono break-all">{key.label ?? key.keyId}</span>{" "}
                  {key.revokedAt ? (
                    <span className="text-red-600">revoked</span>
                  ) : (
                    <span className="text-green-700 dark:text-green-400">active</span>
                  )}
                </span>
                {!key.revokedAt ? (
                  <button
                    type="button"
                    className="text-xs text-red-600"
                    onClick={() =>
                      void handleRevokeKey(key.keyId)
                    }
                  >
                    Revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Usage (preview)</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Billing via Stripe is not enabled yet. Limits apply in developer preview.
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          {usage.map((row) => (
            <li key={row.clientId} className="rounded-md bg-zinc-100 px-3 py-2 dark:bg-zinc-900">
              <strong className="font-mono break-all">{row.clientId}</strong>{" "}
              <span className="text-zinc-500">-</span> {row.usageDate}
              {row.dailyLimit != null ? (
                <span className="ml-2 text-zinc-500">
                  {row.remaining ?? 0} / {row.dailyLimit} remaining
                </span>
              ) : null}
              <ul className="mt-1 text-xs text-zinc-500">
                {row.buckets.map((bucket) => (
                  <li key={bucket.routeFamily}>
                    {bucket.routeFamily}: {bucket.requestCount}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
