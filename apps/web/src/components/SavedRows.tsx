"use client";

import {
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  FileText,
  Link2,
  MessageCircle,
  Bookmark,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { parsedHttpHttpsUrl } from "@/components/EmbeddedPageDialog";
import { useOpenEmbeddedReader } from "@/contexts/embeddedReader";
import {
  useSavedLibrary,
  useSavedLibraryMutations,
  type SavedRow,
} from "@/hooks/useSavedLibrary";
import { readingMinutesForRow } from "@/lib/demoLibrary";
import { rkeyFromAtUri } from "@/lib/rkey";
import { isEnvironmentBannerShown } from "@/lib/environmentBanner";
import type { ResolvedPreview } from "@/lib/resolveSubject";
import {
  filterSavedRowsByContent,
  savedRowContentBucket,
  type SavedRowsFilter,
} from "@/lib/savedRowContent";
import { cn } from "@/lib/utils";

const showSavedStorageDevHint = isEnvironmentBannerShown();

function devSavedStorageLabel(kind: ResolvedPreview["kind"]) {
  return kind === "external" ? "External" : "AT Record";
}

function contentTypeIcon(bucket: Exclude<SavedRowsFilter, "all">): {
  Icon: LucideIcon;
  label: string;
} {
  if (bucket === "article") return { Icon: FileText, label: "Article" };
  if (bucket === "social") return { Icon: MessageCircle, label: "Social" };
  return { Icon: Bookmark, label: "Other" };
}

function SavedLinkThumbnailPlaceholder({ kind }: { kind: ResolvedPreview["kind"] }) {
  const Icon = kind === "post" ? MessageCircle : kind === "record" ? FileText : Link2;
  return (
    <div
      role="img"
      aria-label="No Preview Image"
      className="flex aspect-[1.08] w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted text-muted-foreground"
    >
      <Icon className="size-6" aria-hidden strokeWidth={1.75} />
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

export function savedAtShort(iso: string | null | undefined): string {
  if (!iso) return "Date unavailable";

  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function filterSavedRows(
  rows: SavedRow[] | undefined,
  mode: "unread" | "archive"
): SavedRow[] {
  if (!rows) return [];
  return rows.filter((row) => {
    const state = row.rec.metadataRecord?.value.state ?? "unread";
    if (mode === "unread") return state !== "archived";
    return state === "archived";
  });
}

export type SavedRowsSort = "newest" | "oldest" | "title" | "archived";

export function sortSavedRows(rows: SavedRow[], sort: SavedRowsSort): SavedRow[] {
  return [...rows].sort((a, b) => {
    if (sort === "title") {
      return a.preview.title.localeCompare(b.preview.title, "en-US", {
        sensitivity: "base",
      });
    }

    const aDate =
      sort === "archived" ? (a.local?.archivedAt ?? a.rec.value.createdAt) : a.rec.value.createdAt;
    const bDate =
      sort === "archived" ? (b.local?.archivedAt ?? b.rec.value.createdAt) : b.rec.value.createdAt;
    const aTime = Date.parse(aDate);
    const bTime = Date.parse(bDate);
    const safeATime = Number.isFinite(aTime) ? aTime : 0;
    const safeBTime = Number.isFinite(bTime) ? bTime : 0;
    return sort === "oldest" ? safeATime - safeBTime : safeBTime - safeATime;
  });
}

function mutationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something Went Wrong";
}

function LoadingRows() {
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-card">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="flex gap-3 p-2.5">
          <Skeleton className="aspect-[1.08] w-24 shrink-0" />
          <div className="flex flex-1 flex-col gap-2 py-1">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function LoadingMoreRow() {
  return (
    <div className="mt-2 flex gap-3 rounded-lg border border-border bg-card p-2.5">
      <Skeleton className="aspect-[1.08] w-24 shrink-0" />
      <div className="flex flex-1 flex-col gap-2 py-1">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

/**
 * Fires `onLoadMore` when scrolled near the viewport (600px margin covers the
 * inner scroll container — intersection accounts for ancestor clipping). Only
 * mounted while another page exists and no fetch is in flight, so a short page
 * that leaves it on-screen re-fires on remount without a new scroll event.
 */
function LoadMoreSentinel({ onLoadMore }: { onLoadMore: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "600px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (visible) onLoadMore();
  }, [visible, onLoadMore]);

  return <div ref={ref} aria-hidden className="h-px" />;
}

export function SavedRows({
  mode,
  filter = "all",
  sort = "newest",
}: {
  mode: "unread" | "archive";
  filter?: SavedRowsFilter;
  sort?: SavedRowsSort;
}) {
  const {
    data,
    isLoading,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useSavedLibrary();
  const mutations = useSavedLibraryMutations();
  const openEmbeddedReader = useOpenEmbeddedReader();

  const rows = sortSavedRows(
    filterSavedRowsByContent(filterSavedRows(data, mode), filter),
    sort
  );

  let main: ReactElement;
  if (isLoading) {
    main = <LoadingRows />;
  } else if (error) {
    main = (
      <div className="rounded-lg border border-destructive/25 bg-card p-6 text-sm text-destructive">
        {error instanceof Error ? error.message : "Failed to Load"}
      </div>
    );
  } else if (!rows.length && (hasNextPage || isFetchingNextPage)) {
    // Later pages may still hold rows for this view (e.g. archived items) —
    // keep the skeleton up and let the footer sentinel continue fetching.
    main = <LoadingRows />;
  } else if (!rows.length) {
    main = (
      <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-md bg-accent text-primary">
          <Link2 className="size-5" aria-hidden strokeWidth={1.9} />
        </div>
        <p className="mt-4 text-sm font-medium text-foreground">
          {filter !== "all"
            ? "No Matching Items."
            : mode === "unread"
              ? "Nothing in Your Queue Yet."
              : "Archive Is Empty."}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
          {filter !== "all"
            ? "Choose a different filter to return to your saved queue."
            : mode === "unread"
              ? "Paste a URL or AT URI above to save something for later."
              : "Archived reads will collect here after you clear them from Unread."}
        </p>
      </div>
    );
  } else {
    main = (
      <TooltipProvider>
        <ul className="divide-y divide-border rounded-lg border border-border bg-card shadow-sm">
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
      </TooltipProvider>
    );
  }

  let footer: ReactElement | null = null;
  if (!isLoading && !error) {
    if (isFetchingNextPage) {
      footer = rows.length ? <LoadingMoreRow /> : null;
    } else if (isFetchNextPageError) {
      footer = (
        <div className="mt-2 flex items-center justify-between rounded-lg border border-destructive/25 bg-card p-3 text-sm text-destructive">
          <span>Couldn’t Load More.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchNextPage()}
          >
            Retry
          </Button>
        </div>
      );
    } else if (hasNextPage) {
      footer = (
        <div className="mt-2 flex justify-center py-1">
          <LoadMoreSentinel onLoadMore={fetchNextPage} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fetchNextPage()}
          >
            Load More
          </Button>
        </div>
      );
    }
  }

  return (
    <>
      {main}
      {footer}
    </>
  );
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
  const href = row.preview.href ?? row.rec.value.subject;
  const p = row.preview;
  const origin = siteOrigin(p.canonicalUrl);
  const thumb = p.imageHref;
  const [busy, setBusy] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removeDialogLeft, setRemoveDialogLeft] = useState<number | null>(null);
  const isArchived = row.rec.metadataRecord?.value.state === "archived";
  const readMinutes = readingMinutesForRow(row);
  const contentType = contentTypeIcon(savedRowContentBucket(row));

  const openLabel = `Open Saved Link: ${p.title}`;
  const removeDialogStyle: CSSProperties | undefined =
    removeDialogLeft === null ? undefined : { left: removeDialogLeft };

  function openRemoveDialog(trigger: HTMLElement) {
    const contentColumn = trigger.closest("section");
    const columnRect = contentColumn?.getBoundingClientRect();
    setRemoveDialogLeft(columnRect ? columnRect.left + columnRect.width / 2 : null);
    setRemoveDialogOpen(true);
  }

  function handleRemoveDialogOpenChange(open: boolean) {
    setRemoveDialogOpen(open);
    if (!open) setRemoveDialogLeft(null);
  }

  return (
    <li className="group relative grid gap-3 p-2.5 pb-12 transition-colors hover:bg-accent/25 sm:grid-cols-[6rem_minmax(0,1fr)] sm:pb-2.5">
      <button
        type="button"
        aria-label={openLabel}
        onClick={(e) => activateSavedHref(href, p.title, onOpenEmbedded, e)}
        onAuxClick={(e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          const http = parsedHttpHttpsUrl(href);
          window.open(http?.href ?? href, "_blank", "noopener,noreferrer");
        }}
        className="absolute inset-0 z-0 cursor-pointer rounded-md border-0 bg-transparent text-left outline-offset-2 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="relative z-10 pointer-events-none">
        {thumb ? (
          <div className="flex aspect-[1.08] w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote OG image URLs */}
            <img
              src={thumb}
              alt=""
              loading="lazy"
              decoding="async"
              className="block size-full object-cover"
            />
          </div>
        ) : (
          <SavedLinkThumbnailPlaceholder kind={p.kind} />
        )}
      </div>
      <div className="relative z-10 flex min-w-0 flex-col gap-1.5 pointer-events-none sm:pr-26">
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              {origin ? (
                // eslint-disable-next-line @next/next/no-img-element -- favicon resolver origin
                <img
                  src={faviconUrlForOrigin(origin)}
                  alt=""
                  width={16}
                  height={16}
                  loading="lazy"
                  decoding="async"
                  className="size-4 shrink-0"
                />
              ) : null}
              <span className="font-medium text-foreground/80">
                {p.siteLabel ?? p.kind}
              </span>
              <span aria-hidden>•</span>
              <span>{savedAtShort(row.rec.value.createdAt)}</span>
              <span aria-hidden>•</span>
              <span>{readMinutes} min read</span>
              {isArchived ? <Badge variant="secondary">Archived</Badge> : null}
            </div>
            <p className="mt-0.5 text-base font-semibold leading-snug text-foreground underline-offset-4 group-hover:underline">
              {p.title}
            </p>
            {p.subtitle ? (
              <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                {p.subtitle}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      {showSavedStorageDevHint ? (
        <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1 pointer-events-none">
          <Badge
            variant={p.kind === "external" ? "outline" : "secondary"}
            className={cn(
              "font-mono text-[10px] uppercase",
              p.kind === "external"
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : "text-primary"
            )}
            title={
              p.kind === "external"
                ? "Saved Via link.latr.saved.external Wrapper"
                : "Saved Subject Is a Native at:// Record Reference"
            }
          >
            {devSavedStorageLabel(p.kind)}
          </Badge>
          <span
            className="inline-flex size-6 items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground"
            title={contentType.label}
            aria-label={contentType.label}
          >
            <contentType.Icon className="size-3.5" aria-hidden strokeWidth={1.9} />
          </span>
        </div>
      ) : null}
      <div className="absolute bottom-2 right-2 z-10 flex shrink-0 items-center gap-1 pointer-events-auto sm:bottom-2.5 sm:right-2.5 sm:gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Open ${p.title}`}
              title={`Open ${p.title}`}
              className="size-9 sm:size-8"
              onClick={(e) => activateSavedHref(href, p.title, onOpenEmbedded, e)}
            >
              <ExternalLink className="size-4" aria-hidden strokeWidth={1.9} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open</TooltipContent>
        </Tooltip>
        {canMutate ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  aria-label={`${isArchived ? "Unarchive" : "Archive"} ${p.title}`}
                  title={`${isArchived ? "Unarchive" : "Archive"} ${p.title}`}
                  className="size-9 sm:size-8"
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
                    <ArchiveRestore className="size-4" aria-hidden strokeWidth={1.9} />
                  ) : (
                    <Archive className="size-4" aria-hidden strokeWidth={1.9} />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isArchived ? "Unarchive" : "Archive"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  aria-label={`Remove ${p.title} From Library`}
                  title={`Remove ${p.title} From Library`}
                  className="size-9 text-destructive hover:bg-destructive/10 hover:text-destructive sm:size-8"
                  onClick={(event) => openRemoveDialog(event.currentTarget)}
                >
                  <Trash2 className="size-4" aria-hidden strokeWidth={1.9} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove</TooltipContent>
            </Tooltip>
            <AlertDialog
              open={removeDialogOpen}
              onOpenChange={handleRemoveDialogOpenChange}
              style={removeDialogStyle}
            >
              <AlertDialogContent>
                <AlertDialogHeader className="items-center text-center">
                  <AlertDialogTitle className="text-center">
                    Remove This Saved Item?
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-center">
                    <span className="block">
                      {"'Archive' clears the article from 'Unread'."}
                    </span>
                    <span className="block">
                      {"'Remove' permanently deletes the saved link."}
                    </span>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setRemoveDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  {!isArchived ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={async () => {
                        if (busy) return;
                        setBusy(true);
                        try {
                          await onArchiveToggle(itemRkey, "archived");
                          setRemoveDialogOpen(false);
                        } catch (error) {
                          window.alert(mutationErrorMessage(error));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Archive Instead
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busy}
                    onClick={async () => {
                      if (busy) return;
                      setBusy(true);
                      try {
                        await onRemove(itemRkey);
                        setRemoveDialogOpen(false);
                      } catch (error) {
                        window.alert(mutationErrorMessage(error));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Remove Permanently
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}
      </div>
    </li>
  );
}
