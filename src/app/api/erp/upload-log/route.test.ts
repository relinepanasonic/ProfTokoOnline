import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// A minimal thenable Supabase query-builder mock: every chain method
// returns itself, and awaiting it resolves to the table's fixed result —
// enough for this route, which never inspects the query beyond building it.
function builder(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, in: () => b, gte: () => b, lt: () => b, order: () => b,
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  return b;
}

const tableResults: Record<string, { data: unknown; error: unknown }> = {
  uploads: { data: [], error: null },
  profiles: { data: [], error: null },
  store_links: { data: [], error: null },
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => builder(tableResults[table] ?? { data: [], error: null }),
  }),
}));

const TEST_KEY = "test-only-key-do-not-use-in-prod";

function req(url: string, key?: string) {
  const headers: HeadersInit = key ? { authorization: `Bearer ${key}` } : {};
  return new NextRequest(new URL(url, "http://localhost"), { headers });
}

describe("GET /api/erp/upload-log", () => {
  beforeEach(() => {
    process.env.ERP_API_KEY = TEST_KEY;
    tableResults.uploads = { data: [], error: null };
    tableResults.profiles = { data: [], error: null };
    tableResults.store_links = { data: [], error: null };
  });

  it("401s with no key", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("/api/erp/upload-log?from=2026-01-01&to=2026-01-02"));
    expect(res.status).toBe(401);
  });

  it("401s with a wrong key", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("/api/erp/upload-log?from=2026-01-01&to=2026-01-02", "wrong-key"));
    expect(res.status).toBe(401);
  });

  it("401s for every request when ERP_API_KEY is unset", async () => {
    delete process.env.ERP_API_KEY;
    const { GET } = await import("./route");
    const res = await GET(req("/api/erp/upload-log?from=2026-01-01&to=2026-01-02", TEST_KEY));
    expect(res.status).toBe(401);
  });

  it("200s with the right shape on a valid key + valid range", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("/api/erp/upload-log?from=2026-01-01&to=2026-01-05", TEST_KEY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("generatedAt");
    expect(body.timezone).toBe("Asia/Jakarta");
    expect(Array.isArray(body.admins)).toBe(true);
    expect(Array.isArray(body.uploads)).toBe(true);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("400s when the range exceeds 60 days", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("/api/erp/upload-log?from=2026-01-01&to=2026-04-01", TEST_KEY));
    expect(res.status).toBe(400);
  });

  it("400s on a malformed date", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("/api/erp/upload-log?from=2026-13-40&to=2026-01-05", TEST_KEY));
    expect(res.status).toBe(400);
  });
});
