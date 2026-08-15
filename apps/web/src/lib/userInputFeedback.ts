import { Agent } from "@atproto/api";
import type { OAuthSession } from "@atproto/oauth-client-browser";

import { rkeyFromAtUri } from "@/lib/rkey";

export const USER_INPUT_BOARD_URL =
  "https://userinput.app/s/did:plc:qy5pluw2bsuq2x6albsgkvx3/3msgeiqdplp2m?lang=en";
export const USER_INPUT_BOARD_API_URL =
  "https://userinput.app/api/board/did:plc:qy5pluw2bsuq2x6albsgkvx3/3msgeiqdplp2m";
export const USER_INPUT_BOARD_URI =
  "at://did:plc:qy5pluw2bsuq2x6albsgkvx3/app.userinput.space/3msgeiqdplp2m";

export const USER_INPUT_DISCUSSION_COLLECTION = "app.userinput.discussion";
export const USER_INPUT_UPVOTE_COLLECTION = "app.userinput.upvote";

export const USER_INPUT_OAUTH_SCOPE = "include:app.userinput.authFull";
export const USER_INPUT_BLOB_OAUTH_SCOPE = "blob:*/*";
export const MAX_USER_INPUT_PHOTOS = 4;
export const MAX_USER_INPUT_TITLE_LENGTH = 200;
export const MAX_USER_INPUT_BODY_LENGTH = 10_000;

export const USER_INPUT_REAUTH_MESSAGE =
  "Your session does not include feedback permissions yet. Sign out and sign back in, then try again.";

export interface UserInputTag {
  label: string;
  value: string;
}

export const LOCAL_USER_INPUT_TAGS: UserInputTag[] = [
  { label: "Bug", value: "bug" },
  { label: "Feature", value: "feature" },
  { label: "Question", value: "question" },
  { label: "Comment", value: "comment" },
];

export interface UserInputStrongRef {
  uri: string;
  cid: string;
}

export interface UserInputBoardReference extends UserInputStrongRef {
  tags: UserInputTag[];
}

interface UserInputBoardResponse {
  board?: {
    uri?: unknown;
    cid?: unknown;
    value?: {
      tags?: unknown;
    };
  };
}

type UserInputFetch = (input: string, init?: RequestInit) => Promise<Response>;

function scopeAllowsRepoCreate(scopeToken: string, collection: string): boolean {
  const [repoScope, query = ""] = scopeToken.split("?");
  const params = new URLSearchParams(query);
  const hasCollection =
    repoScope === `repo:${collection}` ||
    repoScope === "repo:*" ||
    (repoScope === "repo" &&
      params
        .getAll("collection")
        .some((value) => value === collection || value === "*"));
  if (!hasCollection) return false;

  const actions = params.getAll("action");
  return actions.length === 0 || actions.includes("create");
}

function scopeName(scopeToken: string): string {
  return scopeToken.split("?", 1)[0] ?? scopeToken;
}

function scopeAllowsBlobMimeType(scopeToken: string, mimeType: string): boolean {
  const [name, query = ""] = scopeToken.split("?");
  const patterns = name.startsWith("blob:")
    ? [name.slice("blob:".length)]
    : name === "blob"
      ? new URLSearchParams(query).getAll("accept")
      : [];
  const [mimeTypeType, mimeTypeSubtype] = mimeType.split("/");
  return patterns.some((pattern) => {
    const [patternType, patternSubtype] = pattern.split("/");
    return (
      (patternType === "*" || patternType === mimeTypeType) &&
      (patternSubtype === "*" || patternSubtype === mimeTypeSubtype)
    );
  });
}

export async function requireUserInputFeedbackScopes(
  session: Pick<OAuthSession, "getTokenInfo">,
  photoMimeTypes: readonly string[] = []
): Promise<void> {
  const info = await session.getTokenInfo("auto");
  const scopes = String(info.scope ?? "").split(/\s+/).filter(Boolean);
  const hasPermissionSet = scopes.some(
    (scope) => scopeName(scope) === USER_INPUT_OAUTH_SCOPE
  );
  const hasDiscussionCreate = scopes.some((scope) =>
    scopeAllowsRepoCreate(scope, USER_INPUT_DISCUSSION_COLLECTION)
  );
  const hasPhotoAccess = photoMimeTypes.every((mimeType) =>
    scopes.some((scope) => scopeAllowsBlobMimeType(scope, mimeType))
  );

  if ((!hasPermissionSet && !hasDiscussionCreate) || !hasPhotoAccess) {
    throw new Error(USER_INPUT_REAUTH_MESSAGE);
  }
}

