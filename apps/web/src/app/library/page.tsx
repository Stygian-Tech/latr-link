"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { SaveUrlBar } from "@/components/SaveUrlBar";
import { SavedRows } from "@/components/SavedRows";
import { useAuth } from "@/hooks/useAuth";

export default function LibraryPage() {
  const { session, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !session) {
      router.replace("/login");
    }
  }, [isLoading, session, router]);

  if (!session) {
    return null;
  }

  return (
    <>
      <header className="border-b border-zinc-200 px-4 py-4 dark:border-zinc-800">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold leading-tight">Unread</h1>
          <p className="text-sm leading-snug text-zinc-500 dark:text-zinc-400">
            Newest Saves First.
          </p>
        </div>
      </header>
      <SaveUrlBar />
      <SavedRows mode="unread" />
    </>
  );
}
