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
  "Finance Detail": "Detail Keuangan",
  "Upload the Data First in Upload Page to open the Features": "Unggah Data Terlebih Dahulu di Halaman Upload untuk membuka Fitur ini",
  "Go to Upload Page": "Ke Halaman Upload",
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
  "Average monthly sales per store · SPOS": "Rata-rata penjualan bulanan per toko · SPOS",
  "Detail Data per": "Detail Data per",
  "Sorted by sales · Baseline excluded · line shows SPOS sales trend": "Diurutkan berdasarkan penjualan · Baseline dikecualikan · garis menunjukkan tren penjualan SPOS",

  // table
  "Trend": "Tren", "Sales": "Penjualan", "Cart Rate": "Tingkat Keranjang",
  "ROAS Trend": "Tren ROAS", "No data yet": "Belum ada data",
  "Click row for details": "Klik baris untuk detail",
  "Store Data per": "Detail Data per",

  // funnel / campaigns
  "Shopping Funnel": "Funnel Belanja",
  "Product Views": "Produk Dilihat", "Visitors": "Pengunjung",
  "Orders Created": "Transaksi Dibuat", "Transactions": "Transaksi Dikirim",
  "Product Views → Visitors → Orders Created → Transactions — older months partly 0 until new SPOS upload":
    "Produk Dilihat → Pengunjung → Transaksi Dibuat → Transaksi — bulan lama sebagian 0 sampai upload SPOS baru",
  "Best Ads Performance": "Performa Iklan Terbaik",
  "Top 8 · Views → Clicks → Add to Cart → Sales · from Ads": "Top 8 · Dilihat → Klik → Add to Cart → Omzet · sumber Ads",
  "Views": "Dilihat", "Clicks": "Klik", "Cart": "Keranjang",

  // subscription plans
  "days left": "hari lagi", "Expired": "Kedaluwarsa", "Unlimited": "Tanpa Batas",
  "Your subscription has ended — read-only mode. Contact us to renew.":
    "Langganan Anda telah berakhir — mode baca-saja. Hubungi kami untuk memperpanjang.",

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
