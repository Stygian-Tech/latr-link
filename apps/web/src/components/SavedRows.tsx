"use client";

import { type MouseEvent, type ReactElement, useState } from "react";

import { parsedHttpHttpsUrl } from "@/components/EmbeddedPageDialog";
import { useOpenEmbeddedReader } from "@/contexts/embeddedReader";
import {
  useSavedLibrary,
  useSavedLibraryMutations,
  type SavedRow,
} from "@/hooks/useSavedLibrary";
import { rkeyFromAtUri } from "@/lib/rkey";
import { isEnvironmentBannerShown } from "@/lib/environmentBanner";
import type { ResolvedPreview } from "@/lib/resolveSubject";
import { Archive, ArchiveRestore, Link2, Trash2 } from "lucide-react";

const showSavedStorageDevHint = isEnvironmentBannerShown();

function devSavedStorageLabel(kind: ResolvedPreview["kind"]) {
  return kind === "external" ? "External" : "AT Record";
}

function SavedLinkThumbnailPlaceholder() {
  return (
    <div
      role="img"
      aria-label="No Preview Image"
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-100 text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900/70 dark:text-zinc-500"
    >
      <Link2 className="h-6 w-6" aria-hidden strokeWidth={1.75} />
    </div>
  );
}

function siteOrigin(canonical?: string): string | undefined {
  if (!canonical) return undefined;
  try {
    return new URL(canonical).origin;
  } catch {
    return undefined;
  }
}

function faviconUrlForOrigin(origin: string): string {
  return `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(origin)}`;
}

function savedAtShort(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 19);
  }
}

const savedRowIconButtonClass =
  "inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-zinc-300 text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800";

const savedRowDangerButtonClass =
  "inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-red-300 bg-red-50 text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400 dark:hover:bg-red-950/80";

function filterRows(
  rows: SavedRow[] | undefined,
  mode: "unread" | "archive"
): SavedRow[] {
  if (!rows) return [];
  return rows.filter((row) => {
    const state = row.rec.value.state ?? "unread";
    if (mode === "unread") return state !== "archived";
    return state === "archived";
  });
}

function mutationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something Went Wrong";
}

export function SavedRows({ mode }: { mode: "unread" | "archive" }) {
  const { data, isLoading, error } = useSavedLibrary();
  const mutations = useSavedLibraryMutations();
  const openEmbeddedReader = useOpenEmbeddedReader();

  const rows = filterRows(data, mode);

  let main: ReactElement;
  if (isLoading) {
    main = <p className="p-4 text-sm text-zinc-500">Loading Saved Items…</p>;
  } else if (error) {
    main = (
      <p className="p-4 text-sm text-red-600">
        {error instanceof Error ? error.message : "Failed to Load"}
      </p>
    );
  } else if (!rows.length) {
    main = (
      <p className="p-6 text-sm text-zinc-500">
        {mode === "unread"
          ? "Nothing in Your Queue Yet. Paste a URL or AT URI Above to Save It."
          : "Archive Is Empty."}
      </p>
    );
  } else {
    main = (
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {rows.map((row) => (
          <SavedRowItem
            key={row.rec.uri}
            row={row}
            canMutate={mutations.canMutate}
            onArchiveToggle={mutations.setItemState}
            onRemove={mutations.unsave}
            onOpenEmbedded={openEmbeddedReader}
          />
        ))}
      </ul>
    );
  }

  return main;
}

function activateSavedHref(
  rawHref: string,
  previewTitle: string,
  openEmbedded: (url: string, title: string) => void,
  modifiers: Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey" | "altKey">
): void {
  if (modifiers.metaKey || modifiers.ctrlKey || modifiers.shiftKey || modifiers.altKey) {
    const http = parsedHttpHttpsUrl(rawHref);
    window.open(http?.href ?? rawHref, "_blank", "noopener,noreferrer");
    return;
  }
  const parsed = parsedHttpHttpsUrl(rawHref);
  if (parsed) openEmbedded(parsed.href, previewTitle || "Saved Link");
  else window.open(rawHref, "_blank", "noopener,noreferrer");
}

