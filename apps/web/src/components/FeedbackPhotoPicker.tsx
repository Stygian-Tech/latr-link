"use client";

import { ImagePlus, X } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  acceptedUserInputPhotos,
  MAX_USER_INPUT_PHOTOS,
} from "@/lib/userInputFeedback";

export function FeedbackPhotoPicker({
  disabled = false,
  photos,
  onPhotosChange,
}: {
  disabled?: boolean;
  photos: File[];
  onPhotosChange: (photos: File[]) => void;
}) {
  const inputId = useId();
  const remaining = MAX_USER_INPUT_PHOTOS - photos.length;

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium text-foreground">Photos</legend>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={inputId}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          disabled={disabled || remaining === 0}
          onChange={(event) => {
            const input = event.currentTarget;
            if (input.files) {
              onPhotosChange(acceptedUserInputPhotos(photos, input.files));
            }
            input.value = "";
          }}
        />
        <label
          htmlFor={inputId}
          aria-disabled={disabled || remaining === 0}
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 text-[0.8rem] font-medium text-foreground shadow-sm transition-colors hover:bg-accent aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          <ImagePlus className="size-3.5" aria-hidden strokeWidth={1.9} />
          Add Photos
        </label>
        <span className="text-xs text-muted-foreground">
          {photos.length} of {MAX_USER_INPUT_PHOTOS}
        </span>
      </div>
      {photos.length ? (
        <ul className="space-y-1" aria-label="Attached Photos">
          {photos.map((photo, index) => (
            <li
              key={`${photo.name}-${photo.size}-${photo.lastModified}-${index}`}
              className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-sm"
            >
              <ImagePlus
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
                strokeWidth={1.9}
              />
              <span className="min-w-0 flex-1 truncate">{photo.name}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={`Remove ${photo.name}`}
                onClick={() =>
                  onPhotosChange(
                    photos.filter((_, itemIndex) => itemIndex !== index)
                  )
                }
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          Attach up to four images.
        </p>
      )}
    </fieldset>
  );
}
