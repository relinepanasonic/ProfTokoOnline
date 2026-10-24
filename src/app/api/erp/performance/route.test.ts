import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

const TEST_KEY = "test-only-key-do-not-use-in-prod";
const ROW = {
  store: "Toko Elektronik A", periodStart: "2026-09-01", periodEnd: "2026-09-07", granularity: "week",
  sales: 11000000, gmv: 15500000, traffic: 52254, addToCart: 1992, orders: 71, itemsSold: 238,
  productViews: 52254, productClicks: 4100, baselineSales: 6000000, activeSales: 11000000,
  ads: {
    total: { cost: 5000000, sales: 77600000, views: 357455, clicks: 16355, addToCart: 2900, orders: 838, itemsSold: 2708 },
    gmvMax: { cost: 796100, sales: 11000000, views: 52254, clicks: 1992, addToCart: 0, orders: 71, itemsSold: 238 },
    group: { cost: 4200000, sales: 66600000, views: 305201, clicks: 14363, addToCart: 0, orders: 767, itemsSold: 2470 },
    independent: { cost: 3900, sales: 0, views: 0, clicks: 0, addToCart: 2900, orders: 0, itemsSold: 0 },
  },
};

function req(url: string, key?: string, extra: HeadersInit = {}) {
  const headers: HeadersInit = key ? { authorization: `Bearer ${key}`, ...extra } : extra;
  return new NextRequest(new URL(url, "http://localhost"), { headers });
}
const OK = "/api/erp/performance?from=2026-09-01&to=2026-09-30";

describe("GET /api/erp/performance", () => {
  beforeEach(() => {
    process.env.ERP_API_KEY = TEST_KEY;
    rpc.mockReset();
    rpc.mockResolvedValue({ data: [ROW], error: null });
  });

  it("401s with no key, with no body and no details", async () => {
    const { GET } = await import("./route");
    const res = await GET(req(OK));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("401s with a wrong key", async () => {
    const { GET } = await import("./route");
    expect((await GET(req(OK, "wrong-key"))).status).toBe(401);
  });

  it("401s for everyone when ERP_API_KEY is not set, even for an empty/guessed key", async () => {
    delete process.env.ERP_API_KEY;
    const { GET } = await import("./route");
    expect((await GET(req(OK, TEST_KEY))).status).toBe(401);
    expect((await GET(req(OK, ""))).status).toBe(401);
  });

  it("never accepts the key in the query string", async () => {
    const { GET } = await import("./route");
    expect((await GET(req(`${OK}&key=${TEST_KEY}&api_key=${TEST_KEY}`))).status).toBe(401);
  });

  it("200 with the documented shape, no-store, no CORS headers", async () => {
    const { GET } = await import("./route");
    const res = await GET(req(OK, TEST_KEY));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const j = await res.json();
    expect(Object.keys(j).sort()).toEqual(["generatedAt", "rows", "timezone"]);
    expect(j.timezone).toBe("Asia/Jakarta");
    expect(new Date(j.generatedAt).toString()).not.toBe("Invalid Date");
    expect(j.rows).toEqual([ROW]);
    expect(Object.keys(j.rows[0].ads).sort()).toEqual(["gmvMax", "group", "independent", "total"]);
  });

  it("asks the database for the tenant and the range, nothing else", async () => {
    const { GET } = await import("./route");
    await GET(req(OK, TEST_KEY));
    expect(rpc).toHaveBeenCalledWith("erp_performance", {
      p_client_id: "92213048-a91b-4202-9b47-8d1c38671082", p_from: "2026-09-01", p_to: "2026-09-30",
    });
  });

  it("range edge: 370 inclusive days ok, 371 -> 400", async () => {
    const { GET } = await import("./route");
    expect((await GET(req("/api/erp/performance?from=2026-01-01&to=2027-01-05", TEST_KEY))).status).toBe(200);   // Jan 1 2026 .. Jan 5 2027 = 370 days
    const tooLong = await GET(req("/api/erp/performance?from=2026-01-01&to=2027-01-06", TEST_KEY));               // 371 days
    expect(tooLong.status).toBe(400);
    expect(tooLong.headers.get("cache-control")).toBe("no-store");
  });

  it("400 for missing, malformed, impossible or reversed dates", async () => {
    const { GET } = await import("./route");
    for (const q of ["", "?from=2026-09-01", "?to=2026-09-30", "?from=09/01/2026&to=2026-09-30", "?from=2026-02-31&to=2026-03-05", "?from=2026-09-30&to=2026-09-01"]) {
      expect((await GET(req(`/api/erp/performance${q}`, TEST_KEY))).status, q).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an empty period is a 200 with no rows (a store without data is simply not listed)", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const { GET } = await import("./route");
    const j = await (await GET(req(OK, TEST_KEY))).json();
    expect(j.rows).toEqual([]);
  });

  it("never returns a negative number, even if the database did", async () => {
    rpc.mockResolvedValue({ data: [{ ...ROW, sales: -77600000, ads: { ...ROW.ads, independent: { ...ROW.ads.independent, cost: -5000000, sales: -1 } } }], error: null });
    const { GET } = await import("./route");
    const j = await (await GET(req(OK, TEST_KEY))).json();
    expect(JSON.stringify(j)).not.toMatch(/:-\d/);
    expect(j.rows[0].sales).toBe(0);
    expect(j.rows[0].ads.independent.cost).toBe(0);
    expect(j.rows[0].store).toBe("Toko Elektronik A");
  });

  it("a database error is a generic 500 with no details", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "relation \"secret_table\" does not exist" } });
    const { GET } = await import("./route");
    const res = await GET(req(OK, TEST_KEY));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/secret_table/);
  });
});
