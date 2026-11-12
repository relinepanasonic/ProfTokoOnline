import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

const TEST_KEY = "test-only-key-do-not-use-in-prod";
const STORES = [
  { store: "onat.hardware", workspace: "", products: [{ name: "L3O Kawat Loket PVC", sales: 51601692 }, { name: "ONAT Roda Caster", sales: 22578657 }] },
];

function req(url: string, key?: string, extra: HeadersInit = {}) {
  const headers: HeadersInit = key ? { authorization: `Bearer ${key}`, ...extra } : extra;
  return new NextRequest(new URL(url, "http://localhost"), { headers });
}
const OK = "/api/erp/top-products?from=2026-11-09&to=2026-11-15";

describe("GET /api/erp/top-products", () => {
  beforeEach(() => {
    process.env.ERP_API_KEY = TEST_KEY;
    rpc.mockReset();
    rpc.mockResolvedValue({ data: STORES, error: null });
  });

  it("401s with no key, with no body and no details", async () => {
    const { GET } = await import("./route");
    const res = await GET(req(OK));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("401s with a wrong key, and when ERP_API_KEY is not set", async () => {
    const { GET } = await import("./route");
    expect((await GET(req(OK, "wrong-key"))).status).toBe(401);
    delete process.env.ERP_API_KEY;
    expect((await GET(req(OK, TEST_KEY))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never accepts the key from the query string", async () => {
    const { GET } = await import("./route");
    expect((await GET(req(`${OK}&key=${TEST_KEY}&api_key=${TEST_KEY}`))).status).toBe(401);
  });

  it("200 with the documented shape and no-store, and passes the week to the database unchanged", async () => {
    const { GET } = await import("./route");
    const res = await GET(req(OK, TEST_KEY));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["from", "generatedAt", "stores", "timezone", "to"]);
    expect(body.timezone).toBe("Asia/Jakarta");
    expect(body.from).toBe("2026-11-09");
    expect(body.to).toBe("2026-11-15");
    expect(body.stores).toEqual(STORES);
    // The week selection (Monday inside from..to) is done in SQL; the route must hand over exactly the asked days.
    expect(rpc).toHaveBeenCalledWith("erp_top_products", {
      p_client_id: "92213048-a91b-4202-9b47-8d1c38671082", p_from: "2026-11-09", p_to: "2026-11-15", p_limit: 10,
    });
  });

  it("limit: default 10, clamped to 20, at least 1, rejects junk", async () => {
    const { GET } = await import("./route");
    await GET(req(`${OK}&limit=5`, TEST_KEY));
    expect(rpc.mock.calls.at(-1)![1].p_limit).toBe(5);
    await GET(req(`${OK}&limit=99`, TEST_KEY));
    expect(rpc.mock.calls.at(-1)![1].p_limit).toBe(20);
    await GET(req(`${OK}&limit=0`, TEST_KEY));
    expect(rpc.mock.calls.at(-1)![1].p_limit).toBe(1);
    expect((await GET(req(`${OK}&limit=abc`, TEST_KEY))).status).toBe(400);
    expect((await GET(req(`${OK}&limit=-3`, TEST_KEY))).status).toBe(400);
  });

  it("400s for a range over 62 days, but accepts exactly 62", async () => {
    const { GET } = await import("./route");
    expect((await GET(req("/api/erp/top-products?from=2026-09-01&to=2026-11-02", TEST_KEY))).status).toBe(400); // 63 days
    expect((await GET(req("/api/erp/top-products?from=2026-09-01&to=2026-11-01", TEST_KEY))).status).toBe(200); // 62 days
  });

  it("400s for missing, malformed, impossible or reversed dates", async () => {
    const { GET } = await import("./route");
    for (const q of ["", "?from=2026-11-09", "?from=09-11-2026&to=15-11-2026", "?from=2026-02-31&to=2026-03-02", "?from=2026-11-15&to=2026-11-09"]) {
      expect((await GET(req(`/api/erp/top-products${q}`, TEST_KEY))).status).toBe(400);
    }
  });

  it("a store without products is not listed, names are trimmed, and nothing is negative or unnamed", async () => {
    rpc.mockResolvedValue({
      data: [
        { store: "A", workspace: "x", products: [{ name: "  Alpha  ", sales: 10 }, { name: "Neg", sales: -5 }, { name: "", sales: 7 }, { name: "Zero", sales: 0 }] },
        { store: "Kosong", workspace: "", products: [] },
        { store: "SemuaRugi", workspace: "", products: [{ name: "Rugi", sales: -1 }] },
      ],
      error: null,
    });
    const { GET } = await import("./route");
    const body = await (await GET(req(OK, TEST_KEY))).json();
    expect(body.stores).toEqual([{ store: "A", workspace: "", products: [{ name: "Alpha", sales: 10 }] }]);
  });

  it("keeps the order the database returned (sorted by sales)", async () => {
    rpc.mockResolvedValue({ data: [{ store: "A", workspace: "", products: [{ name: "Big", sales: 900 }, { name: "Mid", sales: 500 }, { name: "Small", sales: 5 }] }], error: null });
    const { GET } = await import("./route");
    const body = await (await GET(req(OK, TEST_KEY))).json();
    expect(body.stores[0].products.map((p: { sales: number }) => p.sales)).toEqual([900, 500, 5]);
  });

  it("500s with a generic message when the query fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "secret detail" } });
    const { GET } = await import("./route");
    const res = await GET(req(OK, TEST_KEY));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
