export default function Placeholder({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="panel">
      <div className="coming">
        <div className="big">{icon}</div>
        <h3 style={{ fontSize: 18, color: "#fff", margin: 0 }}>{title}</h3>
        <p style={{ maxWidth: 420, margin: 0 }}>{desc}</p>
        <span className="pill warn" style={{ marginTop: 6 }}>Coming next</span>
      </div>
    </div>
  );
}
