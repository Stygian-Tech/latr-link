import Image from "next/image";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { BRAND_ICON_PATH } from "@/lib/brandIcon";
import { cn } from "@/lib/utils";

export function BrandLockup({
  className,
  href = "/",
  iconSize = 32,
  showBeta = true,
  textClassName,
}: {
  className?: string;
  href?: string;
  iconSize?: number;
  showBeta?: boolean;
  textClassName?: string;
}) {
  return (
    <Link href={href} className={cn("flex min-w-0 items-center gap-2", className)}>
      <Image
        src={BRAND_ICON_PATH}
        alt=""
        width={iconSize}
        height={iconSize}
        className="shrink-0 rounded-lg"
        priority
      />
      {/* The wordmark is a fixed 9-character string, so it never truncates —
          the mono preference renders it ~25% wider than sans. */}
      <span
        className={cn(
          "shrink-0 whitespace-nowrap text-xl font-semibold leading-none text-white",
          textClassName
        )}
      >
        L@tr.link
      </span>
      {showBeta ? (
        <Badge className="bg-primary text-primary-foreground">Beta</Badge>
      ) : null}
    </Link>
  );
}
