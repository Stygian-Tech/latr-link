"use client";

import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useRef } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function tagMenuPosition(
  trigger: { right: number; top: number; bottom: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number }
) {
  const gap = 4;
  const edge = 8;
  const maxHeight = Math.max(0, viewport.height - edge * 2);
  const height = Math.min(menu.height, maxHeight);
  const below = trigger.bottom + gap;
  return {
    left: Math.max(edge, Math.min(trigger.right - menu.width, viewport.width - menu.width - edge)),
    top: Math.max(edge, below + height <= viewport.height - edge ? below : trigger.top - height - gap),
    maxHeight,
  };
}

export function BookmarkTagMenu({
  tag,
  onRename,
  onDelete,
}: {
  tag: string;
  onRename: () => void;
  onDelete: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);

  function openMenu(focusLast?: boolean) {
    const details = container.current?.querySelector("details");
    const trigger = details?.querySelector("summary");
    const menu = details?.querySelector<HTMLDivElement>("[role='menu']");
    if (!details || !trigger || !menu) return;
    details.open = true;
    // Fixed positioning escapes the tag list's scrolling overflow while the
    // menu stays inside its details element for dismissal and keyboard handling.
    const position = tagMenuPosition(trigger.getBoundingClientRect(), menu.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    Object.assign(menu.style, {
      left: `${position.left}px`,
      top: `${position.top}px`,
      maxHeight: `${position.maxHeight}px`,
    });
    if (focusLast !== undefined) {
      const items = menu.querySelectorAll<HTMLButtonElement>("button");
      items[focusLast ? items.length - 1 : 0]?.focus();
    }
  }

  function select(action: () => void) {
    const details = container.current?.querySelector("details");
    details?.removeAttribute("open");
    // The confirmation dialog restores focus to the visible trigger on close.
    details?.querySelector("summary")?.focus();
    action();
  }

  return (
    <div ref={container} data-tag-actions className="shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-8 cursor-pointer")}
          aria-label={`Actions for tag ${tag}`}
          title={`Actions for tag ${tag}`}
          onClick={(event) => {
            event.preventDefault();
            const details = event.currentTarget.closest("details");
            if (details?.open) details.removeAttribute("open");
            else openMenu();
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              openMenu(event.key === "ArrowUp");
            }
          }}
        >
          <Ellipsis className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          aria-label={`Actions for tag ${tag}`}
          className="fixed z-[100] mt-0 min-w-40 overflow-y-auto"
          style={{ right: "auto", maxWidth: "calc(100vw - 1rem)" }}
        >
          <DropdownMenuItem aria-label={`Rename tag ${tag}`} onClick={() => select(onRename)}>
            <Pencil className="size-3.5" aria-hidden />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            aria-label={`Delete tag ${tag}`}
            className="text-destructive hover:text-destructive focus-visible:text-destructive"
            onClick={() => select(onDelete)}
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
