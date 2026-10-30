"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type AlertDialogContextValue = {
  descriptionId: string;
  titleId: string;
};

const AlertDialogContext = React.createContext<AlertDialogContextValue | null>(null);

function AlertDialog({
  children,
  className,
  onOpenChange,
  open,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  style?: React.CSSProperties;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleClose() {
      onOpenChange(false);
    }
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onOpenChange]);

  return (
    <AlertDialogContext.Provider value={{ descriptionId, titleId }}>
      <dialog
        ref={dialogRef}
        role="alertdialog"
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={cn(
          "fixed left-1/2 top-1/2 z-[200] m-0 max-h-[calc(100dvh-2rem)] w-[min(calc(100vw-1.5rem),28rem)] max-w-none -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-border bg-card p-0 text-card-foreground shadow-2xl outline-none",
          "[&::backdrop]:bg-black/60",
          className
        )}
        style={style}
        onCancel={() => onOpenChange(false)}
      >
        {children}
      </dialog>
    </AlertDialogContext.Provider>
  );
}

function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("max-h-[inherit] overflow-y-auto p-4 sm:p-5", className)} {...props} />;
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-2", className)} {...props} />;
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&_[data-slot=button]]:h-auto [&_[data-slot=button]]:min-h-9 [&_[data-slot=button]]:min-w-0 [&_[data-slot=button]]:max-w-full [&_[data-slot=button]]:w-full [&_[data-slot=button]]:whitespace-normal [&_[data-slot=button]]:break-words [&_[data-slot=button]]:py-2 sm:[&_[data-slot=button]]:w-auto",
        className
      )}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<"h2">) {
  const context = React.useContext(AlertDialogContext);
  return (
    <h2
      id={props.id ?? context?.titleId}
      className={cn("text-base font-semibold leading-none text-foreground", className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  const context = React.useContext(AlertDialogContext);
  return (
    <p
      id={props.id ?? context?.descriptionId}
      className={cn("text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]", className)}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
};
