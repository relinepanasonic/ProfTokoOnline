/* Reusable loading indicators — a gold rotating ring + "Memuat data…" text.
   <Loader /> is the small inline variant (e.g. in a filter bar).
   <Loader center /> is the big centred variant (e.g. over skeleton cards). */
export function Ring({ size = 18, stroke = 2.5 }: { size?: number; stroke?: number }) {
  return <span className="pt-ring" style={{ width: size, height: size, borderWidth: stroke }} aria-hidden />;
}

export default function Loader({ center, size, label = "Memuat data…" }: { center?: boolean; size?: number; label?: string }) {
  if (center) {
    return (
      <div className="pt-loading-center" role="status" aria-live="polite">
        <Ring size={size ?? 40} stroke={4} />
        <span>{label}</span>
      </div>
    );
  }
  return (
    <span className="pt-loading" role="status" aria-live="polite">
      <Ring size={size ?? 18} stroke={2.5} /> {label}
    </span>
  );
}
