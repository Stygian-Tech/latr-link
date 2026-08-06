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
      <span
        className={cn(
          "truncate text-xl font-semibold leading-none text-white",
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
