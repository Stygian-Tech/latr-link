import Image from "next/image";
import Link from "next/link";
import {
  Archive,
  ArrowRight,
  Bookmark,
  BookOpen,
  FileText,
  Link2,
  LockKeyhole,
  type LucideIcon,
} from "lucide-react";

import { BrandLockup } from "@/components/BrandLockup";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { BRAND_ICON_PATH } from "@/lib/brandIcon";
import { cn } from "@/lib/utils";

type Feature = {
  icon: LucideIcon;
  title: string;
  body: string;
  action: string;
};

const features: Feature[] = [
  {
    icon: Link2,
    title: "Article Readers",
    body: "Keep essays, docs, newsletters, and posts in one calm queue instead of a pile of forgotten tabs.",
    action: "Save the Article",
  },
  {
    icon: BookOpen,
    title: "Tab Closers",
    body: "Capture the thing you meant to come back to, close the tab, and return when you actually have time.",
    action: "Clear the Tab",
  },
  {
    icon: LockKeyhole,
    title: "Bluesky Readers",
    body: "Save posts and threads alongside normal links, without turning your bookmarks into another feed.",
    action: "Read It Later",
  },
];

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <BrandLockup />
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/library"
            className="hidden text-sm font-medium text-muted-foreground hover:text-foreground sm:inline-flex"
          >
            Open Library
          </Link>
          <Link href="/login" className={buttonVariants({ size: "sm" })}>
            Sign In
          </Link>
        </div>
      </div>
    </header>
  );
}

function ProductPreview() {
  const rows = [
    {
      title: "Sunday dinner recipes worth trying",
      source: "Food & Home",
      meta: "Saved recipe · 6 min read",
      body: "A few weeknight ideas to revisit before grocery shopping.",
      tone: "bg-sky-100 text-sky-700",
    },
    {
      title: "A weekend guide to neighborhood parks",
      source: "City Magazine",
      meta: "Saved article · 8 min read",
      body: "Something quiet to read when there is time to plan the weekend.",
      tone: "bg-blue-100 text-blue-700",
    },
    {
      title: "Gift ideas to revisit before Friday",
      source: "Shopping Guide",
      meta: "Saved list · 2 min read",
      body: "Save the useful thing now, come back when you are ready to decide.",
      tone: "bg-indigo-100 text-indigo-700",
    },
  ];

  return (
    <div className="w-full rounded-xl border border-border bg-card shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Image
            src={BRAND_ICON_PATH}
            alt=""
            width={28}
            height={28}
            className="rounded-md"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              L@tr.link
            </p>
            <p className="text-xs text-muted-foreground">Unread Queue</p>
          </div>
        </div>
        <Badge variant="secondary">24 Saved</Badge>
      </div>
      <div className="border-b border-border bg-accent/45 p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground">
            <Link2 className="size-4 text-primary" aria-hidden strokeWidth={1.9} />
            Save a Link or AT URI
          </div>
          <span className={buttonVariants()} aria-hidden="true">
            Save
          </span>
        </div>
      </div>
      <div className="divide-y divide-border">
        {rows.map((row) => (
          <div key={row.title} className="grid gap-4 p-4 sm:grid-cols-[6rem_1fr]">
            <div
              className={cn(
                "flex aspect-[1.08] w-24 items-center justify-center rounded-md",
                row.tone
              )}
            >
              <BookOpen className="size-6" aria-hidden strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">
                {row.source} · {row.meta}
              </p>
              <p className="mt-1 text-base font-semibold leading-snug text-foreground">
                {row.title}
              </p>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                {row.body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="min-h-app bg-background text-foreground">
      <SiteHeader />

      <section className="overflow-hidden border-b border-border">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 sm:py-18 lg:grid-cols-[0.85fr_1.15fr] lg:px-8 lg:py-20">
          <div className="min-w-0 max-w-2xl">
            <h1 className="text-5xl font-semibold leading-none text-foreground sm:text-6xl">
              L@tr.link
            </h1>
            <p className="mt-6 max-w-xl text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
              Save Now. Read Later. Yours Everywhere.
            </p>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
              A read-later library for articles, posts, recipes, shopping
              guides, and anything else worth coming back to. Sign in with your
              handle and keep your saved list attached to your account.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/login" className={buttonVariants({ size: "lg" })}>
                Start Saving
                <ArrowRight className="size-4" aria-hidden strokeWidth={2} />
              </Link>
              <Link
                href="#how-it-works"
                className={buttonVariants({ variant: "outline", size: "lg" })}
              >
                How It Works
              </Link>
            </div>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section id="queue" className="border-b border-border bg-card">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
          <div className="max-w-xl">
            <h2 className="text-3xl font-semibold leading-tight text-foreground">
              Built for People Who Actually Want to Read It Later
            </h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              L@tr keeps the product simple on purpose: save the useful thing,
              close the distraction, and come back to a queue that still belongs
              to your account.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-lg border border-border bg-background p-5"
              >
                <feature.icon
                  className="size-5 text-primary"
                  aria-hidden
                  strokeWidth={1.9}
                />
                <h3 className="mt-4 text-base font-semibold text-foreground">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {feature.body}
                </p>
                <p className="mt-4 text-sm font-medium text-primary">
                  {feature.action}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="bg-background">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_auto] lg:px-8">
          <div className="min-w-0 max-w-3xl">
            <h2 className="text-3xl font-semibold leading-tight text-foreground">
              Start With Your Bluesky Handle
            </h2>
            <p className="mt-4 text-lg leading-8 text-muted-foreground">
              Connect with ATProto OAuth, save the first thing you do not want
              to lose, and keep control of the record behind it.
            </p>
            <div className="mt-6 flex flex-wrap gap-3 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <Bookmark className="size-4 text-primary" aria-hidden strokeWidth={1.8} />
                Saved Queue
              </span>
              <span className="inline-flex items-center gap-2">
                <Archive className="size-4 text-primary" aria-hidden strokeWidth={1.8} />
                Portable Archive
              </span>
              <span className="inline-flex items-center gap-2">
                <FileText className="size-4 text-primary" aria-hidden strokeWidth={1.8} />
                On-Protocol Metadata
              </span>
            </div>
          </div>
          <Link href="/login" className={buttonVariants({ size: "lg" })}>
            Continue with ATProto
            <ArrowRight className="size-4" aria-hidden strokeWidth={2} />
          </Link>
        </div>
      </section>
    </main>
  );
}
