import Image from "next/image";

type LatrKitLogoProps = {
  size?: number;
  className?: string;
};

export function LatrKitLogo({ size = 40, className }: LatrKitLogoProps) {
  return (
    <Image
      src="/apple-icon.png"
      alt="LatrKit"
      width={size}
      height={size}
      className={["rounded-[22%] shadow-sm ring-1 ring-zinc-900/10 dark:ring-white/10", className]
        .filter(Boolean)
        .join(" ")}
      priority
    />
  );
}
