"use client";

import { useLayoutEffect } from "react";

import { AuthProvider } from "@/hooks/useAuth";
import { syncLatrGatewayFromBrowser } from "@/lib/latrGatewayUrl";

export function Providers({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => {
    syncLatrGatewayFromBrowser();
  }, []);

  return <AuthProvider>{children}</AuthProvider>;
}
