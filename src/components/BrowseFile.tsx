"use client";

import ImageGuideModal from "@/components/ImageGuideModal";

// Native file inputs render as "Choose File / No file chosen" with no way
// to restyle the button portion cross-browser — so the real input is
// visually hidden and triggered by a styled button instead. Shared between
// Upload Here and Upload by Admin so both pages' core-file drop zones look
// identical.
export default function BrowseFile({ label, hint, file, onPick, guideImage }: {
  label: string; hint: string; file: File | null; onPick: (f: File | null) => void; guideImage?: string;
}) {
  const inputId = `browse-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div style={{ padding: 16, border: "1px dashed rgba(201,162,39,.35)", borderRadius: 14, background: "rgba(15,32,64,.4)", display: "flex", flexDirection: "column" }}>
      <label style={{ fontSize: 12, color: "#cdd9f0", fontWeight: 600, display: "block", marginBottom: 10 }}>
        {label} <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 11 }}>({hint})</span>
      </label>
      <input id={inputId} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      <label htmlFor={inputId} className="btn-ghost" style={{ display: "inline-block", padding: "8px 20px", cursor: "pointer", fontSize: 12.5, alignSelf: "flex-start" }}>
        Browse File
      </label>
      <span style={{ marginTop: 8, fontSize: 11.5, color: file ? "var(--gold)" : "var(--muted)" }}>
        {file ? `✓ ${file.name}` : "No file chosen"}
      </span>
      {guideImage && (
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <ImageGuideModal image={guideImage} />
        </div>
      )}
    </div>
  );
}
