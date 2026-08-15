import { describe, expect, it } from "bun:test";
import type { Agent } from "@atproto/api";

import {
  acceptedUserInputPhotos,
  createUserInputFeedbackWithAgent,
  fetchUserInputBoardReference,
  MAX_USER_INPUT_PHOTOS,
  requireUserInputFeedbackScopes,
  USER_INPUT_BLOB_OAUTH_SCOPE,
  USER_INPUT_BOARD_API_URL,
  USER_INPUT_BOARD_URI,
  USER_INPUT_BOARD_URL,
  USER_INPUT_REAUTH_MESSAGE,
  userInputDiscussionUrl,
} from "@/lib/userInputFeedback";

describe("User Input feedback", () => {
  it("targets the L@tr.link board and supports four photos", () => {
    expect(USER_INPUT_BOARD_URL).toBe(
      "https://userinput.app/s/did:plc:qy5pluw2bsuq2x6albsgkvx3/3msgeiqdplp2m?lang=en"
    );
    expect(MAX_USER_INPUT_PHOTOS).toBe(4);
  });

  it("loads and validates the configured board reference", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetcher = async (input: string, init?: RequestInit) => {
      calls.push([input, init]);
      return Response.json({
        board: {
          uri: USER_INPUT_BOARD_URI,
          cid: "bafyreifeedback",
          value: {
            tags: [
              { label: "Bug", value: "bug" },
              { label: "Feature", value: "feature" },
              { label: 42, value: "invalid" },
            ],
          },
        },
      });
    };

    await expect(fetchUserInputBoardReference(fetcher)).resolves.toEqual({
      uri: USER_INPUT_BOARD_URI,
      cid: "bafyreifeedback",
      tags: [
        { label: "Bug", value: "bug" },
        { label: "Feature", value: "feature" },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(USER_INPUT_BOARD_API_URL);
    expect(calls[0]?.[1]?.cache).toBe("no-store");
  });

  it("rejects a response for a different board", async () => {
    const fetcher = async () =>
      Response.json({
        board: {
          uri: "at://did:plc:other/app.userinput.space/other",
          cid: "bafyreifeedback",
        },
      });

    await expect(fetchUserInputBoardReference(fetcher)).rejects.toThrow(
      "invalid response"
    );
  });

  it("accepts permission sets plus direct and expanded repo permissions", async () => {
    const permitted = {
      getTokenInfo: async () => ({
        scope:
          "atproto include:app.userinput.authFull?aud=did%3Aweb%3Auserinput.app",
      }),
    };
    const granularPermissions = {
      getTokenInfo: async () => ({
        scope: "atproto repo:app.userinput.discussion?action=create",
      }),
    };
    const expandedPermissionSet = {
      getTokenInfo: async () => ({
        scope:
          "atproto repo?collection=app.userinput.ban&collection=app.userinput.discussion&collection=app.userinput.reply",
      }),
    };
    const staleSession = {
      getTokenInfo: async () => ({ scope: "atproto" }),
    };

    await expect(
      requireUserInputFeedbackScopes(permitted as never)
    ).resolves.toBeUndefined();
    await expect(
      requireUserInputFeedbackScopes(granularPermissions as never)
    ).resolves.toBeUndefined();
    await expect(
      requireUserInputFeedbackScopes(expandedPermissionSet as never)
    ).resolves.toBeUndefined();
    await expect(
      requireUserInputFeedbackScopes(staleSession as never)
    ).rejects.toThrow(USER_INPUT_REAUTH_MESSAGE);
  });

  it("requires blob access only when feedback includes photos", async () => {
    const withoutBlobAccess = {
      getTokenInfo: async () => ({
        scope: "atproto include:app.userinput.authFull",
      }),
    };
    const withBlobAccess = {
      getTokenInfo: async () => ({
        scope: `atproto include:app.userinput.authFull ${USER_INPUT_BLOB_OAUTH_SCOPE}`,
      }),
    };
    const withExpandedBlobAccess = {
      getTokenInfo: async () => ({
        scope:
          "atproto repo?collection=app.userinput.discussion blob?accept=image%2F*&accept=video%2F*",
      }),
    };

    await expect(
      requireUserInputFeedbackScopes(withoutBlobAccess as never, ["image/png"])
    ).rejects.toThrow(USER_INPUT_REAUTH_MESSAGE);
    await expect(
      requireUserInputFeedbackScopes(withBlobAccess as never, [
        "image/png",
        "image/jpeg",
      ])
    ).resolves.toBeUndefined();
    await expect(
      requireUserInputFeedbackScopes(withExpandedBlobAccess as never, [
        "image/png",
        "image/jpeg",
      ])
    ).resolves.toBeUndefined();
  });

  it("filters non-images and caps attachments at four", () => {
    const photos = acceptedUserInputPhotos([], [
      new File(["1"], "one.png", { type: "image/png" }),
      new File(["no"], "notes.txt", { type: "text/plain" }),
      new File(["2"], "two.jpg", { type: "image/jpeg" }),
      new File(["3"], "three.webp", { type: "image/webp" }),
      new File(["4"], "four.gif", { type: "image/gif" }),
      new File(["5"], "five.png", { type: "image/png" }),
    ]);

    expect(photos.map((photo) => photo.name)).toEqual([
      "one.png",
      "two.jpg",
      "three.webp",
      "four.gif",
    ]);
  });

  it("publishes the native discussion envelope and best-effort upvote", async () => {
    const calls: Array<{ method: string; input: unknown }> = [];
    const agent = {
      uploadBlob: async (photo: File) => {
        calls.push({ method: "uploadBlob", input: photo.name });
        return {
          data: {
            blob: {
              $type: "blob",
              ref: { $link: "bafkreifeedback" },
              mimeType: photo.type,
              size: photo.size,
            },
          },
        };
      },
      api: {
        com: {
          atproto: {
            repo: {
              createRecord: async (input: unknown) => {
                calls.push({ method: "createRecord", input });
                return {
                  data: {
                    uri: "at://did:plc:viewer/app.userinput.discussion/3feedback",
                    cid: "bafyreidiscussion",
                  },
                };
              },
              putRecord: async (input: unknown) => {
                calls.push({ method: "putRecord", input });
                throw new Error("Upvotes are best-effort");
              },
            },
          },
        },
      },
    } as unknown as Pick<Agent, "api" | "uploadBlob">;

    await expect(
      createUserInputFeedbackWithAgent(agent, "did:plc:viewer", {
        board: { uri: USER_INPUT_BOARD_URI, cid: "bafyreifeedback" },
        title: "  Image uploads  ",
        body: "  A screenshot is attached.  ",
        tags: ["bug"],
        photos: [new File(["png"], "screenshot.png", { type: "image/png" })],
      })
    ).resolves.toEqual({
      uri: "at://did:plc:viewer/app.userinput.discussion/3feedback",
      cid: "bafyreidiscussion",
    });

    const create = calls.find((call) => call.method === "createRecord")
      ?.input as {
      repo: string;
      collection: string;
      record: Record<string, unknown>;
    };
    expect(create.repo).toBe("did:plc:viewer");
    expect(create.collection).toBe("app.userinput.discussion");
    expect(create.record.title).toBe("Image uploads");
    expect(create.record.body).toBe("A screenshot is attached.");
    expect(create.record.space).toEqual({
      uri: USER_INPUT_BOARD_URI,
      cid: "bafyreifeedback",
    });
    expect(create.record.images).toEqual([
      {
        image: {
          $type: "blob",
          ref: { $link: "bafkreifeedback" },
          mimeType: "image/png",
          size: 3,
        },
        alt: "screenshot.png",
      },
    ]);

    const upvote = calls.find((call) => call.method === "putRecord")?.input as {
      collection: string;
      rkey: string;
      record: Record<string, unknown>;
    };
    expect(upvote.collection).toBe("app.userinput.upvote");
    expect(upvote.rkey).toBe("3feedback");
    expect(upvote.record.subject).toEqual({
      uri: "at://did:plc:viewer/app.userinput.discussion/3feedback",
      cid: "bafyreidiscussion",
    });
  });

  it("builds the public discussion URL from an AT URI", () => {
    expect(
      userInputDiscussionUrl(
        "at://did:plc:viewer/app.userinput.discussion/3testfeedback"
      )
    ).toBe(
      "https://userinput.app/d/did%3Aplc%3Aviewer/3testfeedback?lang=en"
    );
    expect(userInputDiscussionUrl("not-an-at-uri")).toBeNull();
  });
});
