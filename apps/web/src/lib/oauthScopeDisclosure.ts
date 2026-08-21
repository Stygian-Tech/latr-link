export type OAuthScopeDisclosureGroup = Readonly<{
  title: string;
  detail: string;
  webOnly?: boolean;
}>;

export const OAUTH_SCOPE_DISCLOSURE_GROUPS: readonly OAuthScopeDisclosureGroup[] = [
  {
    title: "Bookmarks",
    detail: "Create, update, and delete community bookmark records in your public repository.",
  },
  {
    title: "Reading State",
    detail: "Create, update, and delete L@tr metadata attached to bookmarks, including unread and archived state.",
  },
  {
    title: "Migration Cleanup",
    detail: "Delete obsolete L@tr records only after they have been migrated.",
  },
  {
    title: "Feedback and Photos",
    detail: "Publish feedback to User Input and upload only the images you attach. This access is requested by the web app, not the extension.",
    webOnly: true,
  },
] as const;

export const OAUTH_SCOPE_LIMITATION_DISCLOSURE =
  "Public repository reads do not require additional permission. L@tr.link cannot post to feeds, edit your profile, read messages or email, or manage your account.";
