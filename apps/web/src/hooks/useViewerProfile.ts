"use client";

import { Agent } from "@atproto/api";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { BSKY_APPVIEW_PUBLIC } from "@/lib/appview";

export const VIEWER_PROFILE_QUERY_KEY = (did: string) =>
  ["viewerProfile", did] as const;

export type ViewerProfileSlice = {
  did: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
  description?: string;
};

/**
 * Bluesky-facing profile for the sidebar (avatar, display name, handle).
 * Uses public App View for `app.bsky.actor.getProfile`; falls back to repo `profile/self`.
 */
export function useViewerProfile() {
  const { session, getOAuthSession } = useAuth();
  const did = session?.did ?? null;

  return useQuery({
    queryKey: VIEWER_PROFILE_QUERY_KEY(did ?? ""),
    queryFn: async (): Promise<ViewerProfileSlice | null> => {
      if (!did) return null;

      const appViewAgent = new Agent(BSKY_APPVIEW_PUBLIC);
      try {
        const res = await appViewAgent.api.app.bsky.actor.getProfile({
          actor: did,
        });
        const d = res.data;
        return {
          did: d.did,
          handle: d.handle,
          displayName: d.displayName,
          avatar: d.avatar,
          description: d.description,
        };
      } catch {
        const oauthSession = getOAuthSession();
        if (!oauthSession) return null;
        const pdsAgent = new Agent(oauthSession);
        const rec = await pdsAgent.api.com.atproto.repo.getRecord({
          repo: did,
          collection: "app.bsky.actor.profile",
          rkey: "self",
        });
        const val = rec.data.value as Record<string, unknown>;
        const str = (v: unknown): string | undefined =>
          typeof v === "string" ? v : undefined;
        return {
          did,
          handle: did,
          displayName: str(val.displayName),
          description: str(val.description),
        };
      }
    },
    enabled: !!did,
    staleTime: 5 * 60_000,
  });
}
