/**
 * Non-production ribbon at top of layout — visibility + `--env-banner-offset` must stay
 * in sync with {@link ../components/shared/EnvironmentBanner.tsx}.
 */

export const NEXT_PUBLIC_APP_ENV = process.env.NEXT_PUBLIC_APP_ENV ?? "local";

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

export function isEnvironmentBannerShown(): boolean {
  return (
    NEXT_PUBLIC_APP_ENV === "dev" || NEXT_PUBLIC_APP_ENV === "local"
  );
}

/**
 * Verbose SaveUrlBar success copy (resolution path hints). Omit on hosted production.
 * Call from the browser after user actions so loopback hostname can be detected when env is ambiguous.
 */
export function showSaveOutcomeDebugLabels(): boolean {
  if (NEXT_PUBLIC_APP_ENV === "prod") return false;
  if (NEXT_PUBLIC_APP_ENV === "local" || NEXT_PUBLIC_APP_ENV === "dev") {
    return true;
  }
  if (typeof window === "undefined") return false;
  const h = window.location.hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]"
  );
}
