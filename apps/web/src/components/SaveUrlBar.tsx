"use client";

import { FormEvent, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useInvalidateSavedLibrary } from "@/hooks/useSavedLibrary";
import { useLatrRepo } from "@/hooks/useLatrRepo";
import { createDemoSavedRowFromPaste } from "@/lib/demoLibrary";
import { isLatrDemoDataEnabled } from "@/lib/demoMode";
import { showSaveOutcomeDebugLabels } from "@/lib/environmentBanner";
import { resolvePasteForSave } from "@/lib/resolveSaveInput";
import {
  prependSavedRow,
  type SavedLibraryData,
} from "@/lib/savedLibraryPages";

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
  const demoMode = isLatrDemoDataEnabled();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const invalidate = useInvalidateSavedLibrary();
  const [paste, setPaste] = useState("");
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if ((!repo && !demoMode) || !paste.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      if (demoMode) {
        const row = createDemoSavedRowFromPaste(paste);
        queryClient.setQueryData<SavedLibraryData>(
          ["saved-library", session?.did],
          (data) => prependSavedRow(data, row)
        );
        setFeedback({ mode: "plain", text: "Saved to local demo data." });
        setPaste("");
        return;
      }
      if (!repo) throw new Error("Sign In to Save Items");
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
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <form
        onSubmit={(e) => void onSubmit(e)}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="save-paste" className="text-xs font-medium text-muted-foreground">
            Save Link or AT URI
          </label>
          <Input
            id="save-paste"
            type="text"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="https://… or at://did…/collection/rkey"
            disabled={busy || (!repo && !demoMode)}
            spellCheck={false}
            autoComplete="off"
            enterKeyHint="done"
          />
        </div>
        <Button
          type="submit"
          disabled={busy || !paste.trim() || (!repo && !demoMode)}
          className="w-full sm:w-auto"
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      </form>
      {feedback &&
        (feedback.mode === "debug" ? (
          <div className="pt-3" role="status" aria-live="polite">
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
          <p className="pt-3 text-xs text-muted-foreground" role="status" aria-live="polite">
            {feedback.text}
          </p>
        ))}
    </div>
  );
}
