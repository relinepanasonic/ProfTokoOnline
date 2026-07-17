# Detail Product Profit — Data Mapping Document

**Purpose:** This document explains, column by column, exactly which Shopee export file each number in the "Detail Product Profit" table comes from, which raw column headers are read, and the math used to arrive at the figure shown on screen. Written for a non-technical audience (finance/ops team, auditors).

**Table grain:** one row per product **variant**. If a product has no variants, it gets one row (Kode Variasi `-`).

---

## Source files at a glance

| File uploaded | What it contains | Grain (one row = ...) |
|---|---|---|
| `ProductPerforma.xlsx` (Product Performa / SPOS) | Product-level performance: views, sales, units sold | one product OR one variant |
| `IncomeDilepas.xlsx` (Income / Laporan Penghasilan) | Every cost/fee Shopee deducted before releasing money to the seller, store-wide totals | one **order** |
| Ads Performance files (`AdsPerfroma.csv` / `AdsGroup.csv` / `AdsInkubasi.csv`) | Ad spend and results per campaign | one advertised product (parent-level only — no variant breakdown) |

`OrderCompleted.xlsx` is **not used** by this table — see "Why no OrderCompleted" below.

---

## Column-by-column breakdown

### 1. Nama Product & Nama Variasi (frozen columns) / Kode Product & Kode Variasi

- **File:** `ProductPerforma.xlsx`
- **Raw columns:** `Produk` (product name), `Nama Variasi` (variant name), `Kode Produk`, `Kode Variasi`
- **Logic:** Read directly, no math. Nama Product and Nama Variasi are frozen on the left of the table; Kode Product/Kode Variasi scroll with the rest.

### 2. Product Sold

- **File:** `ProductPerforma.xlsx`
- **Raw column:** `Produk (Pesanan Siap Dikirim)`
- **Logic:** Direct read — total units sold for that product/variant in the selected period.

### 3. Sales (Total Penjualan)

- **File:** `ProductPerforma.xlsx`
- **Raw column:** `Penjualan (Pesanan Siap Dikirim) (IDR)`
- **Logic:** Summed directly from this column for the product/variant, for the selected period. This is Shopee's own "confirmed order" sales figure — no calculation, straight passthrough. This is also the number every cost-column coefficient below is weighted against.

### 4. Total Modal Product

- **File:** none directly — a **manual input** entered on the "Modal Product" page (cost price per product/variant), multiplied by units sold.
- **Formula:**
  ```
  Total Modal Product = Harga Modal (user-entered cost price) × Product Sold
  ```
  If no cost price has been entered for that product/variant yet, this shows `Rp 0`.

### 5–9. Promotional Cost / Pengembalian Dana / Delivery Cost / Affiliate Cost / Market Place Fee

