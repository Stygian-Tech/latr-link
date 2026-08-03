"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { DeveloperConsole } from "@/components/DeveloperConsole";
import { useAuth } from "@/hooks/useAuth";

export default function HomePage() {
  const { session, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !session) {
      router.replace("/login");
    }
  }, [isLoading, session, router]);

  if (isLoading || !session) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-zinc-500">Loading…</p>
      </div>
    );
  }

  return <DeveloperConsole />;
}
