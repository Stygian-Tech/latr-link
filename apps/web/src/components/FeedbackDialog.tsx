"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { FeedbackPhotoPicker } from "@/components/FeedbackPhotoPicker";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { isLatrDemoDataEnabled } from "@/lib/demoMode";
import {
  createUserInputFeedback,
  fetchUserInputBoardReference,
  LOCAL_USER_INPUT_TAGS,
  MAX_USER_INPUT_BODY_LENGTH,
  MAX_USER_INPUT_TITLE_LENGTH,
  requireUserInputFeedbackScopes,
  USER_INPUT_BOARD_URL,
  type UserInputBoardReference,
  userInputDiscussionUrl,
} from "@/lib/userInputFeedback";
import { cn } from "@/lib/utils";

type FeedbackResult = {
  local: boolean;
  url: string;
};

export function FeedbackDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const titleInputId = useId();
  const detailsInputId = useId();
  const { session, getOAuthSession } = useAuth();
  const localPreview = isLatrDemoDataEnabled();
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [board, setBoard] = useState<UserInputBoardReference | null>(null);
  const [boardLoadComplete, setBoardLoadComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FeedbackResult | null>(null);

  function reset() {
    setTitle("");
    setDetails("");
    setSelectedTags([]);
    setPhotos([]);
    setBoard(null);
    setBoardLoadComplete(false);
    setSubmitting(false);
    setError(null);
    setResult(null);
  }

  function close() {
    onOpenChange(false);
    reset();
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open || localPreview) return;
    const controller = new AbortController();
    void fetchUserInputBoardReference(fetch, controller.signal)
      .then(setBoard)
      .catch((caught) => {
        if (!controller.signal.aborted) {
          console.warn("Feedback tags could not be loaded", caught);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBoardLoadComplete(true);
      });
    return () => controller.abort();
  }, [localPreview, open]);

  function toggleTag(value: string) {
    setSelectedTags((current) =>
      current.includes(value)
        ? current.filter((tag) => tag !== value)
        : [...current, value]
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedDetails = details.trim();
    if (!trimmedTitle || submitting) return;

    setError(null);
    setSubmitting(true);
    try {
      if (localPreview) {
        setResult({ local: true, url: USER_INPUT_BOARD_URL });
        return;
      }

      const oauth = getOAuthSession();
      if (!oauth || !session) throw new Error("Sign in to send feedback.");
      await requireUserInputFeedbackScopes(
        oauth,
        photos.map((photo) => photo.type)
      );
      const activeBoard = board ?? (await fetchUserInputBoardReference());
      const discussion = await createUserInputFeedback(oauth, session.did, {
        board: activeBoard,
        title: trimmedTitle,
        ...(trimmedDetails ? { body: trimmedDetails } : {}),
        ...(selectedTags.length ? { tags: selectedTags } : {}),
        ...(photos.length ? { photos } : {}),
      });
      setResult({
        local: false,
        url: userInputDiscussionUrl(discussion.uri) ?? USER_INPUT_BOARD_URL,
      });
    } catch (caught) {
      console.error("Feedback submission failed", caught);
      setError(
        caught instanceof Error
          ? caught.message
          : "Feedback could not be sent. Try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const availableTags = localPreview
    ? LOCAL_USER_INPUT_TAGS
    : (board?.tags ?? []);
  const tagsLoading = open && !localPreview && !boardLoadComplete;

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="app-appearance-scope fixed left-1/2 top-1/2 z-[200] m-0 max-h-[calc(100dvh-2rem)] w-[min(calc(100vw-1.5rem),32rem)] max-w-none -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-border bg-card p-0 text-card-foreground shadow-2xl outline-none [&::backdrop]:bg-black/60"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={() => {
        if (open) onOpenChange(false);
      }}
    >
      <div className="max-h-[inherit] overflow-y-auto p-4 sm:p-5">
        {result ? (
          <>
            <div className="flex flex-col gap-2">
              <h2 id={titleId} className="text-base font-semibold text-foreground">
                {result.local ? "Feedback Previewed" : "Feedback Sent"}
              </h2>
              <p id={descriptionId} className="text-sm leading-6 text-muted-foreground">
                {result.local
                  ? "Local data mode stays offline, so nothing was posted."
                  : "Thanks—your feedback was posted to the L@tr.link User Input board."}
              </p>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={close}>
                Close
              </Button>
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants()}
              >
                {result.local ? "View Feedback Board" : "View Feedback"}
                <ExternalLink className="size-4" aria-hidden />
              </a>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <h2 id={titleId} className="text-base font-semibold text-foreground">
                Send Feedback
              </h2>
              <p id={descriptionId} className="text-sm leading-6 text-muted-foreground">
                Share a bug, idea, or question with the L@tr.link team. Your
                feedback will be public on{" "}
                <a
                  href={USER_INPUT_BOARD_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  User Input
                </a>
                .
              </p>
            </div>
            <form onSubmit={submit} className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <label htmlFor={titleInputId} className="text-sm font-medium text-foreground">
                  Title
                </label>
                <Input
                  id={titleInputId}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="What would you like us to know?"
                  maxLength={MAX_USER_INPUT_TITLE_LENGTH}
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor={detailsInputId} className="text-sm font-medium text-foreground">
                  Details
                </label>
                <textarea
                  id={detailsInputId}
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  placeholder="Add context, steps to reproduce, or what you expected…"
                  maxLength={MAX_USER_INPUT_BODY_LENGTH}
                  rows={6}
                  className="flex min-h-32 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              {tagsLoading || availableTags.length ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-foreground">Tags</legend>
                  <div className="flex flex-wrap gap-2">
                    {tagsLoading
                      ? ["tag-1", "tag-2", "tag-3"].map((key) => (
                          <span
                            key={key}
                            className="h-8 w-20 animate-pulse rounded-full bg-muted"
                            aria-hidden
                          />
                        ))
                      : availableTags.map((tag) => {
                          const selected = selectedTags.includes(tag.value);
                          return (
                            <Button
                              key={tag.value}
                              type="button"
                              size="sm"
                              variant={selected ? "secondary" : "outline"}
                              aria-pressed={selected}
                              onClick={() => toggleTag(tag.value)}
                              className="rounded-full"
                            >
                              {tag.label}
                            </Button>
                          );
                        })}
                  </div>
                </fieldset>
              ) : null}
              <FeedbackPhotoPicker
                photos={photos}
                onPhotosChange={setPhotos}
                disabled={submitting}
              />
              {localPreview ? (
                <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  Local data mode is offline. Submit previews the success state
                  without posting anything.
                </p>
              ) : null}
              {error ? (
                <p
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={close}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!title.trim() || submitting}
                  className={cn(submitting && "cursor-wait")}
                >
                  {submitting ? "Sending…" : "Send Feedback"}
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </dialog>
  );
}
