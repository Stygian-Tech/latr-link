"use client";

import { useLayoutEffect, useState } from "react";
import {
  QueryClient,
  type Query,
} from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { AuthProvider } from "@/hooks/useAuth";
import { syncLatrGatewayFromBrowser } from "@/lib/latrGatewayUrl";

const QUERY_PERSIST_KEY = "latr.link.react-query.v1";
const QUERY_PERSIST_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

function shouldDehydrateQuery(query: Query): boolean {
  const key = query.queryKey;
  return Array.isArray(key) && key[0] === "saved-library";
}

export function Providers({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => {
    syncLatrGatewayFromBrowser();
  }, []);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            retry: 1,
          },
        },
      })
  );

  const [persister] = useState(() =>
    createSyncStoragePersister({
      storage:
        typeof window === "undefined" ? undefined : window.localStorage,
      key: QUERY_PERSIST_KEY,
      throttleTime: 2000,
    })
  );

  return (
    <AuthProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: QUERY_PERSIST_MAX_AGE_MS,
          dehydrateOptions: {
            shouldDehydrateQuery,
          },
        }}
      >
        {children}
      </PersistQueryClientProvider>
    </AuthProvider>
  );
}
