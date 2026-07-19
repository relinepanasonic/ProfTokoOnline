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

  // Ads Performance
  "View": "Dilihat", "Click": "Klik", "Order": "Pesanan", "Item Sold": "Produk Terjual",
  "Add to Cart": "Masuk Keranjang",
  "Group Ads": "Iklan Grup", "Independent Ads": "Iklan Independen",
  "Sales by Ads Type": "Penjualan per Jenis Iklan",
  "Ads Funnel": "Funnel Iklan",
  "Item Sold vs Sales": "Produk Terjual vs Penjualan",
  "Ads Group Performance": "Performa Grup Iklan",
  "Campaign / group-level rows (GMV Max, Grup Hero, Grup Regular, etc.) — everything without a Kode Produk":
    "Baris tingkat kampanye/grup (GMV Max, Grup Hero, Grup Reguler, dll.) — semua yang tanpa Kode Produk",
  "Ads Product Performance": "Performa Produk Iklan",
  "Merged from Total Ads, GMV Max, and Group Ads · joined on Kode Produk":
    "Gabungan dari Total Ads, GMV Max, dan Iklan Grup · digabung berdasarkan Kode Produk",
  "Campaign Name": "Nama Kampanye",
  "Product Code": "Kode Produk", "Product Name": "Nama Produk",
  "No campaign/group ads data yet": "Belum ada data iklan kampanye/grup",
  "No product-level ads data yet": "Belum ada data iklan tingkat produk",
  "No ads funnel data yet": "Belum ada data funnel iklan",
  "Loading data…": "Memuat data…",

  // Finance Detail
  "Upload Data Keuangan First": "Unggah Data Keuangan Dulu",
  "No Shopee Income (Laporan Penghasilan) data has been uploaded yet. Go to the \"Upload Keuangan\" tab to import one.":
    "Belum ada data Income (Laporan Penghasilan) Shopee yang diunggah. Buka tab \"Upload Keuangan\" untuk mengimpornya.",
  "Choose Store": "Pilih Store",
  "Finance Detail is shown per store — pick a Store above to view its dashboard.":
    "Detail Keuangan ditampilkan per store — pilih satu Store di atas untuk melihat dashboard-nya.",
  "Gross Sales": "Penjualan Kotor", "Gross Profit": "Laba Kotor",
  "Ads Spent": "Belanja Iklan", "Nett Profit": "Laba Bersih",
  "Promotion Cost": "Biaya Promosi", "Refund": "Pengembalian Dana",
  "Delivery Cost": "Biaya Pengiriman", "Affiliate Cost": "Biaya Afiliasi",
  "Marketplace Fee": "Biaya Marketplace",
  "Monthly Gross Sales vs Nett Profit": "Penjualan Kotor vs Laba Bersih Bulanan",
  "Monthly Marketplace Fee": "Biaya Marketplace Bulanan",
  "Monthly Promotion Cost": "Biaya Promosi Bulanan",
  "Payment Method": "Metode Bayar", "Shipping Service": "Jasa Kirim",
  "Daily Transaction Detail": "Detail Transaksi per Hari",
  "Click a row to see that day's transaction detail · date based on release date":
    "Klik baris untuk melihat detail transaksi hari itu · tanggal berdasarkan dana dilepaskan",
  "Date": "Tanggal", "Orders": "Pesanan", "Net Income": "Laba Bersih",
  "No data for these filters": "Tidak ada data untuk filter ini",
  "Search": "Cari",
  "Product Code / Product Name / Variant Name": "Kode Produk / Nama Produk / Nama Variasi",
  "Variant Name": "Nama Variasi", "Variant Code": "Kode Variasi",
  "Product Sold": "Produk Terjual", "Promotional Cost": "Biaya Promosi",
  "Transaction": "Transaksi", "Close": "Tutup",
  "Order No.": "No. Pesanan", "Buyer": "Pembeli", "Affiliate": "Afiliasi",
  "No transactions": "Tidak ada transaksi",
  "orders": "pesanan",
  "Finance Dashboard": "Dashboard Keuangan",

  // Operational Performance
  "Upload Data Operational Performance First": "Unggah Data Operational Performance Dulu",
  "No Shopee Order.completed data has been uploaded yet. Go to the \"Upload Operational Performance\" tab to import one.":
    "Belum ada data Order.completed Shopee yang diunggah. Buka tab \"Upload Operational Performance\" untuk mengimpornya.",
  "Operational Performance is shown per store — pick a Store above to view its dashboard.":
    "Operational Performance ditampilkan per store — pilih satu Store di atas untuk melihat dashboard-nya.",
  "Unique orders": "Pesanan unik",
  "Total Product Ordered": "Total Produk Dipesan",
  "Ready to ship": "Siap dikirim",
  "Pay → Ship Deadline": "Bayar → Batas Kirim",
  "Ship Deadline → Completed": "Batas Kirim → Selesai",
  "Pay → Completed": "Bayar → Selesai",
  "Total Cancellations": "Total Pembatalan",
  "Orders cancelled": "Pesanan dibatalkan",
  "Total Product Return": "Total Product Return",
  "Units returned": "Unit dikembalikan",
  "GMV Map by Province": "Peta GMV per Provinsi",
  "Darker color = higher GMV in that province — hover for detail":
    "Semakin gelap warna, semakin tinggi GMV di provinsi tersebut — arahkan kursor untuk detail",
  "SLA (Pay → Completed)": "SLA (Bayar → Selesai)",
  "Order distribution by time from payment to completion": "Distribusi pesanan berdasarkan lama waktu bayar sampai selesai",
  "Number of orders per payment method": "Jumlah pesanan per metode pembayaran",
  "Shipping Type / Option": "Jenis Kurir / Opsi Kirim",
  "Number of orders per shipping option — top 10, rest merged into Others":
    "Jumlah pesanan per opsi pengiriman — top 10, sisanya digabung jadi Lainnya",
  "Click a row to see that day's transaction detail · date based on order completed time":
    "Klik baris untuk melihat detail transaksi hari itu · tanggal berdasarkan waktu pesanan selesai",
  "Product": "Produk", "Variant": "Variasi", "Paid At": "Pesanan Dibayar",
  "Ship Deadline": "Pesanan di Kirim", "Completed At": "Pesanan Selesai",
  "Courier": "Kurir", "Province": "Provinsi", "Status": "Status",
  "Others": "Lainnya",
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
