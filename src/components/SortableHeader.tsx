"use client";

import type { CSSProperties, ReactNode } from "react";
import type { SortConfig } from "@/hooks/useTableSort";

// Renders a clickable <th> with a stacked ▲▼ indicator — dim gray by
// default, gold on whichever direction is currently active. className is
// passed straight to the <th> so callers can add "num" for right-aligned
// numeric columns or "sticky-col sticky-col-1/2" for frozen columns without
// losing this component's own sort behavior/z-index-neutral markup.
export default function SortableHeader<T>({
  label, sortKey, currentSort, onRequestSort, className, style, title,
}: {
  label: ReactNode;
  sortKey: keyof T;
  currentSort: SortConfig<T>;
  onRequestSort: (key: keyof T) => void;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const active = currentSort.key === sortKey;
  return (
    <th
      className={["sortable-th", className].filter(Boolean).join(" ")}
      style={{ cursor: "pointer", whiteSpace: "nowrap", ...style }}
      title={title}
      onClick={() => onRequestSort(sortKey)}
    >
      <span className="sortable-th-inner">
        <span>{label}</span>
        <span className="sort-arrows">
          <span className={"sort-arrow-up" + (active && currentSort.direction === "asc" ? " active" : "")}>▲</span>
          <span className={"sort-arrow-down" + (active && currentSort.direction === "desc" ? " active" : "")}>▼</span>
        </span>
      </span>
    </th>
  );
}
