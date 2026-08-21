import {
  COLLECTION_BOOKMARK,
  COLLECTION_BOOKMARK_METADATA,
  type SavedItemState,
} from "@/lib/latrRecords";
import { rkeyFromAtUri } from "@/lib/rkey";
import type { SavedRow } from "@/lib/savedLibraryTypes";

const demoNow = "2026-07-07T14:00:00.000Z";

type DemoSeed = {
  rkey: string;
  title: string;
  excerpt: string;
  site: string;
  author?: string;
  url: string;
  savedAt: string;
  readMinutes: number;
  image?: string;
  kind?: SavedRow["preview"]["kind"];
  state?: SavedItemState;
  archivedAt?: string;
  tags?: string[];
};

function localWithoutArchivedAt(row: SavedRow): SavedRow["local"] {
  const local = row.local;
  if (!local) return undefined;
  const nextLocal = { ...local };
  delete nextLocal.archivedAt;
  return Object.keys(nextLocal).length > 0 ? nextLocal : undefined;
}

const demoSeeds: DemoSeed[] = [
  {
    rkey: "slower-technology",
    title: "The case for slower technology",
    excerpt:
      "Why intentionally slower technology can lead to better products, happier teams, and more sustainable businesses.",
    site: "The Verge",
    author: "Casey Newton",
    url: "https://example.com/slower-technology",
    savedAt: "2026-07-07T13:14:00.000Z",
    readMinutes: 6,
    image:
      "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=320&q=80",
    tags: ["technology", "work"],
  },
  {
    rkey: "second-brain",
    title: "Building a second brain that actually works",
    excerpt:
      "A practical guide to capturing, organizing, and using knowledge so you can think more clearly and create more value.",
    site: "Farnam Street",
    author: "Shane Parrish",
    url: "https://example.com/second-brain",
    savedAt: "2026-07-07T12:38:00.000Z",
    readMinutes: 8,
    image:
      "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=320&q=80",
    tags: ["knowledge", "work"],
  },
  {
    rkey: "remote-work-collaboration",
    title: "How remote work reshaped collaboration",
    excerpt:
      "New research on what is working, what is not, and how teams can build better rhythms together.",
    site: "Harvard Business Review",
    url: "https://example.com/remote-work-collaboration",
    savedAt: "2026-07-06T20:28:00.000Z",
    readMinutes: 5,
    image:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=320&q=80",
    tags: ["work"],
  },
  {
    rkey: "tiny-habits",
    title: "The overlooked power of tiny habits",
    excerpt:
      "Small, consistent changes compound into remarkable results over time. Here is how to start.",
    site: "James Clear",
    url: "https://example.com/tiny-habits",
    savedAt: "2026-07-06T15:10:00.000Z",
    readMinutes: 4,
    image:
      "https://images.unsplash.com/photo-1512428813834-c702c7702b78?auto=format&fit=crop&w=320&q=80",
    tags: ["habits"],
  },
  {
    rkey: "ai-terminal",
    title: "Warp Terminal: the AI-powered terminal for developers",
    excerpt:
      "Block-based editing, autocomplete, and native agent orchestration for a calmer command line.",
    site: "Warp",
    url: "https://example.com/warp-terminal-ai",
    savedAt: "2026-07-06T10:55:00.000Z",
    readMinutes: 5,
    image:
      "https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=320&q=80",
  },
  {
    rkey: "siri-ai-works",
    title: "I tried Siri AI, and so far it actually works",
    excerpt:
      "A practical look at voice assistants when they become useful enough to keep in the daily workflow.",
    site: "The Verge",
    url: "https://example.com/siri-ai-works",
    savedAt: "2026-07-05T21:30:00.000Z",
    readMinutes: 4,
    image:
      "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=320&q=80",
  },
  {
    rkey: "remctl-reminders",
    title: "Introducing RemCTL: the power-user reminders CLI for macOS and AI agents",
    excerpt:
      "A small utility for exposing the latest Reminders features to scripts, agents, and terminal-first workflows.",
    site: "MacStories",
    url: "https://example.com/remctl-reminders-cli",
    savedAt: "2026-07-05T16:42:00.000Z",
    readMinutes: 6,
    image:
      "https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?auto=format&fit=crop&w=320&q=80",
  },
  {
    rkey: "underground-missile-sites",
    title: "Iran's reopened underground missile sites show limits of US bombing plan",
    excerpt:
      "Satellite analysis and reporting on how hardened infrastructure changes military planning.",
    site: "CNN",
    url: "https://example.com/underground-missile-sites",
    savedAt: "2026-07-04T22:21:00.000Z",
    readMinutes: 7,
    image:
      "https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&w=320&q=80",
  },
  {
    rkey: "focus-thread",
    title: "A thread on focus in a noisy world",
    excerpt:
      "Some thoughts on protecting your attention and doing meaningful work.",
    site: "@jason.bsky.social",
    url: "https://bsky.app/profile/jason.bsky.social/post/focus",
    savedAt: "2026-07-05T18:42:00.000Z",
    readMinutes: 2,
    kind: "post",
  },
  {
    rkey: "design-tools-thread",
    title: "A thread on keeping design tools fast",
    excerpt:
      "Notes on file hygiene, component naming, and how to keep creative work from bogging down.",
    site: "@mira.bsky.social",
    url: "https://bsky.app/profile/mira.bsky.social/post/design-tools",
    savedAt: "2026-07-05T14:18:00.000Z",
    readMinutes: 2,
    kind: "post",
  },
  {
    rkey: "solo-developer-velocity",
    title: "Increasing my velocity as a solo developer",
    excerpt:
      "A reflection on the workflow and AI tools that let me keep shipping while working full-time and traveling.",
    site: "blog.stygiantech.dev",
    url: "at://did:plc:latrlocaldemo/site.standard.article/solo-developer-velocity",
    savedAt: "2026-07-04T12:35:00.000Z",
    readMinutes: 5,
    kind: "record",
    image:
      "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=320&q=80",
  },
  {
    rkey: "meal-planning",
    title: "Sunday dinner recipes worth trying",
    excerpt:
      "A few weeknight ideas to revisit before grocery shopping, with pantry notes and timing.",
    site: "Food & Home",
    url: "https://example.com/sunday-dinner-recipes",
    savedAt: "2026-07-03T23:12:00.000Z",
    readMinutes: 6,
    image:
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=320&q=80",
  },
  {
    rkey: "shopping-list-record",
    title: "Gift ideas to revisit before Friday",
    excerpt:
      "A saved protocol record for a shopping note that belongs in Other instead of Articles.",
    site: "Shopping Guide",
    url: "at://did:plc:latrlocaldemo/link.latr.saved.note/gift-ideas",
    savedAt: "2026-07-03T18:04:00.000Z",
    readMinutes: 2,
    kind: "record",
  },
  {
    rkey: "free-software-costs",
    title: "The hidden costs of free software",
    excerpt:
      "When free tools come with a price: privacy, dependency, and long-term risk.",
    site: "The Atlantic",
    url: "https://example.com/free-software-costs",
    savedAt: "2026-07-05T11:19:00.000Z",
    readMinutes: 7,
    image:
      "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=320&q=80",
    state: "archived",
    archivedAt: "2026-07-07T09:05:00.000Z",
    tags: ["technology", "privacy"],
  },
  {
    rkey: "neighborhood-parks",
    title: "A weekend guide to neighborhood parks",
    excerpt:
      "A calm planning guide for short walks, playgrounds, and nearby shade when the weekend opens up.",
    site: "City Magazine",
    url: "https://example.com/weekend-neighborhood-parks",
    savedAt: "2026-07-02T17:45:00.000Z",
    readMinutes: 8,
    image:
      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=320&q=80",
    state: "archived",
    archivedAt: "2026-07-07T08:24:00.000Z",
    tags: ["weekend plans"],
  },
  {
    rkey: "css-container-queries",
    title: "A field guide to practical container queries",
    excerpt:
      "Patterns for using container queries in dashboards, cards, media grids, and dense product screens.",
    site: "CSS-Tricks",
    url: "https://example.com/container-queries-field-guide",
    savedAt: "2026-07-01T19:26:00.000Z",
    readMinutes: 9,
    image:
      "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=320&q=80",
    state: "archived",
    archivedAt: "2026-07-06T16:42:00.000Z",
  },
  {
    rkey: "book-notes-archive",
    title: "Notes from a reread of The Checklist Manifesto",
    excerpt:
      "Short book notes on repeatable systems, team communication, and reducing avoidable errors.",
    site: "Personal Notes",
    url: "https://example.com/checklist-manifesto-notes",
    savedAt: "2026-06-30T11:12:00.000Z",
    readMinutes: 5,
    image:
      "https://images.unsplash.com/photo-1519682337058-a94d519337bc?auto=format&fit=crop&w=320&q=80",
    state: "archived",
    archivedAt: "2026-07-06T10:15:00.000Z",
  },
  {
    rkey: "atproto-record",
    title: "ATProto record reference",
    excerpt:
      "A saved protocol record kept alongside normal links for later review.",
    site: "ATProto",
    url: "at://did:plc:example/app.bsky.feed.post/3demo",
    savedAt: "2026-07-04T19:03:00.000Z",
    readMinutes: 3,
    kind: "record",
  },
];

