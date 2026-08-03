import {
  bannerClasses,
  bannerMessage,
  type AppEnv,
  isEnvironmentBannerShown,
} from "@/lib/environmentBanner";

type EnvironmentBannerProps = {
  appEnv: AppEnv;
};

/**
 * Environment banner — shown at the top of every page in non-production environments.
 *
 * `appEnv` is resolved on the server via {@link @/lib/environmentBanner.getAppEnv}.
 */
export function EnvironmentBanner({ appEnv }: EnvironmentBannerProps) {
  if (!isEnvironmentBannerShown(appEnv)) return null;

  const body = bannerMessage(appEnv);
  if (!body) return null;

  return (
    <div
      role="status"
      aria-label={`${appEnv} environment`}
      className={bannerClasses(appEnv)}
    >
      <p className="font-medium">{body}</p>
    </div>
  );
}
