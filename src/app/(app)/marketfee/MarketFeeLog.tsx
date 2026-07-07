"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";

const FIELD_LABEL: Record<string, string> = {
  platform_fee: "Platform Fee",
  biaya_proses_pesanan: "Biaya Proses Pesanan",
  biaya_layanan_mall: "Biaya Layanan Mall",
  min_go_biasa: "Min Gratis Ongkir Uk Biasa",
  max_go_biasa: "Max Gratis Ongkir Uk Biasa",
  min_go_khusus: "Min Gratis Ongkir Uk Khusus",
  max_go_khusus: "Max Gratis Ongkir Uk Khusus",
  min_promo_xtra: "Min Promo Xtra | XBP",
  max_promo_xtra: "Max Promo Xtra | XBP",
  spaylater_3mo: "Spaylater Xtra 3 bln",
  spaylater_6mo: "Spaylater Xtra 6 bln",
};
const RUPIAH_FIELDS = new Set(["biaya_proses_pesanan", "max_go_biasa", "max_go_khusus", "max_promo_xtra"]);

type LogRow = {
  id: number; field_name: string; old_value: number | null; new_value: number | null;
  month: string; edited_by_name: string | null;
  market_fees: { category: string; sub_category: string; jenis_product: string; platform: string; jenis_toko: string } | null;
};

function fmtVal(field: string, v: number | null): string {
  if (v == null) return "—";
  return RUPIAH_FIELDS.has(field) ? "Rp" + Math.round(v).toLocaleString("id-ID") : `${v}%`;
}

export default function MarketFeeLog({ clientId, refreshKey }: { clientId: string; refreshKey: number }) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<LogRow[] | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    const { data } = await supabase
      .from("market_fee_log")
      .select("id,field_name,old_value,new_value,month,edited_by_name,market_fees(category,sub_category,jenis_product,platform,jenis_toko)")
      .eq("client_id", clientId)
      .order("id", { ascending: false })
      .limit(200);
    setRows((data as unknown as LogRow[]) || []);
  }, [supabase, clientId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load, refreshKey]);

  if (rows === null) return <Loader center />;

  return (
    <div className="panel">
      <h3>Edit Log</h3>
      <div className="hint">Riwayat perubahan angka fee — dicatat per bulan dan siapa yang mengubah, bukan per tanggal (fee diperbarui bulanan, bukan harian).</div>
      <div className="tbl-wrap" style={{ maxHeight: 560, marginTop: 10 }}>
        <table className="tbl">
          <thead><tr>
            <th>Bulan</th><th>Diubah Oleh</th><th>Item</th><th>Field</th>
            <th className="num">Nilai Lama</th><th className="num">Nilai Baru</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{r.month}</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.edited_by_name || "—"}</td>
                <td style={{ maxWidth: 320, whiteSpace: "normal", fontSize: 12.5 }}>
                  {r.market_fees ? (
                    <>
                      {r.market_fees.category} › {r.market_fees.sub_category} › {r.market_fees.jenis_product}
                      <div style={{ color: "var(--muted)" }}>{r.market_fees.platform} · {r.market_fees.jenis_toko}</div>
                    </>
                  ) : "—"}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{FIELD_LABEL[r.field_name] || r.field_name}</td>
                <td className="num">{fmtVal(r.field_name, r.old_value)}</td>
                <td className="num" style={{ color: "var(--gold)", fontWeight: 700 }}>{fmtVal(r.field_name, r.new_value)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>Belum ada perubahan</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
