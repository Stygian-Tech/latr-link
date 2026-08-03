import type { Metadata } from "next";
import type { CSSProperties } from "react";

import { Providers } from "@/app/providers";
import { EnvironmentBanner } from "@/components/EnvironmentBanner";
import {
  environmentBannerOffset,
  getAppEnv,
} from "@/lib/environmentBanner";

import "./globals.css";

export const metadata: Metadata = {
  title: "LatrKit Developer Console",
  description: "Register usage-based API keys for the LatrKit gateway",
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
    <html lang="en" suppressHydrationWarning>
      <body
        className="min-h-dvh bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100"
        style={bodyStyle}
        suppressHydrationWarning
      >
        <Providers>
          <EnvironmentBanner appEnv={appEnv} />
          {children}
        </Providers>
      </body>
    </html>
  );
}
