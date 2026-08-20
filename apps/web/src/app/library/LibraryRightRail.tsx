"use client";

import { Bookmark, FileText, Inbox, MessageCircle, type LucideIcon } from "lucide-react";

import { filterSavedRows } from "@/components/SavedRows";
import { useSavedLibrary } from "@/hooks/useSavedLibrary";
import { readingMinutesForRow } from "@/lib/demoLibrary";
import {
  savedRowContentBucket,
  type SavedRowsFilter,
} from "@/lib/savedRowContent";
import { cn } from "@/lib/utils";

type FilterOption = {
  value: SavedRowsFilter;
  label: string;
  icon: LucideIcon;
  count: number;
};

function statLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function FilterRow({
  active,
  count,
  icon: Icon,
  interactive,
  label,
  onSelect,
}: {
  active: boolean;
  count: number;
  icon: LucideIcon;
  interactive: boolean;
  label: string;
  onSelect?: () => void;
}) {
  const className = cn(
    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
    active
      ? "bg-accent text-primary"
      : "text-muted-foreground",
    interactive ? "hover:bg-accent/70 hover:text-foreground" : ""
  );
  const contents = (
    <>
      <Icon className="size-4" aria-hidden strokeWidth={1.9} />
      <span className="min-w-0 flex-1">{label}</span>
      <span className={cn("tabular-nums", active ? "font-semibold" : "")}>
        {count}
      </span>
    </>
  );

  if (!interactive) {
    return <div className={className}>{contents}</div>;
  }

  return (
    <button
      type="button"
      aria-pressed={active}
      className={className}
      onClick={onSelect}
    >
      {contents}
    </button>
  );
}

export function LibraryRightRail({
  activeFilter = "all",
  className,
  mode = "unread",
  onFilterChange,
}: {
  activeFilter?: SavedRowsFilter;
  className?: string;
  mode?: "unread" | "archive";
  onFilterChange?: (filter: SavedRowsFilter) => void;
}) {
  const { data } = useSavedLibrary();
  const unread = filterSavedRows(data, "unread");
  const archive = filterSavedRows(data, "archive");
  const currentRows = mode === "archive" ? archive : unread;
  const readingTime = unread.reduce(
    (total, row) => total + readingMinutesForRow(row),
    0
  );
  const articleCount = currentRows.filter(
    (row) => savedRowContentBucket(row) === "article"
  ).length;
  const socialCount = currentRows.filter(
    (row) => savedRowContentBucket(row) === "social"
  ).length;
  const otherCount = currentRows.filter(
    (row) => savedRowContentBucket(row) === "other"
  ).length;
  const filters: FilterOption[] = [
    { value: "all", label: "All Items", icon: Inbox, count: currentRows.length },
    { value: "article", label: "Articles", icon: FileText, count: articleCount },
    { value: "social", label: "Social", icon: MessageCircle, count: socialCount },
    { value: "other", label: "Other", icon: Bookmark, count: otherCount },
  ];
  const interactiveFilters = Boolean(onFilterChange);

  return (
    <aside className={cn("hidden w-64 shrink-0 flex-col gap-5 xl:flex", className)}>
      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground">Quick Stats</h2>
        <dl className="mt-4 flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Unread</dt>
            <dd className="font-semibold text-primary tabular-nums">{unread.length}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Archive</dt>
            <dd className="font-medium tabular-nums">{archive.length}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Reading Time</dt>
            <dd className="font-medium tabular-nums">{statLabel(readingTime)}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground">Filter By</h2>
        <div className="mt-4 flex flex-col gap-1 text-sm">
          {filters.map((filter) => (
            <FilterRow
              key={filter.value}
              active={activeFilter === filter.value}
              count={filter.count}
              icon={filter.icon}
              interactive={interactiveFilters}
              label={filter.label}
              onSelect={() => onFilterChange?.(filter.value)}
            />
          ))}
        </div>
      </section>
    </aside>
  );
}