function bookmarkRecord(seed: DemoSeed) {
  return {
    $type: COLLECTION_BOOKMARK,
    subject: seed.url,
    createdAt: seed.savedAt,
    ...(seed.tags?.length ? { tags: seed.tags } : {}),
  };
}

function rowFromSeed(seed: DemoSeed): SavedRow {
  const value = bookmarkRecord(seed);
  const uri = `at://did:plc:latrlocaldemo/${COLLECTION_BOOKMARK}/${seed.rkey}`;
  return {
    rec: {
      uri,
      cid: `bafyreib${seed.rkey.replace(/-/g, "")}`,
      value,
      metadataRecord: {
        uri: `at://did:plc:latrlocaldemo/${COLLECTION_BOOKMARK_METADATA}/${seed.rkey}`,
        cid: `bafyreim${seed.rkey.replace(/-/g, "")}`,
        value: {
          $type: COLLECTION_BOOKMARK_METADATA,
          bookmarkUri: uri,
          subject: seed.url,
          state: seed.state ?? "unread",
        },
      },
      preview: {
        title: seed.title,
        description: seed.excerpt,
        siteName: seed.site,
        image: seed.image,
        author: seed.author,
      },
    },
    preview: {
      kind: seed.kind ?? "external",
      title: seed.title,
      subtitle: seed.excerpt,
      href: seed.url,
      imageHref: seed.image,
      canonicalUrl: seed.url.startsWith("http") ? seed.url : undefined,
      siteLabel: seed.site,
      authorLabel: seed.author,
    },
    local: seed.archivedAt ? { archivedAt: seed.archivedAt } : undefined,
  };
}

