import { describe, it, expect } from "vitest";
import { buildOwnerReport, change, jakartaToday, lastWeekRange, rupiah, roas, type PerfRow } from "./weeklyReport";

const row = (store: string, start: string, sales: number, orders = 10, cost = 100000, adsSales = 500000): PerfRow => ({
  store, periodStart: start, periodEnd: start, sales, gmv: sales, traffic: 1000, orders, itemsSold: orders * 2,
  ads: { total: { cost, sales: adsSales } },
});

describe("lastWeekRange", () => {
  it("on a Wednesday returns the previous Mon..Sun", () => {
    expect(lastWeekRange("2026-11-04")).toEqual({ start: "2026-10-26", end: "2026-11-01", prevStart: "2026-10-19" });
  });
  it("on a Monday returns the week that just ended", () => {
    expect(lastWeekRange("2026-11-02")).toEqual({ start: "2026-10-26", end: "2026-11-01", prevStart: "2026-10-19" });
  });
  it("on a Sunday still returns the previous completed week", () => {
    expect(lastWeekRange("2026-11-08")).toEqual({ start: "2026-10-26", end: "2026-11-01", prevStart: "2026-10-19" });
  });
});

describe("jakartaToday", () => {
  it("rolls over to the next day at 17:00 UTC", () => {
    expect(jakartaToday(new Date("2026-11-01T17:30:00Z"))).toBe("2026-11-02");
    expect(jakartaToday(new Date("2026-11-01T16:30:00Z"))).toBe("2026-11-01");
  });
});

describe("formatting", () => {
  it("rupiah", () => {
    expect(rupiah(950000)).toBe("Rp 950.000");
    expect(rupiah(12_340_000)).toBe("Rp 12,3 jt");
    expect(rupiah(2_500_000_000)).toBe("Rp 2,50 M");
  });
  it("change", () => {
    expect(change(110, 100)).toBe("▲ 10,0%");
    expect(change(90, 100)).toBe("▼ 10,0%");
    expect(change(5, 0)).toBe("baru");
    expect(change(0, 0)).toBe("–");
  });
  it("roas", () => {
    expect(roas(500, 100)).toBe("5,00");
    expect(roas(500, 0)).toBe("–");
  });
});

describe("buildOwnerReport", () => {
  const last = [row("Toko A", "2026-10-26", 8_000_000), row("Toko B", "2026-10-26", 2_000_000), row("Toko LAIN", "2026-10-26", 99_000_000)];
  const prev = [row("Toko A", "2026-10-19", 5_000_000), row("Toko B", "2026-10-19", 5_000_000)];

  it("only counts the owner's own stores", () => {
    const r = buildOwnerReport("Owner X", "2026-10-26", "2026-11-01", ["Toko A", "Toko B"], last, prev);
    expect(r.hasData).toBe(true);
    expect(r.totals.sales).toBe(10_000_000);
    expect(r.message).not.toContain("Toko LAIN");
    expect(r.message).toContain("Penjualan: *Rp 10,0 jt* (▬ 0%)"); // 10jt vs 10jt last week
    expect(r.message).toContain("Per toko");
    expect(r.message.indexOf("Toko A")).toBeLessThan(r.message.indexOf("Toko B")); // sorted by sales
  });

  it("omits the per-store block for a single store", () => {
    const r = buildOwnerReport("Owner Y", "2026-10-26", "2026-11-01", ["Toko A"], last, prev);
    expect(r.message).not.toContain("Per toko");
    expect(r.totals.sales).toBe(8_000_000);
  });

  it("says data is missing instead of sending zeros", () => {
    const r = buildOwnerReport("Owner Z", "2026-10-26", "2026-11-01", ["Toko Kosong"], last, prev);
    expect(r.hasData).toBe(false);
    expect(r.message).toContain("belum tersedia");
    expect(r.message).not.toContain("Rp 0");
  });

  it("a store with no previous week shows 'baru'", () => {
    const r = buildOwnerReport("Owner Y", "2026-10-26", "2026-11-01", ["Toko A"], last, []);
    expect(r.message).toContain("baru");
  });
});
