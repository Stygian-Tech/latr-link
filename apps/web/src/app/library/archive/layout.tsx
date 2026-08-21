import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Archive",
};

export default function ArchiveLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
