"use client";

/**
 * Environment banner — shown at the top of every page in non-production environments.
 *
 * `appEnv` is resolved on the server via {@link @/lib/environmentBanner.getAppEnv}.
 */

import {
  ENVIRONMENT_BANNER_CONFIG,
  type AppEnv,
} from "@/lib/environmentBanner";

type EnvironmentBannerProps = {
  appEnv: AppEnv;
};

export function EnvironmentBanner({ appEnv }: EnvironmentBannerProps) {
  const config =
    ENVIRONMENT_BANNER_CONFIG[appEnv as keyof typeof ENVIRONMENT_BANNER_CONFIG];
  if (!config) return null;

  return (
    <div
      role="banner"
      aria-label={`${config.label} environment`}
      className={`sticky top-0 z-50 flex h-[var(--env-banner-offset)] shrink-0 items-center justify-center gap-2 px-4 text-xs font-medium ${config.className}`}
    >
      <span className="rounded bg-black/10 px-1.5 py-0.5 font-mono font-bold tracking-wider">
        {config.label}
      </span>
      <span>{config.message}</span>
    </div>
  );
}
