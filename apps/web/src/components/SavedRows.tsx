"use client";

import { useLatrRepo } from "@/hooks/useLatrRepo";
import {
  useInvalidateSavedLibrary,
  useSavedLibrary,
  type SavedRow,
} from "@/hooks/useSavedLibrary";
import { rkeyFromAtUri } from "@/lib/rkey";
import { Archive, ArchiveRestore, Link2, Trash2 } from "lucide-react";

function SavedLinkThumbnailPlaceholder() {
  return (
    <div
      role="img"
      aria-label="No preview image"
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
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 19);
  }
}

const savedRowIconButtonClass =
  "inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-zinc-300 text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800";

const savedRowDangerButtonClass =
  "inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-red-300 bg-red-50 text-red-700 transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400 dark:hover:bg-red-950/80";

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

export function SavedRows({ mode }: { mode: "unread" | "archive" }) {
  const { data, isLoading, error } = useSavedLibrary();
  const repo = useLatrRepo();
  const invalidate = useInvalidateSavedLibrary();

  const rows = filterRows(data, mode);

  if (isLoading) {
    return (
      <p className="p-4 text-sm text-zinc-500">Loading saved items…</p>
    );
  }

  if (error) {
    return (
      <p className="p-4 text-sm text-red-600">
        {error instanceof Error ? error.message : "Failed to load"}
      </p>
    );
  }

  if (!rows.length) {
    return (
      <p className="p-6 text-sm text-zinc-500">
        {mode === "unread"
          ? "Nothing in your queue yet. Paste a URL above to save it."
          : "Archive is empty."}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {rows.map((row) => (
        <SavedRowItem
          key={row.rec.uri}
          row={row}
          repo={repo}
          onChanged={() => invalidate()}
        />
      ))}
    </ul>
  );
}

function SavedRowItem({
  row,
  repo,
  onChanged,
}: {
  row: SavedRow;
  repo: ReturnType<typeof useLatrRepo>;
  onChanged: () => void;
}) {
  const itemRkey = rkeyFromAtUri(row.rec.uri);
  const href = row.preview.href ?? row.rec.value.subjectUri;
  const p = row.preview;
  const origin = siteOrigin(p.canonicalUrl);
  const thumb = p.imageHref;

  const openLabel = `Open saved link: ${p.title}`;

  return (
    <li className="group relative flex flex-col gap-3 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 sm:flex-row sm:items-stretch sm:gap-4">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={openLabel}
        className="absolute inset-0 z-0 rounded-md outline-offset-2 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-500"
      />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-3 pointer-events-none sm:flex-row sm:items-center sm:gap-4">
        <div className="shrink-0 self-start sm:self-center">
          {thumb ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote OG image URLs */}
              <img
                src={thumb}
                alt=""
                width={56}
                height={56}
                loading="lazy"
                className="h-14 w-14 rounded-md border border-zinc-200 object-cover dark:border-zinc-700"
              />
            </>
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
              <p className="mt-1 truncate text-xs text-zinc-400">
                {(p.siteLabel ?? p.kind) +
                  " · " +
                  savedAtShort(row.rec.value.savedAt)}
              </p>
            </div>
          </div>
        </div>
      </div>
      {repo ? (
        <div className="relative z-10 flex shrink-0 flex-row items-center gap-2 self-end pointer-events-auto sm:self-center">
          <button
            type="button"
            className={savedRowIconButtonClass}
            aria-label={
              row.rec.value.state === "archived" ? "Unarchive" : "Archive"
            }
            title={row.rec.value.state === "archived" ? "Unarchive" : "Archive"}
            onClick={async () => {
              const next =
                row.rec.value.state === "archived" ? "unread" : "archived";
              await repo.setItemState(itemRkey, next);
              onChanged();
            }}
          >
            {row.rec.value.state === "archived" ? (
              <ArchiveRestore className="h-4 w-4" aria-hidden strokeWidth={2} />
            ) : (
              <Archive className="h-4 w-4" aria-hidden strokeWidth={2} />
            )}
          </button>
          <button
            type="button"
            className={savedRowDangerButtonClass}
            aria-label="Remove from library"
            title="Remove from library"
            onClick={async () => {
              const ok = window.confirm(
                "Remove this saved item from your library? This cannot be undone."
              );
              if (!ok) return;
              await repo.unsave(itemRkey);
              onChanged();
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden strokeWidth={2} />
          </button>
        </div>
      ) : null}
    </li>
  );
}
