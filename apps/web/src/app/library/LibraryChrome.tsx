"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";

import {
  Archive,
  Beaker,
  Inbox,
  LogOut,
  Menu,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";

import { BrandLockup } from "@/components/BrandLockup";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { useSavedLibrary } from "@/hooks/useSavedLibrary";
import { useViewerProfile } from "@/hooks/useViewerProfile";
import { DEMO_HANDLE, isLatrDemoDataEnabled } from "@/lib/demoMode";
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
  const { data } = useSavedLibrary();
  return useMemo(() => {
    const unread =
      data?.filter((row) => (row.rec.value.state ?? "unread") !== "archived")
        .length ?? undefined;
    return [
      { href: "/library", label: "Unread", icon: Inbox, count: unread },
      { href: "/library/archive", label: "Archive", icon: Archive },
      { href: "/library/settings", label: "Settings", icon: Settings },
    ];
  }, [data]);
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
            href={item.href}
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
  headerAction,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
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

  return (
    <div className="app-appearance-scope flex h-app max-h-app min-h-0 overflow-hidden bg-background">
      {/* w-64 so the brand lockup fits on one line in the widest font
          preference (mono); w-56 left it 18px short. */}
      <aside className="hidden h-full max-h-app w-64 shrink-0 border-r border-border bg-card lg:block">
        <SidebarBody />
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
  );
}
