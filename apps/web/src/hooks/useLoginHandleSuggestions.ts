"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  loginHandleSearchQuery,
  searchLoginHandles,
} from "@/lib/loginHandleTypeahead";

export function useLoginHandleSuggestions(value: string) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), 200);
    return () => window.clearTimeout(timeout);
  }, [value]);

  const query = loginHandleSearchQuery(debouncedValue);
  return useQuery({
    queryKey: ["login-handle-typeahead", query],
    queryFn: ({ signal }) => searchLoginHandles(query ?? "", signal),
    enabled: Boolean(query),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
}
