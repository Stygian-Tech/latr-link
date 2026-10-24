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
import {
  createAuthFetch,
  getSession,
  signIn as authSignIn,
  signOut as authSignOut,
} from "@/lib/auth";
import { DEMO_DID, isLatrDemoDataEnabled } from "@/lib/demoMode";

interface AuthSession {
  did: string;
}

type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>;

interface AuthContextValue {
  session: AuthSession | null;
  isLoading: boolean;
  applyOAuthSession: (oauthSession: OAuthSession) => void;
  getOAuthSession: () => OAuthSession | null;
  getAuthFetch: () => AuthFetch | null;
  signIn: (handle: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const demoMode = isLatrDemoDataEnabled();
  const [session, setSession] = useState<AuthSession | null>(
    demoMode ? { did: DEMO_DID } : null
  );
  const [isLoading, setIsLoading] = useState(!demoMode);
  const oauthSessionRef = useRef<OAuthSession | null>(null);

  useEffect(() => {
    if (demoMode) {
      return;
    }
    let cancelled = false;
    getSession()
      .then((oauthSession) => {
        if (cancelled) return;
        if (oauthSession) {
          oauthSessionRef.current = oauthSession;
          setSession({ did: oauthSession.did });
        }
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [demoMode]);

  const handleSignIn = useCallback(async (handle: string) => {
    if (demoMode) {
      setSession({ did: DEMO_DID });
      return;
    }
    await authSignIn(handle);
  }, [demoMode]);

  const handleSignOut = useCallback(async () => {
    if (demoMode) {
      setSession({ did: DEMO_DID });
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Sign-out needs a full reload to reset in-memory session and query state.
      window.location.assign("/");
      return;
    }
    if (session) {
      await authSignOut(session.did);
      oauthSessionRef.current = null;
      setSession(null);
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Sign-out needs a full reload to reset in-memory session and query state.
      window.location.assign("/");
    }
  }, [demoMode, session]);

  const applyOAuthSession = useCallback((oauthSession: OAuthSession) => {
    oauthSessionRef.current = oauthSession;
    setSession({ did: oauthSession.did });
  }, []);

  const getOAuthSession = useCallback((): OAuthSession | null => {
    return oauthSessionRef.current;
  }, []);

  const getAuthFetch = useCallback((): AuthFetch | null => {
    const s = oauthSessionRef.current;
    if (!s) return null;
    return createAuthFetch(s);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        isLoading,
        applyOAuthSession,
        getOAuthSession,
        getAuthFetch,
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
