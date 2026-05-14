"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { UserAvatar } from "@/components/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { useViewerProfile } from "@/hooks/useViewerProfile";

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

export function LibraryChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, signOut } = useAuth();
  const { data: profile, isLoading: profileLoading } = useViewerProfile();

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

  return (
    <div className="flex min-h-app">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              L@tr.link
            </span>
            <span className="inline-flex w-fit items-center rounded-full border border-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
              Alpha
            </span>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-2">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
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
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
