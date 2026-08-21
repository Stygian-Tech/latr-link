import type { Metadata } from "next";

import { LibraryChrome } from "./LibraryChrome";

export const metadata: Metadata = {
  title: {
    default: "Library",
    template: "%s · L@tr.link",
  },
};

export default function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <LibraryChrome>{children}</LibraryChrome>;
}
