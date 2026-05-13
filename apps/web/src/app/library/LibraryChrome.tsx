"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAuth } from "@/hooks/useAuth";

const nav = [
  { href: "/library", label: "Unread" },
  { href: "/library/archive", label: "Archive" },
  { href: "/library/settings", label: "Settings" },
];

export function LibraryChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, signOut } = useAuth();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            L@tr.link
          </p>
          <p className="mt-1 truncate text-sm text-zinc-600 dark:text-zinc-300">
            {session?.did}
          </p>
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
        <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => void signOut()}
            className="w-full rounded-md px-3 py-2 text-left text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
