"use client";

import { useLayoutEffect, useRef } from "react";

import { handleCallback } from "@/lib/auth";

export default function CallbackPage() {
  const handled = useRef(false);

  useLayoutEffect(() => {
    if (handled.current) return;
    handled.current = true;
    handleCallback()
      .then(() => {
        window.location.replace("/");
      })
      .catch((err: unknown) => {
        console.error(err);
        window.location.replace("/login");
      });
  }, []);

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-sm text-zinc-500">Completing sign-in…</p>
    </div>
  );
}