export async function fetchUserInputBoardReference(
  fetcher: UserInputFetch = fetch,
  signal?: AbortSignal
): Promise<UserInputBoardReference> {
  const response = await fetcher(USER_INPUT_BOARD_API_URL, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(
      "The feedback board is unavailable right now. Try again shortly."
    );
  }

  const payload = (await response.json()) as UserInputBoardResponse;
  const uri = payload.board?.uri;
  const cid = payload.board?.cid;
  if (uri !== USER_INPUT_BOARD_URI || typeof cid !== "string" || !cid) {
    throw new Error("The feedback board returned an invalid response.");
  }

  const rawTags = payload.board?.value?.tags;
  const tags = Array.isArray(rawTags)
    ? rawTags.flatMap((tag) => {
        if (!tag || typeof tag !== "object") return [];
        const label = "label" in tag ? tag.label : undefined;
        const value = "value" in tag ? tag.value : undefined;
        return typeof label === "string" && typeof value === "string"
          ? [{ label, value }]
          : [];
      })
    : [];

  return { uri, cid, tags };
}

export function userInputDiscussionUrl(uri: string): string | null {
  const match = /^at:\/\/([^/]+)\/app\.userinput\.discussion\/([^/]+)$/.exec(
    uri
  );
  if (!match) return null;
  return `https://userinput.app/d/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}?lang=en`;
}

export function acceptedUserInputPhotos(
  existing: readonly File[],
  candidates: Iterable<File>
): File[] {
  const remaining = Math.max(0, MAX_USER_INPUT_PHOTOS - existing.length);
  if (remaining === 0) return [...existing];
  const accepted = Array.from(candidates)
    .filter((file) => file.type.startsWith("image/"))
    .slice(0, remaining);
  return [...existing, ...accepted];
}

type UserInputAgent = Pick<Agent, "api" | "uploadBlob">;

export async function createUserInputFeedbackWithAgent(
  agent: UserInputAgent,
  did: string,
  input: {
    board: UserInputStrongRef;
    title: string;
    body?: string;
    tags?: string[];
    photos?: File[];
  }
): Promise<UserInputStrongRef> {
  const title = input.title.trim();
  const body = input.body?.trim();
  if (!title) throw new Error("Add a title for your feedback.");
  if (title.length > MAX_USER_INPUT_TITLE_LENGTH) {
    throw new Error("Feedback titles must be 200 characters or fewer.");
  }
  if ((body?.length ?? 0) > MAX_USER_INPUT_BODY_LENGTH) {
    throw new Error("Feedback details must be 10,000 characters or fewer.");
  }

  const photos = acceptedUserInputPhotos([], input.photos ?? []);
  const images = await Promise.all(
    photos.map(async (photo) => ({
      image: (await agent.uploadBlob(photo)).data.blob,
      alt: photo.name || "Feedback image",
    }))
  );
  const createdAt = new Date().toISOString();
  const response = await agent.api.com.atproto.repo.createRecord({
    repo: did,
    collection: USER_INPUT_DISCUSSION_COLLECTION,
    record: {
      $type: USER_INPUT_DISCUSSION_COLLECTION,
      space: input.board,
      title,
      ...(body ? { body } : {}),
      ...(input.tags?.length ? { tags: input.tags } : {}),
      ...(images.length ? { images } : {}),
      createdAt,
    },
  });
  const discussion = {
    uri: response.data.uri,
    cid: response.data.cid,
  };

  const rkey = rkeyFromAtUri(discussion.uri);
  if (rkey) {
    await agent.api.com.atproto.repo
      .putRecord({
        repo: did,
        collection: USER_INPUT_UPVOTE_COLLECTION,
        rkey,
        record: {
          $type: USER_INPUT_UPVOTE_COLLECTION,
          subject: discussion,
          createdAt,
        },
      })
      .catch(() => undefined);
  }

  return discussion;
}

export async function createUserInputFeedback(
  session: OAuthSession,
  did: string,
  input: Parameters<typeof createUserInputFeedbackWithAgent>[2]
): Promise<UserInputStrongRef> {
  return createUserInputFeedbackWithAgent(new Agent(session), did, input);
}
