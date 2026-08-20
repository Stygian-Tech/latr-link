export const MAX_BOOKMARK_TAGS = 100;
export const MAX_BOOKMARK_TAG_GRAPHEMES = 64;
export const MAX_BOOKMARK_TAG_BYTES = 640;

const graphemeSegmenter = new Intl.Segmenter("en", {
  granularity: "grapheme",
});

export class BookmarkTagValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookmarkTagValidationError";
  }
}

export function bookmarkTagGraphemeCount(tag: string): number {
  return Array.from(graphemeSegmenter.segment(tag)).length;
}

export function bookmarkTagByteCount(tag: string): number {
  return new TextEncoder().encode(tag).byteLength;
}

export function normalizeBookmarkTags(values: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const tag = value.trim();
    if (!tag) {
      throw new BookmarkTagValidationError("Tags cannot be empty.");
    }
    if (bookmarkTagGraphemeCount(tag) > MAX_BOOKMARK_TAG_GRAPHEMES) {
      throw new BookmarkTagValidationError(
        `Tags can contain at most ${MAX_BOOKMARK_TAG_GRAPHEMES} characters.`
      );
    }
    if (bookmarkTagByteCount(tag) > MAX_BOOKMARK_TAG_BYTES) {
      throw new BookmarkTagValidationError(
        `Tags can contain at most ${MAX_BOOKMARK_TAG_BYTES} UTF-8 bytes.`
      );
    }
    if (!seen.has(tag)) {
      seen.add(tag);
      normalized.push(tag);
    }
  }

  if (normalized.length > MAX_BOOKMARK_TAGS) {
    throw new BookmarkTagValidationError(
      `Bookmarks can have at most ${MAX_BOOKMARK_TAGS} tags.`
    );
  }

  return normalized;
}

export function appendBookmarkTag(
  tags: readonly string[],
  authoredValue: string
): string[] {
  return normalizeBookmarkTags([...tags, authoredValue]);
}

export function splitAuthoredBookmarkTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}
