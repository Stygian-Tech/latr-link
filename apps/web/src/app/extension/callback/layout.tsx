import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Extension Sign In",
};

export default function ExtensionCallbackLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
