type SearchParamsReader = Pick<URLSearchParams, "toString">;

export function selectedBookmarkTag(
  searchParams: Pick<URLSearchParams, "get">
): string | undefined {
  const tag = searchParams.get("tag")?.trim();
  return tag || undefined;
}

export function libraryHrefWithTag(
  pathname: string,
  searchParams: SearchParamsReader,
  tag: string | undefined
): string {
  const next = new URLSearchParams(searchParams.toString());
  if (tag) next.set("tag", tag);
  else next.delete("tag");
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}
