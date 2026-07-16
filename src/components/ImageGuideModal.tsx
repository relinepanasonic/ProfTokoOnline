"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

// Small "Lihat Cara Download Data" text link that opens a centered modal
// showing the mapped guide screenshot. Self-contained (owns its own
// open/closed state) so each upload zone can drop one in independently.
export default function ImageGuideModal({ image }: { image: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: "none", border: "none", padding: 0, cursor: "pointer",
          fontSize: 11, color: "var(--gold)", textDecoration: "underline",
          textUnderlineOffset: 2, display: "block", marginBottom: 8,
        }}
      >
        Lihat Cara Download Data
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 200, background: "rgba(4,9,20,.8)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", maxWidth: "min(90vw, 900px)", maxHeight: "90vh" }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn-gold"
              style={{ position: "absolute", top: -14, right: -14, borderRadius: 999, width: 34, height: 34, padding: 0, fontSize: 15, fontWeight: 700, lineHeight: 1 }}
              aria-label="Close"
            >
              ✕
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt="Cara download data dari Shopee"
              style={{ display: "block", maxWidth: "100%", maxHeight: "90vh", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,.5)" }}
            />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
