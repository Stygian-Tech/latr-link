"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/hooks/useAuth";

export default function HomePage() {
  const router = useRouter();
  const { session, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    if (session) {
      router.replace("/library");
    } else {
      router.replace("/login");
    }
  }, [isLoading, session, router]);

  return (
    <div className="flex min-h-app flex-1 items-center justify-center">
      <p className="text-sm text-zinc-500">Loading…</p>
    </div>
  );
}
