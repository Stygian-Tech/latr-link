import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/react";

import { EnvironmentBanner } from "@/components/shared/EnvironmentBanner";
import {
  environmentBannerOffset,
  getAppEnv,
} from "@/lib/environmentBanner";

import "./globals.css";
import { Providers } from "./providers";

const title = "L@tr.link";
const description = "Save now. Read later. Yours everywhere.";

export const metadata: Metadata = {
  metadataBase: new URL("https://latr.link"),
  applicationName: title,
  title: {
    default: title,
    template: `%s · ${title}`,
  },
  description,
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  referrer: "origin-when-cross-origin",
  openGraph: {
    title,
    description,
    url: "https://latr.link",
    siteName: title,
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const appEnv = getAppEnv();
  const bodyStyle = {
    "--env-banner-offset": environmentBannerOffset(appEnv),
  } as CSSProperties;

  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body
        className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
        style={bodyStyle}
        suppressHydrationWarning
      >
        <Script id="latr-loopback-host" strategy="beforeInteractive">
          {`if(location.protocol==="http:"&&(location.hostname==="localhost"||location.hostname==="[::1]")){location.replace("http://127.0.0.1"+(location.port?":"+location.port:"")+location.pathname+location.search+location.hash)}`}
        </Script>
        <Providers>
          <EnvironmentBanner appEnv={appEnv} />
          {children}
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
