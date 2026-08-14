import type { ResolvedPreview } from "@/lib/resolveSubject";
import type { LatrBookmarkView } from "@/lib/latrRecords";

export type SavedRow = {
  rec: LatrBookmarkView;
  preview: ResolvedPreview;
  local?: {
    archivedAt?: string;
  };
};
