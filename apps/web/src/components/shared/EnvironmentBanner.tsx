"use client";

/**
 * Environment banner — shown at the top of every page in non-production environments.
 *
 * Controlled by NEXT_PUBLIC_APP_ENV (see {@link @/lib/environmentBanner}).
 */

import {
  ENVIRONMENT_BANNER_CONFIG,
  NEXT_PUBLIC_APP_ENV,
} from "@/lib/environmentBanner";

export function EnvironmentBanner() {
  if (NEXT_PUBLIC_APP_ENV === "prod") return null;

  const config =
    ENVIRONMENT_BANNER_CONFIG[
      NEXT_PUBLIC_APP_ENV as keyof typeof ENVIRONMENT_BANNER_CONFIG
    ];
  if (!config) return null;

  return (
    <div
      role="banner"
      aria-label={`${config.label} environment`}
      className={`sticky top-0 z-50 flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium ${config.className}`}
    >
      <span className="rounded bg-black/10 px-1.5 py-0.5 font-mono font-bold tracking-wider">
        {config.label}
      </span>
      <span>{config.message}</span>
    </div>
  );
}
