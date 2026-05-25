/**
 * Non-production ribbon — visibility + `--env-banner-offset` must stay in sync with
 * {@link ../components/shared/EnvironmentBanner.tsx}.
 *
 * `NEXT_PUBLIC_APP_ENV` / `APP_ENV`: **`prod`** | **`local`** | **`dev`**
 * (see `apps/web/.env.example`). When unset: `next dev` → **`local`**; Vercel
 * production → **`prod`**; other hosted builds (preview) → **`dev`**.
 */

export type AppEnv = "prod" | "dev" | "local" | (string & {});

export function readAppEnvRaw(): string {
  return (
    process.env.NEXT_PUBLIC_APP_ENV?.trim() ||
    process.env.APP_ENV?.trim() ||
    ""
  );
}

export function normalizeAppEnv(raw: string): AppEnv {
  const v = raw.trim().toLowerCase();
  if (v === "production") return "prod";
  return v as AppEnv;
}

/** Resolved label for banners and layout (build-time on client, runtime on server). */
export function getAppEnv(): AppEnv {
  const raw = readAppEnvRaw();
  if (raw) return normalizeAppEnv(raw);
  if (process.env.NODE_ENV === "development") return "local";
  if (process.env.VERCEL_ENV === "production") return "prod";
  return "dev";
}

/** @deprecated Prefer {@link getAppEnv}. */
export const NEXT_PUBLIC_APP_ENV = getAppEnv();

export const ENVIRONMENT_BANNER_CONFIG = {
  dev: {
    label: "DEV",
    message: "You're on the development server",
    className: "border-b border-amber-500 bg-amber-400 text-amber-900",
  },
  local: {
    label: "LOCAL",
    message: "Running locally",
    className: "border-b border-blue-600 bg-blue-500 text-white",
  },
} as const;

/** Single-line bar: matches `py-1.5` + `text-xs` row in EnvironmentBanner (+ border-b). */
export const ENVIRONMENT_BANNER_OFFSET = "2.375rem" as const;

export function isEnvironmentBannerShown(appEnv: AppEnv = getAppEnv()): boolean {
  return appEnv === "dev" || appEnv === "local";
}

export function environmentBannerOffset(appEnv: AppEnv = getAppEnv()): string {
  return isEnvironmentBannerShown(appEnv) ? ENVIRONMENT_BANNER_OFFSET : "0px";
}

/**
 * Verbose SaveUrlBar success copy (resolution path hints). Omit on hosted production.
 */
export function showSaveOutcomeDebugLabels(): boolean {
  const appEnv = getAppEnv();
  if (appEnv === "prod") return false;
  if (appEnv === "local" || appEnv === "dev") return true;
  if (typeof window === "undefined") return false;
  const h = window.location.hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]"
  );
}
