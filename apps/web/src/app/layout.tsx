import type { Metadata } from "next";
import type { CSSProperties } from "react";

import { EnvironmentBanner } from "@/components/shared/EnvironmentBanner";
import {
  ENVIRONMENT_BANNER_OFFSET,
  isEnvironmentBannerShown,
} from "@/lib/environmentBanner";

import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "L@tr.link",
  description: "Read later on your ATProto repo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const htmlStyle = {
    "--env-banner-offset": isEnvironmentBannerShown()
      ? ENVIRONMENT_BANNER_OFFSET
      : "0px",
  } as CSSProperties;

  return (
    <html lang="en" className="h-full antialiased" style={htmlStyle}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `if(location.protocol==="http:"&&(location.hostname==="localhost"||location.hostname==="[::1]")){location.replace("http://127.0.0.1"+(location.port?":"+location.port:"")+location.pathname+location.search+location.hash)}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <Providers>
          <EnvironmentBanner />
          {children}
        </Providers>
      </body>
    </html>
  );
}