export function createDemoSavedRows(): SavedRow[] {
  return demoSeeds.map(rowFromSeed);
}

export function createDemoSavedRowFromPaste(
  paste: string,
  tags: string[] = []
): SavedRow {
  const trimmed = paste.trim();
  const isUrl = /^https?:\/\//i.test(trimmed);
  const host = (() => {
    if (!isUrl) return "ATProto";
    try {
      return new URL(trimmed).hostname.replace(/^www\./i, "");
    } catch {
      return "Saved Link";
    }
  })();
  const rkey = `demo-${Date.now().toString(36)}`;
  return rowFromSeed({
    rkey,
    title: isUrl ? `Saved from ${host}` : "Saved ATProto record",
    excerpt: isUrl
      ? "A locally added demo item. It stays in this browser session and never calls the gateway."
      : trimmed,
    site: host,
    url: trimmed,
    savedAt: demoNow,
    readMinutes: 3,
    kind: isUrl ? "external" : "record",
    tags,
  });
}

export function readingMinutesForRow(row: SavedRow): number {
  const text = `${row.preview.title} ${row.preview.subtitle ?? ""}`;
  return Math.max(2, Math.min(12, Math.round(text.length / 140) + 2));
}

export function setSavedRowState(
  rows: SavedRow[],
  itemRkey: string,
  state: SavedItemState,
  archivedAt = demoNow
): SavedRow[] {
  return rows.map((row) => {
    if (rkeyFromAtUri(row.rec.uri) !== itemRkey) return row;
    const nextLocal =
      state === "archived"
        ? { ...row.local, archivedAt }
        : localWithoutArchivedAt(row);
    return {
      ...row,
      rec: {
        ...row.rec,
        metadataRecord: {
          ...row.rec.metadataRecord!,
          value: { ...row.rec.metadataRecord!.value, state },
        },
      },
      local: nextLocal,
    };
  });
}

export function removeSavedRow(rows: SavedRow[], itemRkey: string): SavedRow[] {
  return rows.filter((row) => rkeyFromAtUri(row.rec.uri) !== itemRkey);
}

export function setSavedRowTags(
  rows: SavedRow[],
  bookmarkUri: string,
  tags: string[]
): SavedRow[] {
  return rows.map((row) => {
    if (row.rec.uri !== bookmarkUri) return row;
    const value = { ...row.rec.value };
    if (tags.length) value.tags = tags;
    else delete value.tags;
    return { ...row, rec: { ...row.rec, value } };
  });
}

export function renameSavedRowTag(
  rows: SavedRow[],
  source: string,
  replacement: string
): SavedRow[] {
  return rows.map((row) => {
    const tags = row.rec.value.tags;
    if (!tags?.includes(source)) return row;
    const replaced = tags.map((tag) => (tag === source ? replacement : tag));
    return setSavedRowTags([row], row.rec.uri, [...new Set(replaced)])[0]!;
  });
}

export function deleteSavedRowTag(rows: SavedRow[], tag: string): SavedRow[] {
  return rows.map((row) => {
    if (!row.rec.value.tags?.includes(tag)) return row;
    return setSavedRowTags(
      [row],
      row.rec.uri,
      row.rec.value.tags.filter((candidate) => candidate !== tag)
    )[0]!;
  });
}

export function tagCountsForSavedRows(
  rows: SavedRow[]
): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of new Set(row.rec.value.tags ?? [])) {
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => left.tag.localeCompare(right.tag, "en-US"));
}
