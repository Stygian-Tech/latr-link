"use client";

import { FormEvent, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowRight, BookOpen } from "lucide-react";

import { BrandLockup } from "@/components/BrandLockup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { isLatrDemoDataEnabled } from "@/lib/demoMode";
import iconSrc from "@/app/icon.png";

const callbackErrorMessage =
  "Sign-In Callback Failed. Try an External Browser (Chrome/Safari) if Preview Tools Block WebSockets or Storage.";

function getInitialCallbackError(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  if (error !== "callback_failed" && error !== "callback_watchdog") return null;
  return params.get("message") || callbackErrorMessage;
}

function subscribeToLoginSearchParams(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function readCallbackErrorFromUrl(): string | null {
  return getInitialCallbackError();
}

export default function LoginPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const demoMode = isLatrDemoDataEnabled();
  const [handle, setHandle] = useState("");
  const callbackError = useSyncExternalStore(
    subscribeToLoginSearchParams,
    readCallbackErrorFromUrl,
    () => null
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const displayError = error ?? callbackError;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      await signIn(handle.trim());
      if (demoMode) {
        router.replace("/library");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Sign-In Failed. Check Your Handle and Try Again."
      );
    }
    setIsPending(false);
  }

  return (
    <main className="flex min-h-app flex-1 bg-background">
      <section className="hidden min-h-app flex-1 border-r border-border bg-card px-8 py-10 lg:flex lg:flex-col">
        <BrandLockup iconSize={34} />
        <div className="my-auto max-w-xl">
          <Badge variant="secondary">Read-Later Library</Badge>
          <h1 className="mt-6 text-5xl font-semibold leading-tight text-foreground">
            Save the Article Now. Keep the Record Yours.
          </h1>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">
            L@tr.link gives your reading queue a calm home while storing saved
            metadata through your ATProto account.
          </p>
          <div className="mt-8 grid gap-3">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-4">
              <BookOpen className="size-5 text-primary" aria-hidden strokeWidth={1.9} />
              <span className="text-sm font-medium text-foreground">
                Articles, Posts, and Records in One Queue
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="rounded-xl border border-border bg-card p-7 shadow-sm">
            <div className="text-center">
              <div className="mb-4 flex justify-center">
                <Image
                  src={iconSrc}
                  alt=""
                  width={56}
                  height={56}
                  className="rounded-2xl"
                  priority
                />
              </div>
              <h1 className="text-2xl font-semibold">L@tr.link</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Read Later, Stored on Your PDS.
              </p>
              {demoMode ? (
                <Badge variant="secondary" className="mt-3">
                  Local Demo Mode
                </Badge>
              ) : null}
            </div>

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="handle" className="text-sm font-medium">
                  Handle
                </label>
                <Input
                  id="handle"
                  type="text"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder={demoMode ? "reader.latr.local" : "you.bsky.social"}
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="username"
                  spellCheck={false}
                  required={!demoMode}
                  disabled={isPending}
                />
              </div>

              {displayError ? (
                <p className="text-sm text-destructive" role="alert">
                  {displayError}
                </p>
              ) : null}

              <Button
                type="submit"
                size="lg"
                disabled={isPending || (!demoMode && !handle.trim())}
                className="w-full"
              >
                {isPending ? "Signing In…" : "Continue with ATProto"}
                <ArrowRight className="size-4" aria-hidden strokeWidth={2} />
              </Button>
            </form>

            {!demoMode ? (
              <details className="mt-5 border-t border-border pt-4 text-sm">
                <summary className="cursor-pointer font-medium text-foreground">
                  What L@tr.link can access
                </summary>
                <div className="mt-3 space-y-2 leading-5 text-muted-foreground">
                  <p>
                    L@tr.link can identify your account and create or update
                    link metadata in your public repository.
                  </p>
                  <p>
                    It can create, update, and delete only your L@tr saved-item
                    records. It can also delete obsolete L@tr records after a
                    one-time migration.
                  </p>
                  <p>
                    It cannot post for you, edit your profile, read messages or
                    email, upload media, or manage your account.
                  </p>
                </div>
              </details>
            ) : null}
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            New here?{" "}
            <Link href="https://bsky.app" className="font-medium text-primary underline-offset-2 hover:underline">
              Join Bluesky
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
