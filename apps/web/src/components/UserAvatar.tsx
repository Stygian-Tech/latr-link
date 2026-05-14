"use client";

type UserAvatarProps = {
  src?: string | null;
  alt: string;
  size?: number;
  className?: string;
};

export function UserAvatar({
  src,
  alt,
  size = 40,
  className = "",
}: UserAvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        className={`rounded-full object-cover ${className}`}
        referrerPolicy="no-referrer"
      />
    );
  }

  const initials = alt
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <span
      aria-label={alt}
      style={{ width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-600 select-none dark:bg-zinc-700 dark:text-zinc-200 ${className}`}
    >
      {initials || "?"}
    </span>
  );
}
