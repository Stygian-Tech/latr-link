/**
 * Non-production ribbon — visibility + `--env-banner-offset` must stay in sync with
 * {@link ../components/shared/EnvironmentBanner.tsx}.
 *
 * `NEXT_PUBLIC_APP_ENV` / `APP_ENV`: **`prod`** | **`local`** | **`dev`** | **`test`**
 * (see `apps/web/.env.example`). Railway sets this explicitly. When unset:
 * `next dev` → **`local`**; legacy Vercel production → **`prod`**; other hosted
 * builds → **`dev`**.
 */
import type { LatrAppEnv } from "latr-web-client/latrGatewayConfig";

export type AppEnv = "prod" | "dev" | "local" | "test" | (string & {});

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

function isLatrAppEnv(env: string): env is LatrAppEnv {
  return (
    env === "local" || env === "dev" || env === "prod" || env === "test"
  );
}

/** Maps web `AppEnv` to gateway client config (unknown values → `dev`). */
export function toLatrGatewayAppEnv(env: AppEnv = getAppEnv()): LatrAppEnv {
  if (isLatrAppEnv(env)) return env;
  return "dev";
}

/** @deprecated Prefer {@link getAppEnv}. */
export const NEXT_PUBLIC_APP_ENV = getAppEnv();

export function isNonProd(env: AppEnv): boolean {
  return env === "local" || env === "dev" || env === "test";
}

export function bannerMessage(env: AppEnv): string {
  switch (env) {
    case "local":
      return "Local Environment — Development Data and Relaxed Limits.";
    case "dev":
      return "Development Server — Not Production; Data May Be Reset.";
    case "test":
      return "Testing Server — Not Production; Data May Be Reset.";
    default:
      return "";
  }
}

const BANNER_CHROME =
  "supports-backdrop-filter:backdrop-blur-md overflow-hidden border-b px-5 py-2.5 text-sm";

export function bannerClasses(env: AppEnv): string {
  switch (env) {
    case "local":
      return `${BANNER_CHROME} border-amber-300 bg-amber-100 font-medium text-amber-950 shadow-sm`;
    case "dev":
    case "test":
      return `${BANNER_CHROME} border-red-300 bg-red-100 font-medium text-red-950 shadow-sm`;
    default:
      return BANNER_CHROME;
  }
}

/** Single-line bar: matches `py-2.5` + `text-sm` row in EnvironmentBanner (+ border-b). */
export const ENVIRONMENT_BANNER_OFFSET = "2.625rem" as const;

export function isEnvironmentBannerShown(appEnv: AppEnv = getAppEnv()): boolean {
  return isNonProd(appEnv);
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
  if (isNonProd(appEnv)) return true;
  if (typeof window === "undefined") return false;
  const h = window.location.hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]"
  );
}
