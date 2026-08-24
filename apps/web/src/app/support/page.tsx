import type { Metadata } from "next";
import Link from "next/link";

import { BrandLockup } from "@/components/BrandLockup";
import { USER_INPUT_BOARD_URL } from "@/lib/userInputFeedback";

export const metadata: Metadata = {
  title: "Support",
  description: "Get help with L@tr.link and its browser extensions.",
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  return (
    <main className="min-h-app bg-background text-foreground">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <BrandLockup />
          <Link className="text-sm font-medium text-primary hover:underline" href="/library">
            Open Library
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-10 px-4 py-12 sm:px-6 sm:py-16">
        <div className="space-y-3 border-b border-border pb-8">
          <h1 className="text-4xl font-semibold tracking-tight">Support</h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground">
            Help with L@tr.link on the web, Chrome, and Firefox.
          </p>
        </div>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Quick checks</h2>
          <ol className="list-decimal space-y-3 pl-5 text-sm leading-7 text-muted-foreground sm:text-base">
            <li>Confirm you are signed in with the same AT Protocol account in the extension and library.</li>
            <li>Open the extension on an HTTP or HTTPS page, add any tags, and select Save Current Tab.</li>
            <li>Open the library in a new tab and refresh once if the saved item has not appeared yet.</li>
            <li>If sign-in is stuck, sign out, close the popup, and begin the authorization flow again.</li>
          </ol>
        </section>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-xl font-semibold">Report a problem</h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground sm:text-base">
            Post a report on the public L@tr.link User Input board. Include your
            browser and extension version, what you expected, and the exact error
            text. Do not include OAuth tokens, API keys, or other credentials.
          </p>
          <a
            className="mt-5 inline-flex text-sm font-semibold text-primary hover:underline"
            href={USER_INPUT_BOARD_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            Open the L@tr.link feedback board
          </a>
        </section>

        <p className="text-sm text-muted-foreground">
          For information about data handling, read the{" "}
          <Link className="text-primary hover:underline" href="/privacy">Privacy Policy</Link>.
        </p>
      </div>
    </main>
  );
}
