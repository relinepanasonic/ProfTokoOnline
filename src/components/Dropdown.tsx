"use client";

import { useEffect, useRef, useState } from "react";

export type DropdownOption = string | { value: string; label: string };

function optValue(o: DropdownOption): string { return typeof o === "string" ? o : o.value; }
function optLabel(o: DropdownOption): string { return typeof o === "string" ? o : o.label; }

// Custom styled dropdown — replaces the ugly native OS <select> menu.
// `direction="up"` opens the menu above the button (for controls near the
// bottom of a card); default "down" opens below (for controls near the top).
export default function Dropdown({ value, options, placeholder, emptyText, error, onChange, direction = "down" }: {
  value: string;
  options: DropdownOption[];
  placeholder: string;
  emptyText?: string;
  error?: boolean;
  onChange: (v: string) => void;
  direction?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = options.find((o) => optValue(o) === value);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "9px 12px", borderRadius: 10, cursor: "pointer", textAlign: "left",
          background: "rgba(10,22,40,.6)",
          border: `1px solid ${error ? "rgba(239,68,68,.55)" : open ? "var(--gold)" : "rgba(201,162,39,.22)"}`,
          color: value ? "var(--text)" : "var(--muted)", fontSize: 13, outline: "none",
          transition: "border-color .15s",
        }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? optLabel(selected) : placeholder}
        </span>
        <span style={{ fontSize: 10, color: "var(--gold)", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: "absolute", zIndex: 50, left: 0, right: 0,
          ...(direction === "up" ? { bottom: "calc(100% + 4px)" } : { top: "calc(100% + 4px)" }),
          background: "var(--navy, #0e1d33)", border: "1px solid var(--gold)", borderRadius: 10,
          boxShadow: direction === "up" ? "0 -8px 32px rgba(0,0,0,.55)" : "0 12px 32px rgba(0,0,0,.55)",
          overflow: "hidden", maxHeight: 240, overflowY: "auto",
        }}>
          {options.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
              {emptyText || "No options"}
            </div>
          ) : (
            options.map((o) => {
              const v = optValue(o), l = optLabel(o);
              const active = v === value;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => { onChange(v); setOpen(false); }}
                  style={{
                    width: "100%", display: "block", textAlign: "left",
                    padding: "9px 12px", border: "none", cursor: "pointer", fontSize: 13,
                    background: active ? "rgba(201,162,39,.18)" : "transparent",
                    color: active ? "var(--gold)" : "var(--text)",
                    fontWeight: active ? 700 : 400,
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(201,162,39,.08)"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  {l}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
