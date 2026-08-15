"use client";

import {
  Check,
  Code2,
  Monitor,
  Moon,
  Sun,
  Type,
  Bold,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import { useLatrRepo } from "@/hooks/useLatrRepo";
import { useTheme } from "@/hooks/useTheme";
import { isLatrDemoDataEnabled } from "@/lib/demoMode";
import { clearPersistedQueryCache } from "@/lib/queryPersistence";
import {
  fontLabel,
  themeLabel,
  type FontPreference,
  type ThemePreference,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

const themeOptions: Array<{
  value: ThemePreference;
  label: string;
  icon: LucideIcon;
}> = [
  {
    value: "system",
    label: "System",
    icon: Monitor,
  },
  {
    value: "light",
    label: "Light",
    icon: Sun,
  },
  {
    value: "dark",
    label: "Dark",
    icon: Moon,
  },
];

const fontOptions: Array<{
  value: FontPreference;
  label: string;
  icon: LucideIcon;
  style: CSSProperties;
}> = [
  {
    value: "sans",
    label: "Sans",
    icon: Type,
    style: { fontFamily: "var(--font-sans-system)" },
  },
  {
    value: "serif",
    label: "Serif",
    icon: Type,
    style: { fontFamily: "var(--font-serif-system)" },
  },
  {
    value: "mono",
    label: "Mono",
    icon: Code2,
    style: { fontFamily: "var(--font-mono-system)" },
  },
];

function computedLabel(computedTheme: "light" | "dark") {
  return computedTheme === "dark" ? "Dark" : "Light";
}

export default function SettingsPage() {
  const { session, isLoading } = useAuth();
  const router = useRouter();
  const repo = useLatrRepo();
  const {
    preference,
    computedTheme,
    setPreference,
    fontPreference,
    setFontPreference,
    boldText,
    setBoldText,
  } = useTheme();
  const demoMode = isLatrDemoDataEnabled();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !session) {
      router.replace("/login");
    }
  }, [isLoading, session, router]);

  async function exportJson() {
    if (!repo && !demoMode) return;
    setMessage(null);
    try {
      const items = repo ? await repo.listSavedItems() : [];
      const did = repo?.did ?? session?.did ?? "demo";
      const payload = {
        exportedAt: new Date().toISOString(),
        did,
        savedItems: items.map((r) => ({
          uri: r.uri,
          cid: r.cid,
          value: r.value,
        })),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `latr-export-${did.slice(-8)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMessage("Download Started.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Export Failed.");
    }
  }

  if (!session) return null;

  return (
    <main className="h-full overflow-y-auto overscroll-contain">
      <div className="mx-auto w-full max-w-[760px] px-4 pb-6 pt-2 sm:px-6 lg:px-8">
        <header className="mb-6">
          <h1 className="text-3xl font-semibold leading-tight text-foreground">
            Settings
          </h1>
        </header>

        <div className="flex flex-col gap-5">
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold text-foreground">Appearance</h2>
            </div>

          <div className="mt-5 grid gap-4">
            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-foreground">Theme</h3>
                <span className="text-xs text-muted-foreground">
                  {preference === "system"
                    ? `System (${computedLabel(computedTheme)})`
                    : themeLabel(preference)}
                </span>
              </div>
              <div
                role="radiogroup"
                aria-label="Theme"
                className="mt-3 grid gap-2 sm:grid-cols-3"
              >
                {themeOptions.map((option) => {
                  const active = option.value === preference;
                  return (
                    <button
                      key={option.value}
                      data-testid={`theme-${option.value}`}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setPreference(option.value)}
                      className={cn(
                        "flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                        active
                          ? "border-primary bg-accent text-accent-foreground"
                          : "border-border bg-background text-muted-foreground hover:border-primary/45 hover:text-foreground"
                      )}
                    >
                      <option.icon
                        className="mt-0.5 size-4 shrink-0 text-primary"
                        aria-hidden
                        strokeWidth={1.9}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-foreground">
                          {option.label}
                        </span>
                      </span>
                      {active ? (
                        <Check className="size-4 shrink-0 text-primary" aria-hidden />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-foreground">Font</h3>
                <span className="text-xs text-muted-foreground">
                  {fontLabel(fontPreference)}
                  {boldText ? " + Bold" : ""}
                </span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div
                  role="radiogroup"
                  aria-label="Font"
                  className="contents"
                >
                  {fontOptions.map((option) => {
                    const active = option.value === fontPreference;
                    return (
                      <button
                        key={option.value}
                        data-testid={`font-${option.value}`}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setFontPreference(option.value)}
                        className={cn(
                          "flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                          active
                            ? "border-primary bg-accent text-accent-foreground"
                            : "border-border bg-background text-muted-foreground hover:border-primary/45 hover:text-foreground"
                        )}
                      >
                        <option.icon
                          className="size-4 shrink-0 text-primary"
                          aria-hidden
                          strokeWidth={1.9}
                        />
                        <span
                          className="min-w-0 flex-1 truncate text-base text-foreground"
                          style={{
                            ...option.style,
                            fontWeight: boldText ? 700 : 400,
                          }}
                        >
                          {option.label}
                        </span>
                        {active ? (
                          <Check className="size-4 shrink-0 text-primary" aria-hidden />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                data-testid="font-bold"
                type="button"
                aria-pressed={boldText}
                onClick={() => setBoldText(!boldText)}
                className={cn(
                  "mt-2 flex min-h-10 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  boldText
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary/45 hover:text-foreground"
                )}
              >
                <Bold
                  className="size-4 shrink-0 text-primary"
                  aria-hidden
                  strokeWidth={1.9}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                  Bold Text
                </span>
                <span className="text-xs text-muted-foreground">
                  {boldText ? "On" : "Off"}
                </span>
                {boldText ? (
                  <Check className="size-4 shrink-0 text-primary" aria-hidden />
                ) : null}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">Export</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Download a JSON snapshot of your `link.latr.saved.item` records.
                Resolved previews are not included.
              </p>
            </div>
            {demoMode ? <Badge variant="secondary">Demo</Badge> : null}
          </div>
          <Button
            type="button"
            disabled={!repo && !demoMode}
            onClick={() => void exportJson()}
            className="mt-4"
          >
            Download JSON
          </Button>
          {message ? (
            <p className="mt-3 text-sm text-muted-foreground" role="status" aria-live="polite">
              {message}
            </p>
          ) : null}
        </section>

        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">
            Clear Local Cache
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Remove persisted React Query data from this browser. Your PDS records
            are unchanged.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              try {
                clearPersistedQueryCache(localStorage);
                setMessage("Cleared Local React Query Cache.");
              } catch {
                setMessage("Could Not Clear Storage.");
              }
            }}
            className="mt-4"
          >
            Clear Browser Cache
          </Button>
        </section>

        {demoMode ? (
          <section className="rounded-lg border border-primary/15 bg-accent p-5">
            <h2 className="text-base font-semibold text-primary">
              Local Demo Data
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Demo mode is enabled by `NEXT_PUBLIC_LATR_DEMO_DATA=1` and only
              runs when the app environment resolves to local.
            </p>
            <Separator className="my-4" />
            <p className="text-xs text-muted-foreground">
              Gateway and OAuth calls are bypassed for the local library demo.
            </p>
          </section>
        ) : null}
      </div>
      </div>
    </main>
  );
}
