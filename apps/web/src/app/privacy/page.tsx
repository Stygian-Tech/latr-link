import type { Metadata } from "next";
import Link from "next/link";

import { BrandLockup } from "@/components/BrandLockup";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How L@tr.link handles data in the web app and browser extensions.",
  alternates: { canonical: "/privacy" },
};

const sectionClass = "space-y-3";
const headingClass = "text-xl font-semibold text-foreground";
const bodyClass = "text-sm leading-7 text-muted-foreground sm:text-base";

export default function PrivacyPage() {
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

      <article className="mx-auto max-w-4xl space-y-10 px-4 py-12 sm:px-6 sm:py-16">
        <div className="space-y-3 border-b border-border pb-8">
          <h1 className="text-4xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className={bodyClass}>Effective August 23, 2026</p>
          <p className={bodyClass}>
            This policy covers L@tr.link on the web and the official Chrome and
            Firefox extensions.
          </p>
        </div>

        <section className={sectionClass}>
          <h2 className={headingClass}>What L@tr.link handles</h2>
          <p className={bodyClass}>
            When you sign in, L@tr.link handles your AT Protocol account
            identifier and OAuth authorization information. When you save an
            item, it handles the URL or AT URI you selected, any tags you wrote,
            and metadata used to create the library preview, such as the page
            title, description, image, site name, and author.
          </p>
          <p className={bodyClass}>
            The browser extensions only access the active page when you invoke
            L@tr.link. They do not collect or transmit your browsing history in
            the background.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={headingClass}>Why it is used</h2>
          <p className={bodyClass}>
            This information is used to authenticate you, save and organize the
            item you selected, build its preview, display your library, prevent
            abuse, and diagnose service failures. L@tr.link does not sell this
            data, use it for advertising, or use it for unrelated profiling.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={headingClass}>Where information goes</h2>
          <p className={bodyClass}>
            Extension requests pass through the L@tr.link web proxy and gateway.
            Authentication is completed with the AT Protocol authorization
            server you select. Saved records are written to your account&apos;s
            Personal Data Server. L@tr.link may request the selected page and
            metadata services to resolve a useful preview.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={headingClass}>Storage and retention</h2>
          <p className={bodyClass}>
            Saved URLs, tags, and Open Graph fields are stored on-protocol in
            your Personal Data Server until you delete the record or your host
            applies its own retention rules. L@tr.link caches resolved preview
            metadata for up to seven days. The extensions store the OAuth session
            and a pending save locally in browser storage; pending saves expire
            after five minutes and are cleared after a successful save or sign-out.
          </p>
          <p className={bodyClass}>
            Infrastructure providers may retain limited operational logs, such
            as request route, status, timing, IP address, and error details, for
            security and reliability.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={headingClass}>Your controls</h2>
          <p className={bodyClass}>
            You can archive or delete saved items in your library, sign out to
            revoke the extension session, clear extension data in browser
            settings, or remove the extension. Your Personal Data Server remains
            the authoritative home for saved records.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={headingClass}>Chrome Limited Use</h2>
          <p className={bodyClass}>
            L@tr.link&apos;s use and transfer of information received from Google
            APIs complies with the Chrome Web Store User Data Policy, including
            the Limited Use requirements.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={headingClass}>Questions and changes</h2>
          <p className={bodyClass}>
            Use the <Link className="text-primary hover:underline" href="/support">support page</Link>{" "}
            for privacy questions or requests. Material policy changes will be
            reflected here with a new effective date.
          </p>
        </section>
      </article>
    </main>
  );
}
