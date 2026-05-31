import { AtUri } from "@atproto/syntax";
import {
  COLLECTION_SAVED_EXTERNAL,
  type SavedExternalRecord,
  type SavedItemRecord,
} from "@/lib/latrRecords";
import type { RepoRecord } from "@/lib/latrRepo";

import { publicAppviewAgent } from "@/lib/appview";
import type { LatrRepo } from "@/lib/latrRepo";
import {
  previewCacheFingerprint,
  readCachedSubjectPreview,
  writeCachedSubjectPreview,
} from "@/lib/savedPreviewCache";

function previewTitleForExternal(rec: SavedExternalRecord): string {
  return (
    rec.title?.trim() ||
    rec.site?.trim() ||
    rec.normalizedUrl ||
    rec.url ||
    "Saved Link"
  );
}

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
  /** Cached Open Graph author when available */
  authorLabel?: string;
}

function previewSubtitle(excerpt?: string, author?: string): string | undefined {
  const trimmedExcerpt = excerpt?.trim();
  if (trimmedExcerpt) return trimmedExcerpt.slice(0, 200);

  const trimmedAuthor = author?.trim();
  if (trimmedAuthor) {
    return trimmedAuthor.startsWith("@")
      ? trimmedAuthor
      : `By ${trimmedAuthor}`;
  }

  return undefined;
}

export function isExternalWrapperUri(subjectUri: string): boolean {
  try {
    return new AtUri(subjectUri).collection === COLLECTION_SAVED_EXTERNAL;
  } catch {
    return false;
  }
}

export function savedItemHasProtocolPreview(item: SavedItemRecord): boolean {
  return Boolean(
    item.previewTitle?.trim() ||
      item.previewImage?.trim() ||
      item.previewAuthor?.trim() ||
      item.previewExcerpt?.trim() ||
      item.previewSite?.trim()
  );
}

/** Build a row preview from on-protocol `com.latr.saved.item` fields (no network). */
export function previewFromSavedItemRecord(
  rec: RepoRecord<SavedItemRecord>
): ResolvedPreview | null {
  const item = rec.value;
  const linked = item.linkedWebUrl?.trim();
  const external = isExternalWrapperUri(item.subjectUri);

  if (!external && !linked && !savedItemHasProtocolPreview(item)) {
    return null;
  }

  const canonicalUrl = linked || undefined;
  let siteLabel = item.previewSite?.trim();
  if (!siteLabel && canonicalUrl) {
    try {
      siteLabel = new URL(canonicalUrl).hostname;
    } catch {
      siteLabel = undefined;
    }
  }

  const title =
    item.previewTitle?.trim() ||
    (external && linked ? linked : undefined) ||
    item.subjectUri;

  return {
    kind: external || linked ? "external" : "record",
    title,
    subtitle: previewSubtitle(item.previewExcerpt, item.previewAuthor),
    href: canonicalUrl || (external ? linked : undefined),
    imageHref: item.previewImage?.trim(),
    canonicalUrl,
    siteLabel,
    authorLabel: item.previewAuthor?.trim(),
  };
}

/** Prefer cached protocol preview metadata; fetch Bluesky/external records only when needed. */
export async function resolveSubjectPreviewForRow(
  repo: LatrRepo,
  rec: RepoRecord<SavedItemRecord>
): Promise<ResolvedPreview> {
  const { subjectUri } = rec.value;
  const fingerprint = previewCacheFingerprint(rec.value);
  const cached = readCachedSubjectPreview(subjectUri, fingerprint);
  if (cached) return cached;

  if (savedItemHasProtocolPreview(rec.value)) {
    const fromProtocol = previewFromSavedItemRecord(rec);
    if (fromProtocol) {
      const merged = mergeSavedItemOgPreview(fromProtocol, rec.value);
      writeCachedSubjectPreview(subjectUri, fingerprint, merged);
      return merged;
    }
  }

  const base = await resolveSubjectPreview(repo, subjectUri);
  const merged = mergeSavedItemOgPreview(base, rec.value);
  writeCachedSubjectPreview(subjectUri, fingerprint, merged);
  return merged;
}

/** Prefer cached OG fields from `com.latr.saved.item` when the user saved from a web URL. */
export function mergeSavedItemOgPreview(
  preview: ResolvedPreview,
  item: SavedItemRecord
): ResolvedPreview {
  const linked = item.linkedWebUrl?.trim();
  if (
    !linked &&
    !item.previewTitle?.trim() &&
    !item.previewImage?.trim() &&
    !item.previewExcerpt?.trim() &&
    !item.previewSite?.trim() &&
    !item.previewAuthor?.trim()
  ) {
    return preview;
  }

  const canonicalUrl =
    linked || preview.canonicalUrl || preview.href?.trim();

  let siteLabel = preview.siteLabel;
  if (item.previewSite?.trim()) {
    siteLabel = item.previewSite.trim();
  } else if (canonicalUrl && !siteLabel) {
    try {
      siteLabel = new URL(canonicalUrl).hostname;
    } catch {
      siteLabel = siteLabel ?? undefined;
    }
  }

  const authorLabel = item.previewAuthor?.trim() || preview.authorLabel;

  return {
    ...preview,
    title: item.previewTitle?.trim() || preview.title,
    subtitle:
      previewSubtitle(item.previewExcerpt, item.previewAuthor) ||
      preview.subtitle,
    imageHref: item.previewImage?.trim() || preview.imageHref,
    canonicalUrl:
      canonicalUrl === undefined ? preview.canonicalUrl : canonicalUrl,
    siteLabel,
    authorLabel,
    href: linked?.trim() || preview.href,
  };
}

function pickPostText(record: unknown): string {
  if (!record || typeof record !== "object") return "ATProto Post";
  const r = record as { text?: string; title?: string };
  const t = r.title ?? r.text?.slice(0, 160);
  return t?.trim() || "ATProto Post";
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
        subtitle: previewSubtitle(ext.excerpt, ext.author),
        href: ext.normalizedUrl || ext.url,
        imageHref: ext.image?.trim(),
        canonicalUrl,
        siteLabel,
        authorLabel: ext.author?.trim(),
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
