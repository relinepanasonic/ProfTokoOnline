import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const KEY = "test-only-report-key";
const state = {
  groups: [{ client_id: "c1", owner: "Owner X", group_id: "1203630111@g.us" }],
  links: [{ owner: "Owner X", store_name: "Toko A" }, { owner: "Owner Q", store_name: "Toko Q" }],
  perf: [
    { store: "Toko A", periodStart: "2026-10-26", periodEnd: "2026-11-01", sales: 8000000, gmv: 8000000, traffic: 900, orders: 40, itemsSold: 90, ads: { total: { cost: 400000, sales: 3000000 } } },
    { store: "Toko A", periodStart: "2026-10-19", periodEnd: "2026-10-25", sales: 4000000, gmv: 4000000, traffic: 700, orders: 30, itemsSold: 70, ads: { total: { cost: 300000, sales: 2000000 } } },
    { store: "Toko Q", periodStart: "2026-10-26", periodEnd: "2026-11-01", sales: 77000000, gmv: 0, traffic: 1, orders: 1, itemsSold: 1, ads: { total: { cost: 1, sales: 1 } } },
  ],
};
const groupFilters: Record<string, unknown> = {};
const rpc = vi.fn();

function from(table: string) {
  if (table === "report_groups") {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { groupFilters[c] = v; return b; };
    b.neq = () => b;
    b.then = (res: (v: unknown) => void) => res({ data: state.groups.filter((g) => !groupFilters.owner || g.owner === groupFilters.owner), error: null });
    return b;
  }
  const b: Record<string, unknown> = {};
  b.select = () => b; b.eq = () => b;
  b.not = () => Promise.resolve({ data: state.links, error: null });
  return b;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from, rpc }) }));

const req = (url: string, key?: string) =>
  new NextRequest(new URL(url, "http://localhost"), { headers: key ? { authorization: `Bearer ${key}` } : {} });

describe("GET /api/reports/weekly", () => {
  beforeEach(() => {
    process.env.REPORT_API_KEY = KEY;
    for (const k of Object.keys(groupFilters)) delete groupFilters[k];
    rpc.mockReset();
    rpc.mockResolvedValue({ data: state.perf, error: null });
  });

  it("401s without a key, and does not touch the database", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("/api/reports/weekly"));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("401s with a wrong key, and when REPORT_API_KEY is unset", async () => {
    const { GET } = await import("./route");
    expect((await GET(req("/api/reports/weekly", "nope"))).status).toBe(401);
    delete process.env.REPORT_API_KEY;
    expect((await GET(req("/api/reports/weekly", KEY))).status).toBe(401);
  });

  it("does not accept the ERP key", async () => {
    process.env.ERP_API_KEY = "erp-key";
    const { GET } = await import("./route");
    expect((await GET(req("/api/reports/weekly", "erp-key"))).status).toBe(401);
  });

  it("rejects a weekStart that is not a Monday", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("/api/reports/weekly?weekStart=2026-10-27", KEY));
    expect(res.status).toBe(400);
  });

  it("returns one report per group with only that owner's stores, no-store", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("/api/reports/weekly?weekStart=2026-10-26", KEY));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(rpc).toHaveBeenCalledWith("erp_performance", { p_client_id: "c1", p_from: "2026-10-19", p_to: "2026-11-01" });
    expect(body.reports).toHaveLength(1);
    const r = body.reports[0];
    expect(r.groupId).toBe("1203630111@g.us");
    expect(r.hasData).toBe(true);
    expect(r.totals.sales).toBe(8000000); // Toko Q (another owner) is not included
    expect(r.message).toContain("Owner X");
    expect(r.message).not.toContain("Toko Q");
    expect(r.message).toContain("▲ 100,0%"); // 8jt vs 4jt
  });

  it("filters to one owner with ?owner=", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("/api/reports/weekly?weekStart=2026-10-26&owner=Nobody", KEY));
    expect((await res.json()).reports).toHaveLength(0);
  });

  it("500s with a generic message when the query fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "secret detail" } });
    const { GET } = await import("./route");
    const res = await GET(req("/api/reports/weekly?weekStart=2026-10-26", KEY));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
