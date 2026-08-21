"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { SavedRows } from "@/components/SavedRows";
import { useAuth } from "@/hooks/useAuth";
import type { SavedRowsFilter } from "@/lib/savedRowContent";
import { LibraryRightRail } from "../LibraryRightRail";

export default function ArchivePage() {
  const { session, isLoading } = useAuth();
  const router = useRouter();
  const [filter, setFilter] = useState<SavedRowsFilter>("all");

  useEffect(() => {
    if (!isLoading && !session) {
      router.replace("/login");
    }
  }, [isLoading, session, router]);

  if (!session) return null;

  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-[1180px] gap-6 overflow-hidden px-4 pb-6 pt-2 sm:px-6 lg:px-8">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col xl:max-w-[760px]">
        <header className="-mx-4 mb-5 shrink-0 border-b border-border bg-background/95 px-4 pb-5 pt-1 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <h1 className="text-3xl font-semibold leading-tight text-foreground">
            Archive
          </h1>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          <SavedRows mode="archive" filter={filter} sort="archived" />
        </div>
      </section>
      <LibraryRightRail
        activeFilter={filter}
        className="self-start xl:mt-[7rem]"
        mode="archive"
        onFilterChange={setFilter}
      />
    </main>
  );
}
