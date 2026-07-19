"use client";

import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc" | null;
export type SortConfig<T> = { key: keyof T | null; direction: SortDirection };

// Numbers compare numerically; everything else (including currency-like
// strings such as "Rp 1.234.000") falls back to a numeric-aware compare
// when both sides look numeric, otherwise plain alphabetical. Nulls/
// undefined always sort to the end regardless of direction.
function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;

  const as = String(a).trim();
  const bs = String(b).trim();
  const an = Number(as.replace(/[^0-9.-]/g, ""));
  const bn = Number(bs.replace(/[^0-9.-]/g, ""));
  const looksNumeric = as !== "" && bs !== "" && /[0-9]/.test(as) && /[0-9]/.test(bs) && !Number.isNaN(an) && !Number.isNaN(bn);
  if (looksNumeric) return an - bn;

  return as.localeCompare(bs);
}

// Generic client-side table sort. First click on a column sorts descending
// (matches the convention already used across this app's tables — highest
// value first); a second click on the same column flips to ascending.
export function useTableSort<T>(data: T[], initialKey?: keyof T) {
  const [sortConfig, setSortConfig] = useState<SortConfig<T>>({
    key: initialKey ?? null,
    direction: initialKey ? "desc" : null,
  });

  const sortedData = useMemo(() => {
    const { key, direction } = sortConfig;
    if (!key || !direction) return data;
    const dir = direction === "asc" ? 1 : -1;
    return [...data].sort((a, b) => compareValues(a[key], b[key]) * dir);
  }, [data, sortConfig]);

  function requestSort(key: keyof T) {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "desc" ? "asc" : "desc",
    }));
  }

  return { sortedData, sortConfig, requestSort };
}
