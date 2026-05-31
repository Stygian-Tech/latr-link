"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { Menu, X } from "lucide-react";

import { UserAvatar } from "@/components/UserAvatar";
import { EmbeddedReaderPortal } from "@/contexts/embeddedReader";
import { useAuth } from "@/hooks/useAuth";
import { useViewerProfile } from "@/hooks/useViewerProfile";

const LIBRARY_NAV_ID = "library-primary-nav";
const mdMin = "(min-width: 768px)";

const nav = [
  { href: "/library", label: "Unread" },
  { href: "/library/archive", label: "Archive" },
  { href: "/library/settings", label: "Settings" },
];

function ProfileSkeleton({ size }: { size: number }) {
  return (
    <div className="flex min-w-0 items-start gap-3 px-4 py-3">
      <div
        className="shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 animate-pulse"
        style={{ width: size, height: size }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
        <div className="h-4 w-28 rounded-md bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
        <div className="h-3 max-w-[12rem] rounded-md bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
      </div>
    </div>
  );
}

type SidebarBodyProps = {
  pathname: string;
  avatarAlt: string;
  primaryLine: string;
  session: ReturnType<typeof useAuth>["session"];
  profile: ReturnType<typeof useViewerProfile>["data"];
  profileLoading: boolean;
  signOut: ReturnType<typeof useAuth>["signOut"];
  onNavLinkNavigate: () => void;
  onMobileClose: () => void;
};

function LibrarySidebarBody({
  pathname,
  avatarAlt,
  primaryLine,
  session,
  profile,
  profileLoading,
  signOut,
  onNavLinkNavigate,
  onMobileClose,
}: SidebarBodyProps) {
  return (
    <>
      <div className="border-b border-zinc-200 px-4 py-4 dark:border-zinc-800">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-lg font-semibold leading-tight text-zinc-900 dark:text-zinc-100">
              L@tr.link
            </span>
            <span className="inline-flex w-fit items-center rounded-full border border-zinc-200 px-1.5 py-0.5 text-[10px] font-medium leading-snug text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
              Beta
            </span>
          </div>
          <button
            type="button"
            className="md:hidden inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label="Close Menu"
            onClick={onMobileClose}
          >
            <X className="h-5 w-5" aria-hidden strokeWidth={2} />
          </button>
        </div>
      </div>

      <nav
        id={LIBRARY_NAV_ID}
        className="flex flex-1 flex-col gap-1 p-2"
        aria-label="Library"
      >
        {nav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavLinkNavigate}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-zinc-200 dark:border-zinc-800">
        {profileLoading && session?.did ? (
          <ProfileSkeleton size={40} />
        ) : (
          <div className="flex min-w-0 items-start gap-3 px-4 py-3">
            <UserAvatar
              src={profile?.avatar}
              alt={avatarAlt}
              size={40}
              className="shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight text-zinc-900 dark:text-zinc-100">
                {primaryLine}
              </p>
              <p className="truncate font-mono text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
                {session?.did ?? ""}
              </p>
            </div>
          </div>
        )}

        <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => void signOut()}
            className="w-full rounded-md px-3 py-2 text-left text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Sign Out
          </button>
        </div>
      </div>
    </>
  );
}

export function LibraryChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { session, signOut } = useAuth();
  const { data: profile, isLoading: profileLoading } = useViewerProfile();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isMd, setIsMd] = useState<boolean | null>(null);

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  useEffect(() => {
    const mq = window.matchMedia(mdMin);
    function sync() {
      const matches = mq.matches;
      setIsMd(matches);
      if (matches) setMobileNavOpen(false);
    }
    queueMicrotask(sync);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    queueMicrotask(closeMobileNav);
  }, [pathname, closeMobileNav]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMobileNav();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen, closeMobileNav]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  const avatarAlt =
    profile?.displayName?.trim() ||
    profile?.handle ||
    session?.did ||
    "Account";

  const primaryLine =
    profile?.displayName?.trim() ||
    profile?.handle ||
    session?.did ||
    "—";

  const sidebarBodyProps: SidebarBodyProps = {
    pathname,
    avatarAlt,
    primaryLine,
    session,
    profile,
    profileLoading,
    signOut,
    onNavLinkNavigate: closeMobileNav,
    onMobileClose: closeMobileNav,
  };

  return (
    <div className="flex min-h-app">
      {mobileNavOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-[90] cursor-default bg-black/40 md:hidden"
          aria-label="Close Menu"
          onClick={closeMobileNav}
        />
      ) : null}

      <aside
        className={`flex h-full max-h-app w-56 shrink-0 flex-col border-r border-zinc-200 bg-white transition-transform duration-200 ease-out dark:border-zinc-800 dark:bg-zinc-900 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-[100] max-md:shadow-xl md:relative md:z-auto md:h-auto md:max-h-none md:translate-x-0 md:shadow-none ${mobileNavOpen ? "max-md:translate-x-0" : "max-md:pointer-events-none max-md:-translate-x-full md:pointer-events-auto"}`}
        aria-hidden={
          isMd === false && !mobileNavOpen ? true : undefined
        }
      >
        <LibrarySidebarBody {...sidebarBodyProps} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="md:hidden sticky top-[var(--env-banner-offset)] z-30 flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 bg-zinc-50/95 px-3 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/95"
        >
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-700 transition-colors hover:bg-zinc-200/80 dark:text-zinc-200 dark:hover:bg-zinc-800"
            aria-expanded={mobileNavOpen}
            aria-controls={LIBRARY_NAV_ID}
            aria-label="Open Menu"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="h-5 w-5" aria-hidden strokeWidth={2} />
          </button>
          <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Library
          </span>
        </header>
        <EmbeddedReaderPortal>{children}</EmbeddedReaderPortal>
      </div>
    </div>
  );
}