function SavedRowItem({
  row,
  canMutate,
  onArchiveToggle,
  onRemove,
  onOpenEmbedded,
}: {
  row: SavedRow;
  canMutate: boolean;
  onArchiveToggle: (
    itemRkey: string,
    state: "unread" | "archived"
  ) => Promise<void>;
  onRemove: (itemRkey: string) => Promise<void>;
  onOpenEmbedded: (url: string, title: string) => void;
}) {
  const itemRkey = rkeyFromAtUri(row.rec.uri);
  const href = row.preview.href ?? row.rec.value.subjectUri;
  const p = row.preview;
  const origin = siteOrigin(p.canonicalUrl);
  const thumb = p.imageHref;
  const [busy, setBusy] = useState(false);
  const isArchived = row.rec.value.state === "archived";

  const openLabel = `Open Saved Link: ${p.title}`;

  return (
    <li className="group relative flex flex-col gap-3 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 sm:flex-row sm:items-stretch sm:gap-4">
      <button
        type="button"
        aria-label={openLabel}
        onClick={(e) =>
          activateSavedHref(href, p.title, onOpenEmbedded, e)
        }
        onAuxClick={(e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          const http = parsedHttpHttpsUrl(href);
          window.open(http?.href ?? href, "_blank", "noopener,noreferrer");
        }}
        className="absolute inset-0 z-0 cursor-pointer rounded-md border-0 bg-transparent text-left outline-offset-2 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-500"
      />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-3 pointer-events-none sm:flex-row sm:items-center sm:gap-4">
        <div className="shrink-0 self-start sm:self-center">
          {thumb ? (
            <div className="inline-flex max-h-[4.75rem] max-w-[min(100%,11rem)] shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 p-px dark:border-zinc-700 dark:bg-zinc-900/65">
              {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote OG image URLs */}
              <img
                src={thumb}
                alt=""
                loading="lazy"
                className="block max-h-[4.5rem] max-w-full h-auto w-auto object-contain"
              />
            </div>
          ) : (
            <SavedLinkThumbnailPlaceholder />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-w-0 items-start gap-2">
            {origin ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- favicon resolver origin */}
                <img
                  src={faviconUrlForOrigin(origin)}
                  alt=""
                  width={16}
                  height={16}
                  loading="lazy"
                  className="mt-1 h-4 w-4 shrink-0"
                />
              </>
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="font-medium leading-snug text-zinc-900 underline-offset-4 group-hover:underline dark:text-zinc-100">
                {p.title}
              </p>
              {p.subtitle && (
                <p className="mt-0.5 line-clamp-2 text-sm text-zinc-500">
                  {p.subtitle}
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
                <span className="min-w-0 truncate">
                  {(p.siteLabel ?? p.kind) +
                    " · " +
                    savedAtShort(row.rec.value.savedAt)}
                </span>
                {showSavedStorageDevHint ? (
                  <span
                    title={
                      p.kind === "external"
                        ? "Saved Via com.latr.saved.external Wrapper"
                        : "Saved Subject Is a Native at:// Record Reference"
                    }
                    className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${
                      p.kind === "external"
                        ? "border border-amber-700/55 bg-amber-100 text-amber-950 dark:border-amber-500/60 dark:bg-amber-950/55 dark:text-amber-50"
                        : "border border-violet-700/55 bg-violet-100 text-violet-950 dark:border-violet-500/60 dark:bg-violet-950/55 dark:text-violet-50"
                    }`}
                  >
                    {devSavedStorageLabel(p.kind)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
      {canMutate ? (
        <div className="relative z-10 flex shrink-0 flex-row items-center gap-2 self-end pointer-events-auto sm:self-center">
          <button
            type="button"
            className={savedRowIconButtonClass}
            disabled={busy}
            aria-label={isArchived ? "Unarchive" : "Archive"}
            title={isArchived ? "Unarchive" : "Archive"}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              const next = isArchived ? "unread" : "archived";
              try {
                await onArchiveToggle(itemRkey, next);
              } catch (error) {
                window.alert(mutationErrorMessage(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            {isArchived ? (
              <ArchiveRestore className="h-4 w-4" aria-hidden strokeWidth={2} />
            ) : (
              <Archive className="h-4 w-4" aria-hidden strokeWidth={2} />
            )}
          </button>
          <button
            type="button"
            className={savedRowDangerButtonClass}
            disabled={busy}
            aria-label="Remove From Library"
            title="Remove From Library"
            onClick={async () => {
              if (busy) return;
              const ok = window.confirm(
                "Remove This Saved Item From Your Library? This Cannot Be Undone."
              );
              if (!ok) return;
              setBusy(true);
              try {
                await onRemove(itemRkey);
              } catch (error) {
                window.alert(mutationErrorMessage(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden strokeWidth={2} />
          </button>
        </div>
      ) : null}
    </li>
  );
}
