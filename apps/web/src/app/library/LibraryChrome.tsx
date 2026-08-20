"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";

import {
  Archive,
  Beaker,
  Inbox,
  LogOut,
  Menu,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  Settings,
  Tag,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

import { BrandLockup } from "@/components/BrandLockup";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { EmbeddedReaderPortal } from "@/contexts/embeddedReader";
import { useAuth } from "@/hooks/useAuth";
import {
  BulkTagOperationError,
  type BulkTagProgress,
  useBookmarkTagInventory,
  useBulkBookmarkTagMutation,
} from "@/hooks/useBookmarkTags";
import { useSavedLibrary } from "@/hooks/useSavedLibrary";
import { useViewerProfile } from "@/hooks/useViewerProfile";
import { DEMO_HANDLE, isLatrDemoDataEnabled } from "@/lib/demoMode";
import { normalizeBookmarkTags } from "@/lib/bookmarkTags";
import {
  libraryHrefWithTag,
  selectedBookmarkTag,
} from "@/lib/tagFilterUrl";
import { cn } from "@/lib/utils";

const LIBRARY_NAV_ID = "library-primary-nav";
const LIBRARY_MOBILE_NAV_ID = "library-mobile-nav";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  count?: number;
};

function ProfileSkeleton() {
  return (
    <div className="flex min-w-0 items-center gap-2 px-2 py-1.5">
      <Skeleton className="size-9 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-36" />
      </div>
    </div>
  );
}

function useLibraryNav(): NavItem[] {
  const { data } = useSavedLibrary({ ignoreTag: true });
  return useMemo(() => {
    const unread =
      data?.filter((row) => (row.rec.metadataRecord?.value.state ?? "unread") !== "archived")
        .length ?? undefined;
    return [
      { href: "/library", label: "Unread", icon: Inbox, count: unread },
      { href: "/library/archive", label: "Archive", icon: Archive },
      { href: "/library/settings", label: "Settings", icon: Settings },
    ];
  }, [data]);
}

