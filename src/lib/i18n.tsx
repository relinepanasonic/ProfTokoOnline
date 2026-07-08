"use client";

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";

export type Lang = "en" | "id";

// Canonical key = the English string as written in the UI. ID dictionary
// gives its translation; EN mode returns the key unchanged. Missing keys
// just fall back to the key itself, so an untranslated string never breaks.
const ID_DICT: Record<string, string> = {
  // nav / shell
  "Dashboard": "Dasbor",
  "Ads Performance": "Performa Iklan",
  "Detail Keuangan": "Detail Keuangan",
  "Operational Performance": "Performa Operasional",
  "Price Calculator": "Kalkulator Harga",
  "Market Place Fee": "Biaya Marketplace",
  "Upload Data": "Unggah Data",
  "Core List": "Daftar Inti",
  "Accounting": "Akuntansi",
  "Users": "Pengguna",
  "Invoice": "Faktur",
  "Logout": "Keluar",
  "Marketplace performance overview — Shopee": "Ringkasan performa marketplace — Shopee",

  // filters
  "Year": "Tahun", "Month": "Bulan", "City": "Kota", "Owner": "Pemilik", "Brand": "Merek",
  "Store": "Toko", "Week": "Minggu", "Reset": "Atur Ulang", "All": "Semua",
  "All Years": "Semua Tahun", "All Months": "Semua Bulan", "All Cities": "Semua Kota",
  "All Owners": "Semua Pemilik", "All Brands": "Semua Merek", "All Weeks": "Semua Minggu",
  "Pick a store…": "Pilih toko…",

  // KPIs
  "Total Sales": "Total Penjualan", "Total Transaction": "Total Transaksi", "Traffic": "Kunjungan",
  "In-Cart": "Masuk Keranjang", "Ads Cost": "Biaya Iklan", "ROAS": "ROAS",
  "SPOS · siap dikirim": "SPOS · siap dikirim", "Performa": "Performa",
  "cart rate": "tingkat keranjang",

  // panels
  "Monthly Sales": "Penjualan Bulanan", "Penjualan per bulan · SPOS": "Penjualan per bulan · SPOS",
  "Top 10 Best-Selling Products": "10 Produk Terlaris",
  "Sales · SPOS parent rows": "Penjualan · baris induk SPOS",
  "Monthly Performance": "Performa Bulanan",
  "Traffic vs In-Cart vs Sales · SPOS": "Kunjungan vs Masuk Keranjang vs Penjualan · SPOS",
  "Brand Share of Sales": "Pangsa Penjualan per Merek",
  "Sales mix by brand · SPOS": "Komposisi penjualan per merek · SPOS",
  "Monthly Ads Cost vs ROAS": "Biaya Iklan vs ROAS Bulanan",
  "Bars = cost · line = ROAS": "Batang = biaya · garis = ROAS",
  "Traffic vs Add-to-Cart": "Kunjungan vs Masuk Keranjang",
  "Funnel trend per month": "Tren funnel per bulan",
  "AVG Store Sales Performa": "Rata-rata Performa Sales Toko",
  "Rata-rata penjualan per toko aktif, per bulan · SPOS": "Rata-rata penjualan per toko aktif, per bulan · SPOS",
  "Detail Data per": "Detail Data per",
  "Sorted by sales · Baseline excluded · line shows SPOS sales trend": "Diurutkan berdasarkan penjualan · Baseline dikecualikan · garis menunjukkan tren penjualan SPOS",

  // table
  "Trend": "Tren", "Sales": "Penjualan", "Cart Rate": "Tingkat Keranjang",
  "ROAS Trend": "Tren ROAS", "No data yet": "Belum ada data",
  "Klik baris untuk detail": "Klik baris untuk detail",

  // funnel / campaigns
  "Shopping Funnel": "Funnel Belanja",
  "Produk Dilihat": "Produk Dilihat", "Pengunjung": "Pengunjung", "Transaksi": "Transaksi",
  "Produk Dilihat → Pengunjung → In-Cart → Transaksi — bulan lama sebagian 0 sampai upload SPOS baru":
    "Produk Dilihat → Pengunjung → In-Cart → Transaksi — bulan lama sebagian 0 sampai upload SPOS baru",
  "Best Ads Performance": "Performa Iklan Terbaik",
  "Top 8 · Dilihat → Klik → Add to Cart → Omzet · sumber Ads": "Top 8 · Dilihat → Klik → Add to Cart → Omzet · sumber Ads",
  "Dilihat": "Dilihat", "Klik": "Klik", "Cart": "Keranjang",

  // misc
  "GMV": "GMV",
};

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (key: string) => string };
const LangContext = createContext<Ctx>({ lang: "id", setLang: () => {}, t: (k) => k });

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("id");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("ptoko_lang") as Lang | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "en" || saved === "id") setLangState(saved);
    } catch { /* ignore */ }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem("ptoko_lang", l); } catch { /* quota */ }
  }, []);

  const t = useCallback((key: string) => (lang === "id" ? (ID_DICT[key] ?? key) : key), [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}
