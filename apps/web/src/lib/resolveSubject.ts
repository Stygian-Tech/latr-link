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

/** UI / dev-label kind from the saved edge's subject URI (not linkedWebUrl). */
export function previewKindForSubjectUri(
  subjectUri: string
): ResolvedPreview["kind"] {
  if (isExternalWrapperUri(subjectUri)) return "external";
  try {
    if (new AtUri(subjectUri).collection === "app.bsky.feed.post") {
      return "post";
    }
  } catch {
    /* fall through */
  }
  return "record";
}

function subjectPreviewLooksResolved(
  preview: ResolvedPreview,
  subjectUri: string,
  item: SavedItemRecord
): boolean {
  if (preview.title.trim() === subjectUri) return false;
  return previewHasRichMetadata(preview, item);
}

/** True when the preview has more than a bare URL placeholder for a linked save. */
export function previewHasRichMetadata(
  preview: ResolvedPreview,
  item?: SavedItemRecord
): boolean {
  if (preview.kind === "unknown") return false;
  const title = preview.title.trim();
  if (!title) return false;

  if (Boolean(preview.imageHref?.trim()) || Boolean(preview.subtitle?.trim())) {
    return true;
  }

  const linked = item?.linkedWebUrl?.trim();
  if (!linked) return true;

  if (title === linked) return false;
  try {
    if (new URL(title).href === new URL(linked).href) return false;
  } catch {
    /* title is not a URL — treat as rich */
  }

  return true;
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

export function openGraphFieldsHavePreview(fields: {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  author?: string;
}): boolean {
  return Boolean(
    fields.title?.trim() ||
      fields.image?.trim() ||
      fields.description?.trim() ||
      fields.siteName?.trim() ||
      fields.author?.trim()
  );
}

function resolvedPreviewFromOpenGraphFields(
  fields: {
    title?: string;
    description?: string;
    image?: string;
    siteName?: string;
    author?: string;
  },
  item: SavedItemRecord,
  kind: ResolvedPreview["kind"]
): ResolvedPreview {
  const linked = item.linkedWebUrl?.trim();
  const canonicalUrl = linked || undefined;
  let siteLabel = fields.siteName?.trim();
  if (!siteLabel && canonicalUrl) {
    try {
      siteLabel = new URL(canonicalUrl).hostname;
    } catch {
      siteLabel = undefined;
    }
  }

  return {
    kind,
    title:
      fields.title?.trim() ||
      siteLabel ||
      canonicalUrl ||
      item.subjectUri,
    subtitle: previewSubtitle(fields.description, fields.author),
    href: canonicalUrl,
    imageHref: fields.image?.trim(),
    canonicalUrl,
    siteLabel,
    authorLabel: fields.author?.trim(),
  };
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
    kind: previewKindForSubjectUri(item.subjectUri),
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

  const subjectKind = previewKindForSubjectUri(subjectUri);
  const linked = rec.value.linkedWebUrl?.trim();

  if (savedItemHasProtocolPreview(rec.value)) {
    const fromProtocol = previewFromSavedItemRecord(rec);
    if (fromProtocol) {
      let merged = mergeSavedItemOgPreview(fromProtocol, rec.value);
      if (linked) {
        merged = await backfillPreviewFromOpenGraph(repo, merged, linked);
      }
      writeCachedSubjectPreview(subjectUri, fingerprint, merged);
      return merged;
    }
  }

  if (linked && !savedItemHasProtocolPreview(rec.value)) {
    const og = await repo.fetchOpenGraphPreview(linked);
    if (og && openGraphFieldsHavePreview(og)) {
      const fromOg = mergeSavedItemOgPreview(
        resolvedPreviewFromOpenGraphFields(og, rec.value, subjectKind),
        rec.value
      );
      writeCachedSubjectPreview(subjectUri, fingerprint, fromOg);
      return fromOg;
    }
  }

  const fromSubject = await resolveSubjectPreview(repo, subjectUri);
  if (subjectPreviewLooksResolved(fromSubject, subjectUri, rec.value)) {
    const merged = mergeSavedItemOgPreview(
      {
        ...fromSubject,
        kind:
          fromSubject.kind !== "unknown" ? fromSubject.kind : subjectKind,
      },
      rec.value
    );
    writeCachedSubjectPreview(subjectUri, fingerprint, merged);
    return merged;
  }

  if (linked && !previewHasRichMetadata(
    mergeSavedItemOgPreview({ ...fromSubject, kind: subjectKind }, rec.value),
    rec.value
  )) {
    const og = await repo.fetchOpenGraphPreview(linked);
    if (og && openGraphFieldsHavePreview(og)) {
      const fromOg = mergeSavedItemOgPreview(
        resolvedPreviewFromOpenGraphFields(og, rec.value, subjectKind),
        rec.value
      );
      writeCachedSubjectPreview(subjectUri, fingerprint, fromOg);
      return fromOg;
    }
  }

  const merged = mergeSavedItemOgPreview(
    { ...fromSubject, kind: subjectKind },
    rec.value
  );
  writeCachedSubjectPreview(subjectUri, fingerprint, merged);
  return merged;
}

async function backfillPreviewFromOpenGraph(
  repo: LatrRepo,
  preview: ResolvedPreview,
  linkedWebUrl: string
): Promise<ResolvedPreview> {
  const weakTitle = isWeakPreviewTitle(
    preview.title,
    preview.siteLabel,
    linkedWebUrl
  );
  const missingImage = !preview.imageHref?.trim();
  if (!weakTitle && !missingImage) return preview;

  const og = await repo.fetchOpenGraphPreview(linkedWebUrl);
  if (!og) return preview;

  const ogTitle = og.title?.trim();
  const ogImage = og.image?.trim();

  return {
    ...preview,
    title: weakTitle && ogTitle ? ogTitle : preview.title,
    imageHref: missingImage && ogImage ? ogImage : preview.imageHref,
    subtitle:
      preview.subtitle || previewSubtitle(og.description, og.author),
    siteLabel: preview.siteLabel || og.siteName?.trim(),
    authorLabel: preview.authorLabel || og.author?.trim(),
  };
}

function isWeakPreviewTitle(
  title: string,
  siteLabel: string | undefined,
  linkedWebUrl: string
): boolean {
  const trimmed = title.trim();
  if (!trimmed) return true;

  let hostname: string | undefined;
  try {
    hostname = new URL(linkedWebUrl).hostname.replace(/^www\./i, "");
  } catch {
    hostname = undefined;
  }

  const lower = trimmed.toLowerCase();
  if (siteLabel && lower === siteLabel.trim().toLowerCase()) return true;
  if (hostname && lower === hostname.toLowerCase()) return true;

  const genericTitles = ["home", "homepage", "the verge", "verge", "news", "latest"];
  if (genericTitles.includes(lower)) return true;

  return false;
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