function SidebarTags({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTag = selectedBookmarkTag(searchParams);
  const inventory = useBookmarkTagInventory();
  const bulk = useBulkBookmarkTagMutation();
  const [dialog, setDialog] = useState<
    | { kind: "rename"; tag: string }
    | { kind: "delete"; tag: string }
    | null
  >(null);
  const [replacement, setReplacement] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BulkTagProgress | null>(null);
  const [operationError, setOperationError] = useState<BulkTagOperationError | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  function openDialog(next: NonNullable<typeof dialog>) {
    setDialog(next);
    setReplacement("");
    setProgress(null);
    setOperationError(null);
    setValidationError(null);
  }

  async function runOperation(resume = false) {
    if (!dialog || busy) return;
    let operation:
      | { kind: "rename"; tag: string; replacement: string }
      | { kind: "delete"; tag: string };
    try {
      if (dialog.kind === "rename") {
        const [source] = normalizeBookmarkTags([dialog.tag]);
        const [target] = normalizeBookmarkTags([replacement]);
        if (source === target) {
          throw new Error("Choose a different replacement tag.");
        }
        operation = { kind: "rename", tag: source, replacement: target };
      } else {
        operation = { kind: "delete", tag: dialog.tag };
      }
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Invalid tag.");
      return;
    }

    setBusy(true);
    setValidationError(null);
    try {
      await bulk.run(operation, {
        ...(resume && operationError?.resumeCursor
          ? { resumeCursor: operationError.resumeCursor }
          : {}),
        ...(resume && operationError?.progress
          ? { initialProgress: operationError.progress }
          : {}),
        onProgress: setProgress,
      });
      if (activeTag === operation.tag) {
        router.replace(
          libraryHrefWithTag(
            pathname,
            searchParams,
            operation.kind === "rename" ? operation.replacement : undefined
          )
        );
      }
      setDialog(null);
      setOperationError(null);
    } catch (error) {
      if (error instanceof BulkTagOperationError) {
        setProgress(error.progress);
        setOperationError(error);
      } else {
        setValidationError(error instanceof Error ? error.message : "Tag operation failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={mobile ? "mobile-tags-heading" : "tags-heading"} className="min-h-0">
      <div className="mb-1.5 flex items-center justify-between px-2.5">
        <h2
          id={mobile ? "mobile-tags-heading" : "tags-heading"}
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Tags
        </h2>
        {inventory.isFetching && !inventory.isLoading ? (
          <RefreshCw className="size-3 animate-spin text-muted-foreground" aria-label="Refreshing tags" />
        ) : null}
      </div>
      {inventory.error && !inventory.tags.length ? (
        <div className="mx-2 rounded-md border border-destructive/25 p-2 text-xs text-destructive">
          <p>Couldn’t load the complete tag list.</p>
          <Button type="button" variant="ghost" size="sm" className="mt-1 h-7" onClick={() => void inventory.retry()}>
            Retry
          </Button>
        </div>
      ) : inventory.isLoading ? (
        <div className="space-y-1 px-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-4/5" />
        </div>
      ) : (
        <>
          {inventory.error ? (
            <div className="mx-2 mb-1 rounded-md border border-destructive/25 p-2 text-xs text-destructive">
              <p>Showing the last complete tag list.</p>
              <Button type="button" variant="ghost" size="sm" className="mt-1 h-7" onClick={() => void inventory.retry()}>
                Retry
              </Button>
            </div>
          ) : null}
          <div className={cn("overflow-y-auto", mobile ? "max-h-64" : "max-h-52")}>
          <Link
            href={libraryHrefWithTag(pathname, searchParams, undefined)}
            onClick={onNavigate}
            className={cn(
              "flex h-8 items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors",
              !activeTag
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground"
            )}
          >
            <Tag className="size-3.5" aria-hidden />
            <span className="flex-1 truncate">All tags</span>
          </Link>
          {inventory.tags.map(({ tag, count }) => (
            <div key={tag} className="group flex items-center gap-0.5">
              <Link
                href={libraryHrefWithTag(pathname, searchParams, tag)}
                onClick={onNavigate}
                className={cn(
                  "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 text-sm transition-colors",
                  activeTag === tag
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground"
                )}
              >
                <span className="min-w-0 flex-1 truncate">{tag}</span>
                <span className="text-xs tabular-nums">{count}</span>
              </Link>
              {bulk.canMutate ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label={`Rename ${tag}`}
                    title={`Rename ${tag}`}
                    onClick={() => openDialog({ kind: "rename", tag })}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-destructive hover:text-destructive"
                    aria-label={`Delete tag ${tag}`}
                    title={`Delete tag ${tag}`}
                    onClick={() => openDialog({ kind: "delete", tag })}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </>
              ) : null}
            </div>
          ))}
          {!inventory.tags.length ? (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">Tags you add to bookmarks will appear here.</p>
          ) : null}
          </div>
        </>
      )}

      <AlertDialog open={dialog !== null} onOpenChange={(open) => !open && !busy && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog?.kind === "rename" ? `Rename “${dialog.tag}”` : `Delete “${dialog?.tag ?? ""}”`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog?.kind === "rename"
                ? "This updates the tag across your complete bookmark library in resumable batches."
                : "This removes the tag from bookmarks; it does not delete the bookmarks themselves."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dialog?.kind === "rename" ? (
            <div className="space-y-1.5">
              <label htmlFor="rename-bookmark-tag" className="text-sm font-medium">Replacement tag</label>
              <Input
                id="rename-bookmark-tag"
                value={replacement}
                onChange={(event) => setReplacement(event.target.value)}
                disabled={busy}
                autoFocus
              />
            </div>
          ) : null}
          {progress ? (
            <p className="text-sm text-muted-foreground" role="status">
              Scanned {progress.scanned}; updated {progress.updated}. Pass {Math.min(progress.convergencePass, 3)} of 3.
            </p>
          ) : null}
          {operationError ? (
            <p className="text-sm text-destructive" role="alert">
              {operationError.message} {progress ? `${progress.updated} updates were acknowledged.` : ""}
            </p>
          ) : validationError ? (
            <p className="text-sm text-destructive" role="alert">{validationError}</p>
          ) : null}
          <AlertDialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>
              Cancel
            </Button>
            {operationError ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() => void runOperation(Boolean(operationError.resumeCursor))}
              >
                {busy
                  ? operationError.resumeCursor
                    ? "Resuming…"
                    : "Retrying…"
                  : operationError.resumeCursor
                    ? "Resume"
                    : "Retry"}
              </Button>
            ) : (
              <Button
                type="button"
                variant={dialog?.kind === "delete" ? "destructive" : "default"}
                disabled={busy || (dialog?.kind === "rename" && !replacement.trim())}
                onClick={() => void runOperation(false)}
              >
                {busy ? "Updating…" : dialog?.kind === "delete" ? "Remove Tag" : "Rename Tag"}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function SidebarNav({
  id = LIBRARY_NAV_ID,
  mobile = false,
  pathname,
  onNavigate,
}: {
  id?: string;
  mobile?: boolean;
  pathname: string;
  onNavigate?: () => void;
}) {
  const nav = useLibraryNav();
  const searchParams = useSearchParams();
  const activeTag = selectedBookmarkTag(searchParams);

  return (
    <nav
      id={id}
      className={cn("flex flex-col", mobile ? "gap-1.5" : "gap-0.5")}
      aria-label="Library"
    >
      {nav.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={
              item.href === "/library" || item.href === "/library/archive"
                ? libraryHrefWithTag(item.href, searchParams, activeTag)
                : item.href
            }
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-md font-medium transition-colors",
              mobile ? "min-h-11 px-3 text-base" : "h-9 px-2.5 text-sm",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground"
            )}
          >
            <item.icon className="size-4" aria-hidden strokeWidth={1.9} />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {typeof item.count === "number" ? (
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  mobile ? "text-base" : "text-sm",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                {item.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarBrand({ mobile = false }: { mobile?: boolean }) {
  return (
    <BrandLockup
      href="/library"
      iconSize={mobile ? 28 : 30}
      className={cn("px-2 py-1", mobile && "min-w-0 flex-1")}
      textClassName={mobile ? "text-lg" : "text-xl"}
    />
  );
}

function DemoStatus({ mobile = false }: { mobile?: boolean }) {
  if (!isLatrDemoDataEnabled()) return null;
  return (
    <div
      className={cn(
        "rounded-lg border border-primary/15 bg-accent text-sm",
        mobile ? "p-3" : "p-2.5"
      )}
    >
      <div className="flex items-center gap-2 font-medium text-primary">
        <Beaker className="size-4" aria-hidden strokeWidth={1.9} />
        <span>Local Data Mode</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
        <span>Using Local Data</span>
        <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
      </div>
    </div>
  );
}

function ProfileBlock({
  closeMobileNav,
  mobile = false,
}: {
  closeMobileNav?: () => void;
  mobile?: boolean;
}) {
  const { session, signOut } = useAuth();
  const { data: profile, isLoading } = useViewerProfile();
  const demoMode = isLatrDemoDataEnabled();

  const avatarAlt =
    profile?.displayName?.trim() ||
    profile?.handle ||
    session?.did ||
    "Account";
  const primaryLine =
    profile?.displayName?.trim() ||
    profile?.handle ||
    (demoMode ? DEMO_HANDLE : session?.did) ||
    "Reader";
  const secondaryLine = profile?.handle || (demoMode ? DEMO_HANDLE : session?.did);

  if (isLoading && session?.did) return <ProfileSkeleton />;

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg",
        mobile ? "px-2 py-2" : "px-1.5 py-1"
      )}
    >
      <UserAvatar
        src={profile?.avatar}
        alt={avatarAlt}
        size={mobile ? 40 : 36}
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate font-semibold leading-tight text-foreground",
            mobile ? "text-base" : "text-sm"
          )}
        >
          {primaryLine}
        </p>
        <p className="truncate text-xs leading-tight text-muted-foreground">
          {secondaryLine}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Sign Out"
        title="Sign Out"
        className={cn(mobile && "size-10")}
        onClick={() => {
          closeMobileNav?.();
          void signOut();
        }}
      >
        <LogOut className="size-4" aria-hidden strokeWidth={1.9} />
      </Button>
    </div>
  );
}

function SidebarBody({
  mobile = false,
  onNavigate,
  onFeedback,
  headerAction,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
  onFeedback: () => void;
  headerAction?: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col",
        mobile ? "gap-4 p-4" : "gap-3 p-3"
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <SidebarBrand mobile={mobile} />
        {headerAction}
      </div>
      <SidebarNav
        id={mobile ? LIBRARY_MOBILE_NAV_ID : LIBRARY_NAV_ID}
        mobile={mobile}
        pathname={pathname}
        onNavigate={onNavigate}
      />
      <SidebarTags mobile={mobile} onNavigate={onNavigate} />
      <button
        type="button"
        onClick={onFeedback}
        className={cn(
          "flex items-center gap-2.5 rounded-md font-medium text-muted-foreground transition-colors hover:bg-accent/70 hover:text-accent-foreground",
          mobile ? "min-h-11 px-3 text-base" : "h-9 px-2.5 text-sm"
        )}
      >
        <MessageSquarePlus className="size-4" aria-hidden strokeWidth={1.9} />
        <span>Feedback</span>
      </button>
      <div className={cn("mt-auto flex flex-col", mobile ? "gap-4" : "gap-3")}>
        <DemoStatus mobile={mobile} />
        <Separator />
        <ProfileBlock closeMobileNav={onNavigate} mobile={mobile} />
      </div>
    </div>
  );
}

export function LibraryChrome({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <>
      <div className="app-appearance-scope flex h-app max-h-app min-h-0 overflow-hidden bg-background">
        {/* w-64 so the brand lockup fits on one line in the widest font
            preference (mono); w-56 left it 18px short. */}
        <aside className="hidden h-full max-h-app w-64 shrink-0 border-r border-border bg-card lg:block">
          <SidebarBody onFeedback={() => setFeedbackOpen(true)} />
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="sticky top-0 z-[80] flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur lg:hidden">
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-expanded={mobileNavOpen}
                  aria-controls={LIBRARY_MOBILE_NAV_ID}
                  aria-label="Open Menu"
                >
                  <Menu className="size-5" aria-hidden strokeWidth={2} />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-[19rem] max-w-[calc(100vw-1rem)] p-0"
                aria-label="Library Navigation"
              >
                <SheetHeader className="sr-only">
                  <SheetTitle>Library Navigation</SheetTitle>
                </SheetHeader>
                <SidebarBody
                  mobile
                  onNavigate={() => setMobileNavOpen(false)}
                  onFeedback={() => {
                    setMobileNavOpen(false);
                    setFeedbackOpen(true);
                  }}
                  headerAction={
                    <SheetClose asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-10"
                        aria-label="Close Menu"
                      >
                        <X className="size-5" aria-hidden strokeWidth={2} />
                      </Button>
                    </SheetClose>
                  }
                />
              </SheetContent>
            </Sheet>
            <BrandLockup
              href="/library"
              iconSize={24}
              textClassName="text-sm"
            />
            <Link
              href="/library/settings"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Settings
            </Link>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden">
            <EmbeddedReaderPortal>{children}</EmbeddedReaderPortal>
          </div>
        </div>
      </div>
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  );
}
