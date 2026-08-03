"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { OAuthSession } from "@atproto/oauth-client-browser";

import { getSession, signIn as authSignIn, signOut as authSignOut } from "@/lib/auth";

interface AuthSession {
  did: string;
}

interface AuthContextValue {
  session: AuthSession | null;
  isLoading: boolean;
  getOAuthSession: () => OAuthSession | null;
  signIn: (handle: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const oauthSessionRef = useRef<OAuthSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((oauthSession) => {
        if (cancelled || !oauthSession) return;
        oauthSessionRef.current = oauthSession;
        setSession({ did: oauthSession.did });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignIn = useCallback(async (handle: string) => {
    await authSignIn(handle);
  }, []);

  const handleSignOut = useCallback(async () => {
    if (!session) return;
    await authSignOut(session.did);
    oauthSessionRef.current = null;
    setSession(null);
  }, [session]);

  const getOAuthSession = useCallback(() => oauthSessionRef.current, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        isLoading,
        getOAuthSession,
        signIn: handleSignIn,
        signOut: handleSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
