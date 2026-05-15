"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

import { EmbeddedPageDialog } from "@/components/EmbeddedPageDialog";

type EmbeddedState = { url: string; title: string };

const EmbeddedReaderCtx = createContext<
  ((url: string, title: string) => void) | null
>(null);

export function EmbeddedReaderPortal({ children }: { children: ReactNode }) {
  const [embedded, setEmbedded] = useState<EmbeddedState | null>(null);
  const clear = useCallback(() => setEmbedded(null), []);

  const openEmbedded = useCallback((url: string, title: string) => {
    setEmbedded({ url, title });
  }, []);

  return (
    <EmbeddedReaderCtx.Provider value={openEmbedded}>
      <EmbeddedPageDialog
        open={embedded !== null}
        url={embedded?.url ?? null}
        title={embedded?.title ?? ""}
        onClose={clear}
      />
      {children}
    </EmbeddedReaderCtx.Provider>
  );
}

export function useOpenEmbeddedReader() {
  const open = useContext(EmbeddedReaderCtx);
  if (!open) {
    throw new Error(
      "useOpenEmbeddedReader must be used inside EmbeddedReaderPortal"
    );
  }
  return open;
}
