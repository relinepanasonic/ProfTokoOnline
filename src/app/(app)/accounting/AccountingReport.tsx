"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_PROONE_API_URL ?? "https://prooneaccounting.vercel.app/api/v1";
const API_KEY = process.env.NEXT_PUBLIC_PROONE_API_KEY ?? "";
const MONTHS = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];

function fmtRp(n: number) { return "Rp " + Math.round(n || 0).toLocaleString("id-ID"); }

type PL = { revenue?: { total?: number; invoiceCount?: number }; expenses?: { total?: number; byCategory?: Record<string, number> }; summary?: { grossProfit?: number; netProfit?: number; ppnDue?: number } };
type BS = { assets?: { total?: number; cash?: number; accountsReceivable?: number; unpaidInvoices?: number }; liabilities?: { total?: number }; equity?: { total?: number } };
type CF = { operating?: { inflows?: number; outflows?: number; net?: number }; balances?: { opening?: number; closing?: number } };

const REPORT_TABS = [
  { v: "pl", l: "P&L" },
  { v: "cashflow", l: "Cash Flow" },
  { v: "balance", l: "Balance Sheet" },
] as const;

function Row({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <span style={{ color: "var(--muted)", fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: bold ? 800 : 600, fontSize: bold ? 15 : 13.5, color: color || "#fff" }}>{value}</span>
    </div>
  );
}

export default function AccountingReport() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [sub, setSub] = useState<(typeof REPORT_TABS)[number]["v"]>("pl");
  const [pl, setPl] = useState<PL | null>(null);
  const [bs, setBs] = useState<BS | null>(null);
  const [cf, setCf] = useState<CF | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!API_KEY) { setError("NEXT_PUBLIC_PROONE_API_KEY belum diset"); setLoading(false); return; }
    setLoading(true); setError("");
    const headers = { Authorization: `Bearer ${API_KEY}` };
    const params = `?year=${year}&month=${month}`;
    Promise.all([
      fetch(`${API_URL}/reports/pl${params}`, { headers }).then((r) => r.json()),
      fetch(`${API_URL}/reports/balance-sheet${params}`, { headers }).then((r) => r.json()),
      fetch(`${API_URL}/reports/cash-flow${params}`, { headers }).then((r) => r.json()),
    ]).then(([plData, bsData, cfData]) => {
      setPl(plData.success ? plData.data : null);
      setBs(bsData.success ? bsData.data : null);
      setCf(cfData.success ? cfData.data : null);
      if (!plData.success) setError(plData.error ?? "Gagal memuat laporan");
    }).catch(() => setError("Tidak dapat terhubung ke Proone Accounting"))
      .finally(() => setLoading(false));
  }, [year, month]);

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0 }}>Report</h3>
          <div className="hint">Data dari Proone Accounting — {MONTHS[month - 1]} {year}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={selStyle}>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={selStyle}>
            {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {REPORT_TABS.map((t) => (
          <button key={t.v} onClick={() => setSub(t.v)} style={tabBtn(sub === t.v)}>{t.l}</button>
        ))}
      </div>

      {error && (
        <div style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 10, padding: "10px 14px", color: "#ff9a9a", fontSize: 13, marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--muted)", padding: "30px 0", textAlign: "center" }}>Loading…</div>
      ) : (
        <div style={{ maxWidth: 520 }}>
          {sub === "pl" && pl && (
            <>
              <Row label="Pendapatan" value={fmtRp(pl.revenue?.total ?? 0)} color="#4ade80" />
              <Row label="Jumlah Invoice Lunas" value={String(pl.revenue?.invoiceCount ?? 0)} />
              <Row label="Total Pengeluaran" value={fmtRp(pl.expenses?.total ?? 0)} color="#f87171" />
              {pl.expenses?.byCategory && Object.entries(pl.expenses.byCategory).map(([cat, amt]) => (
                <Row key={cat} label={`— ${cat}`} value={fmtRp(amt)} color="#f87171" />
              ))}
              <Row label="Laba Kotor" value={fmtRp(pl.summary?.grossProfit ?? 0)} bold color={(pl.summary?.grossProfit ?? 0) >= 0 ? "#4ade80" : "#f87171"} />
              <Row label="Laba Bersih" value={fmtRp(pl.summary?.netProfit ?? 0)} bold color={(pl.summary?.netProfit ?? 0) >= 0 ? "#c9a227" : "#f87171"} />
              <Row label="PPN Terhutang" value={fmtRp(pl.summary?.ppnDue ?? 0)} />
            </>
          )}
          {sub === "cashflow" && cf && (
            <>
              <Row label="Saldo Awal" value={fmtRp(cf.balances?.opening ?? 0)} />
              <Row label="Kas Masuk" value={fmtRp(cf.operating?.inflows ?? 0)} color="#4ade80" />
              <Row label="Kas Keluar" value={fmtRp(cf.operating?.outflows ?? 0)} color="#f87171" />
              <Row label="Arus Kas Bersih" value={fmtRp(cf.operating?.net ?? 0)} bold color={(cf.operating?.net ?? 0) >= 0 ? "#4ade80" : "#f87171"} />
              <Row label="Saldo Akhir" value={fmtRp(cf.balances?.closing ?? 0)} bold color="#c9a227" />
            </>
          )}
          {sub === "balance" && bs && (
            <>
              <Row label="Kas" value={fmtRp(bs.assets?.cash ?? 0)} />
              <Row label="Piutang (AR)" value={fmtRp(bs.assets?.accountsReceivable ?? 0)} />
              <Row label="Invoice Belum Lunas" value={String(bs.assets?.unpaidInvoices ?? 0)} />
              <Row label="Total Aset" value={fmtRp(bs.assets?.total ?? 0)} bold color="#60a5fa" />
              <Row label="Total Kewajiban" value={fmtRp(bs.liabilities?.total ?? 0)} color="#f87171" />
              <Row label="Ekuitas" value={fmtRp(bs.equity?.total ?? 0)} bold color="#4ade80" />
            </>
          )}
          {!pl && !bs && !cf && !error && (
            <div style={{ color: "var(--muted)", textAlign: "center", padding: "20px 0" }}>Tidak ada data untuk periode ini</div>
          )}
        </div>
      )}
    </div>
  );
}

const selStyle: React.CSSProperties = { background: "rgba(10,22,40,.8)", border: "1px solid rgba(201,162,39,.3)", color: "var(--text)", borderRadius: 9, padding: "6px 10px", fontSize: 13 };
function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: "9px 20px", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${active ? "var(--gold)" : "rgba(201,162,39,.2)"}`,
    background: active ? "linear-gradient(135deg,var(--gold),var(--gold-soft))" : "rgba(10,22,40,.5)",
    color: active ? "var(--navy-deep)" : "#cdd9f0",
  };
}
