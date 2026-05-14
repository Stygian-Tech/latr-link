import { AtUri } from "@atproto/syntax";
import {
  COLLECTION_SAVED_EXTERNAL,
  previewTitleForExternal,
  type SavedExternalRecord,
} from "latr-kit";

import { publicAppviewAgent } from "@/lib/appview";
import type { LatrRepo } from "@/lib/latrRepo";

export interface ResolvedPreview {
  title: string;
  subtitle?: string;
  href?: string;
  kind: "external" | "post" | "record" | "unknown";
  /** `com.latr.saved.external.image` — Open Graph thumbnail */
  imageHref?: string;
  /** Preferred display/canonical HTTP(S) URL for external subjects */
  canonicalUrl?: string;
  /** Hostname hint for favicon row chrome */
  siteLabel?: string;
}

function pickPostText(record: unknown): string {
  if (!record || typeof record !== "object") return "ATProto post";
  const r = record as { text?: string; title?: string };
  const t = r.title ?? r.text?.slice(0, 160);
  return t?.trim() || "ATProto post";
}

export async function resolveSubjectPreview(
  repo: LatrRepo,
  subjectUri: string
): Promise<ResolvedPreview> {
  const at = new AtUri(subjectUri);

  if (at.collection === "app.bsky.feed.post") {
    try {
      const res = await publicAppviewAgent.app.bsky.feed.getPosts({
        uris: [subjectUri],
      });
      const post = res.data.posts[0];
      const handle = post?.author?.handle
        ? `@${post.author.handle}`
        : undefined;
      const title = pickPostText(post?.record);
      const href =
        post?.author?.handle && at.rkey
          ? `https://bsky.app/profile/${post.author.handle}/post/${at.rkey}`
          : undefined;
      return {
        kind: "post",
        title,
        subtitle: handle,
        href,
      };
    } catch {
      /* fall through */
    }
  }

  const direct = await repo.getRecordByAtUri(subjectUri);
  if (direct?.value && typeof direct.value === "object") {
    const v = direct.value as { $type?: string };
    if (v.$type === COLLECTION_SAVED_EXTERNAL) {
      const ext = direct.value as SavedExternalRecord;
      const canonicalUrl =
        ext.normalizedUrl?.trim() || ext.url.trim() || undefined;
      let siteLabel: string | undefined;
      if (canonicalUrl) {
        try {
          siteLabel = new URL(canonicalUrl).hostname;
        } catch {
          siteLabel = undefined;
        }
      }

      return {
        kind: "external",
        title: previewTitleForExternal(ext),
        subtitle: ext.excerpt?.slice(0, 200),
        href: ext.normalizedUrl || ext.url,
        imageHref: ext.image?.trim(),
        canonicalUrl,
        siteLabel,
      };
    }
    return {
      kind: "record",
      title: pickPostText(direct.value),
      subtitle: v.$type,
    };
  }

  return { kind: "unknown", title: subjectUri };
}