These five columns come from `IncomeDilepas.xlsx`, which is an **order-level** report — it has no product name or variant on it, only totals per order. Rather than trying to bridge every individual order down to a specific product (Shopee doesn't give us a reliable way to do that — see the note at the bottom), each of these columns uses a **store-wide coefficient**, applied proportionally to each row's own Sales.

**Step A — Read the raw cost columns from `IncomeDilepas.xlsx`**, summed across every order for the selected Store/Month/Year/Owner filter:

| Column shown in table | Raw Shopee columns summed together |
|---|---|
| Promotional Cost | `Total Diskon Produk` + `Diskon Produk dari Shopee` + `Voucher disponsor oleh Penjual` + `Voucher co-fund disponsor oleh Penjual` + `Cashback Koin disponsori Penjual` + `Cashback Koin Co-fund disponsori Penjual` |
| Pengembalian Dana | `Jumlah Pengembalian Dana ke Pembeli` |
| Delivery Cost | `Ongkir Dibayar Pembeli` + `Diskon Ongkir Ditanggung Jasa Kirim` + `Gratis Ongkir dari Shopee` + `Ongkir yang Diteruskan oleh Shopee ke Jasa Kirim` + `Ongkos Kirim Pengembalian Barang` + `Kembali ke Biaya Pengiriman Pengirim` + `Pengembalian Biaya Kirim` |
| Affiliate Cost | `Biaya Komisi AMS` |
| Market Place Fee | `Biaya Administrasi` + `Biaya Layanan` + `Biaya Proses Pesanan` + `Premi` + `Biaya Program Hemat Biaya Kirim` + `Biaya Transaksi` + `Biaya Kampanye` + `Bea Masuk, PPN & PPh` |

This mapping was verified line-by-line against a real 248-row export with zero mismatches: summing every cost column plus these 5 buckets exactly reproduces Shopee's own "Total Penghasilan" figure for each order. These are the exact same totals shown on the KPI cards at the top of Finance Detail (Promotion Cost, Pengembalian Dana, Delivery Cost, Affiliate Cost, Marketplace Fee).

**Step B — Turn each store-wide total into a coefficient, and apply it per row:**

```
Coefficient (per cost type) = Total [Cost Type] for the store/period (Step A)
                             ÷ Total Sales for the store/period
                               (the sum of EVERY row's own Sales column, i.e. the
                               same total shown as the store's Gross Sales KPI)

Row's [Cost Type] = Coefficient × that row's own Sales (column 3)
```

**Why this design:** because the coefficient is a single constant applied to every row, the rows always sum back **exactly** to the store-wide total for that cost type — there's no rounding drift or unmatched-order gap. A product that generated more revenue absorbs proportionally more of the store's promotional/delivery/fee costs; a product with no sales in the period gets `Rp 0`.

**What this means in practice:** these 5 columns are a **proportional allocation**, not a literal per-order ledger entry — Shopee itself doesn't tell you which specific product a given voucher or delivery subsidy applied to. This model answers "based on how much revenue this product generated, what's its fair share of the store's total costs this period," not "Shopee charged exactly this much for this specific product's orders."

**Why no OrderCompleted:** an earlier version of this table bridged `IncomeDilepas.xlsx` to `OrderCompleted.xlsx` via the shared Order Number, matching on product name text. That approach was replaced with the coefficient model above — it doesn't require an OrderCompleted upload, isn't sensitive to inconsistent product-name spelling between exports, and is significantly cheaper to compute.

### 10. Ads Cost

- **File:** Ads Performance files (same source as the "Ads Product Performance" table on the Ads Performance page)
- **Raw columns:** `Kode Produk` (which product the ad promoted), `Biaya` (ad spend)
- **The problem:** Shopee's Ads reports only tell you spend per **parent product** (Kode Produk) — never broken down by variant.
- **Proration logic:**
  1. Sum total Ads Cost for the parent product across the selected period (same figure as "Ads Product Performance").
  2. Look at that same parent product's variants and their own Sales figures (column 3 above) for the same period.
  3. Split the parent's total Ads Cost across its variants, proportional to each variant's own share of the parent's total sales:
     ```
     Variant's Ads Cost = Parent's Total Ads Cost × (Variant's Sales ÷ Parent's Total Sales across all its variants)
     ```
  - If a product has no variants, it simply gets 100% of its own Ads Cost.
  - If a product had zero sales in the period (so there's nothing to prorate by), Ads Cost shows as `Rp 0` for its rows rather than guessing.

### 11. Nett Profit

- **File:** none — pure calculation from the columns above.
- **Formula:**
  ```
  Nett Profit = Sales
              − Total Modal Product
              − Promotional Cost
              − Pengembalian Dana
              − Delivery Cost
              − Affiliate Cost
              − Market Place Fee
              − Ads Cost
  ```

---

## Summary: what's exact vs. what's allocated

| Column | Type | Why |
|---|---|---|
| Nama Product, Nama Variasi, Kode Product, Kode Variasi | Exact | Direct read |
| Product Sold | Exact | Direct read from ProductPerforma |
| Sales | Exact | Direct read from Shopee's own confirmed-order figure |
| Total Modal Product | Exact (given the input) | Direct multiplication; only as accurate as the manually entered cost price |
| Promotional Cost, Pengembalian Dana, Delivery Cost, Affiliate Cost, Market Place Fee | **Proportional allocation** | Store-wide total ÷ store-wide Sales, applied to each row's own Sales — always reconciles exactly to the store total |
| Ads Cost | **Proportional allocation** | Shopee's own Ads report has no variant breakdown — prorated across variants by their share of the parent product's sales |
| Nett Profit | Exact (given the above) | Simple subtraction of all the above |

If a number on this table needs to reconcile exactly to Shopee's own reports for audit purposes, do that reconciliation at the **store/period level** (using `IncomeDilepas.xlsx`'s own totals directly, same as the KPI cards) or the **parent-product level** (using the Ads report directly) — the variant-level breakdown on this page is a proportional allocation for internal decision-making, not a replacement for Shopee's own order-level statements.
