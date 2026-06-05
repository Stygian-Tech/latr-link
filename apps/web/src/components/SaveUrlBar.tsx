"use client";

import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { useInvalidateSavedLibrary } from "@/hooks/useSavedLibrary";
import { useLatrRepo } from "@/hooks/useLatrRepo";
import { showSaveOutcomeDebugLabels } from "@/lib/environmentBanner";
import { resolvePasteForSave } from "@/lib/resolveSaveInput";

/** Mirrors “AT record” dev chip tint in SavedRows.tsx */
const savePathDebugChip =
  "inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-1 rounded border border-violet-700/55 bg-violet-100 px-2 py-1.5 text-violet-950 dark:border-violet-500/60 dark:bg-violet-950/55 dark:text-violet-50";

type SaveFeedback =
  | { mode: "plain"; text: string }
  | { mode: "debug"; detail: string };

function debugDetailForSave(
  kind: "subject" | "url",
  storage?: "native" | "external"
): string {
  if (kind === "subject" || storage === "native") {
    return "Saved AT Proto Record.";
  }
  return "Saved Link.";
}

export function SaveUrlBar() {
  const repo = useLatrRepo();
  const invalidate = useInvalidateSavedLibrary();
  const [paste, setPaste] = useState("");
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!repo || !paste.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const resolved = resolvePasteForSave(paste);
      if (resolved.kind === "subject") {
        const response = await repo.saveSubjectUri(resolved.subjectUri);
        if (!showSaveOutcomeDebugLabels()) {
          setFeedback({ mode: "plain", text: "Saved." });
        } else {
          setFeedback({
            mode: "debug",
            detail: debugDetailForSave("subject", response.storage),
          });
        }
      } else {
        const response = await repo.saveUrl(resolved.url);
        if (!showSaveOutcomeDebugLabels()) {
          setFeedback({
            mode: "plain",
            text: response.storage === "native" ? "Saved." : "Saved Link.",
          });
        } else {
          setFeedback({
            mode: "debug",
            detail: debugDetailForSave(response.kind, response.storage),
          });
        }
      }
      setPaste("");
      invalidate();
    } catch (err) {
      setFeedback({
        mode: "plain",
        text:
          err instanceof Error ? err.message : "Could Not Save This Paste.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <form
        onSubmit={(e) => void onSubmit(e)}
        className="flex flex-wrap items-end gap-2 px-4 py-3"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="save-paste" className="text-xs font-medium text-zinc-500">
            Save Link or AT URI
          </label>
          <input
            id="save-paste"
            type="text"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="https://… or at://did…/collection/rkey"
            disabled={busy || !repo}
            spellCheck={false}
            autoComplete="off"
            enterKeyHint="done"
            className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          />
        </div>
        <Button type="submit" disabled={busy || !paste.trim() || !repo}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </form>
      {feedback &&
        (feedback.mode === "debug" ? (
          <div className="px-4 pb-3">
            <span className={savePathDebugChip} title="Save Pathway (Dev)">
              <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wide opacity-95">
                [DEBUG]
              </span>
              <span className="min-w-0 text-xs leading-snug">
                {feedback.detail}
              </span>
            </span>
          </div>
        ) : (
          <p className="px-4 pb-3 text-xs text-zinc-500 dark:text-zinc-400">
            {feedback.text}
          </p>
        ))}
    </div>
  );
}
