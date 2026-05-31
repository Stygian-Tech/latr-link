"use client";

import { useEffect, useRef } from "react";

import { ExternalLink, X } from "lucide-react";

/** URL string that maps to embeddable iframe content (`http:` / `https:` only). */
export function parsedHttpHttpsUrl(openUrl: string): URL | null {
  try {
    const u = new URL(openUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

const textChip =
  "rounded-full border border-zinc-300/90 bg-white/92 px-3 py-1.5 text-xs shadow-md backdrop-blur-md dark:border-zinc-600/90 dark:bg-zinc-950/92";

const iconChip =
  "inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-zinc-300/90 bg-white/92 text-zinc-700 shadow-md backdrop-blur-md transition-colors hover:bg-zinc-100 dark:border-zinc-600/90 dark:bg-zinc-950/92 dark:text-zinc-200 dark:hover:bg-zinc-800";

export function EmbeddedPageDialog({
  open,
  url,
  title,
  onClose,
}: {
  open: boolean;
  url: string | null;
  title: string;
  onClose: () => void;
}) {
  const dlgRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dlgRef.current;
    if (!el) return;
    if (open && url) {
      void el.showModal();
    } else {
      el.close();
    }
  }, [open, url]);

  useEffect(() => {
    const el = dlgRef.current;
    if (!el) return;
    /* Sync React when Escape or programmatic `close()` hides the modal */
    function onDlgClose() {
      onClose();
    }
    el.addEventListener("close", onDlgClose);
    return () => el.removeEventListener("close", onDlgClose);
  }, [onClose]);

  const show = !!(open && url);

  return (
    <dialog
      ref={dlgRef}
      className="
        fixed left-1/2 top-1/2 z-[200] box-border m-0
        h-[min(92vh,900px)] w-[min(calc(100vw-2rem),48rem)] max-w-none gap-0
        overflow-hidden rounded-xl border border-zinc-300 bg-white p-0 shadow-2xl outline-none
        -translate-x-1/2 -translate-y-1/2
        open:flex open:flex-col
        [&::backdrop]:bg-black/60
        dark:border-zinc-700 dark:bg-zinc-950 md:h-[min(92vh,880px)] md:w-[min(calc(100vw-3rem),64rem)]
      "
      aria-labelledby="embed-dialog-title"
      aria-modal="true"
      role="dialog"
    >
      {show ? (
        <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden">
          <iframe
            key={url!}
            title={title || "Embedded Page"}
            src={url!}
            className="min-h-0 flex-1 w-full border-0 bg-white dark:bg-zinc-950"
            referrerPolicy="no-referrer-when-downgrade"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
          />

          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 px-3 md:top-4">
            <div className="flex w-full items-start justify-between gap-3">
              <h2
                id="embed-dialog-title"
                className={`pointer-events-none inline-block w-fit max-w-[calc(100%-6rem)] truncate text-left align-top font-semibold leading-tight text-zinc-800 dark:text-zinc-100 ${textChip}`}
                title={title}
              >
                {title || "Reading"}
              </h2>
              <div className="pointer-events-none flex shrink-0 items-center gap-2 [&>*]:pointer-events-auto">
                <a
                  href={url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in New Tab"
                  className={iconChip}
                >
                  <ExternalLink className="h-4 w-4" aria-hidden strokeWidth={2} />
                  <span className="sr-only">Open in New Tab</span>
                </a>
                <button
                  type="button"
                  className={iconChip}
                  onClick={() => dlgRef.current?.close()}
                  aria-label="Close Reader"
                  title="Close"
                >
                  <X className="h-4 w-4" aria-hidden strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-3 md:bottom-4">
            <p
              className={`pointer-events-none max-w-lg text-center leading-snug md:max-w-xl ${textChip} px-3 py-2 font-normal [&>a]:pointer-events-auto`}
            >
              <span className="text-[11px] text-zinc-600 dark:text-zinc-400">
                Some Sites Refuse Embedding —
              </span>{" "}
              <a
                href={url!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline text-[11px] text-zinc-700 underline decoration-zinc-400 underline-offset-2 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50"
              >
                Open in New Tab
              </a>
            </p>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
