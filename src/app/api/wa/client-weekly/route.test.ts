import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const KEY = "test-only-erp-key-do-not-use";
const state = {
  user: { id: "u1" } as { id: string } | null,
  profile: { role: "client_admin", display_name: "Vani", email: "vani@example.com" } as { role: string; display_name: string | null; email: string | null } | null,
  storeKnown: true,
};
const storeQuery = vi.fn();

function from(table: string) {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = (c: string, v: unknown) => { if (table === "store_links") storeQuery(c, v); return b; };
  b.single = () => Promise.resolve({ data: state.profile, error: null });
  b.limit = () => Promise.resolve({ data: state.storeKnown ? [{ store_name: "onat.hardware" }] : [], error: null });
  return b;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, from }),
}));

const fetchMock = vi.fn();

function post(body: unknown, raw?: string) {
  return new NextRequest(new URL("/api/wa/client-weekly", "http://localhost"), {
    method: "POST", headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(body),
  });
}
const erp = (status: number, body?: unknown) =>
  fetchMock.mockResolvedValue(new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

const PREVIEW = {
  ok: true, store: "onat.hardware", label: "Onat Hardware", client: "Onat", week: { from: "2026-11-02", to: "2026-11-08" },
  group: "Onat x Prof Toko", status: "preview", caption: "Laporan mingguan", imageUrl: "https://files.example/x.png",
  secretExtra: "must not be passed on",
};

describe("POST /api/wa/client-weekly", () => {
  beforeEach(() => {
    process.env.ERP_API_KEY = KEY;
    state.user = { id: "u1" };
    state.profile = { role: "client_admin", display_name: "Vani", email: "vani@example.com" };
    state.storeKnown = true;
    fetchMock.mockReset(); storeQuery.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("401 without a session, and never calls the ERP", async () => {
    state.user = null;
    const { POST } = await import("./route");
    const res = await POST(post({ store: "onat.hardware", action: "preview" }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("403 for roles that do not upload the weekly numbers (Owner, store user)", async () => {
    const { POST } = await import("./route");
    for (const role of ["branch_manager", "store_user"]) {
      state.profile = { role, display_name: "X", email: null };
      expect((await POST(post({ store: "onat.hardware", action: "send" }))).status).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows superadmin, client_admin and advertiser", async () => {
    const { POST } = await import("./route");
    for (const role of ["superadmin", "client_admin", "advertiser"]) {
      state.profile = { role, display_name: "A", email: null };
      erp(200, PREVIEW);
      expect((await POST(post({ store: "onat.hardware", action: "preview" }))).status).toBe(200);
    }
  });

  it("400 for bad input, and never calls the ERP", async () => {
    const { POST } = await import("./route");
    expect((await POST(post(null, "not json"))).status).toBe(400);
    expect((await POST(post({ action: "preview" }))).status).toBe(400);                                  // no store
    expect((await POST(post({ store: "onat.hardware", action: "delete" }))).status).toBe(400);           // bad action
    expect((await POST(post({ store: "onat.hardware", action: "send", week: "2026-11-03" }))).status).toBe(400); // Tuesday
    expect((await POST(post({ store: "onat.hardware", action: "send", week: "2026-02-31" }))).status).toBe(400);
    expect((await POST(post({ store: "x".repeat(201), action: "preview" }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 for a store that is not one of the tenant's stores", async () => {
    state.storeKnown = false;
    const { POST } = await import("./route");
    const res = await POST(post({ store: "someone.elses.store", action: "send" }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("500 (and no call) when ERP_API_KEY is not set", async () => {
    delete process.env.ERP_API_KEY;
    const { POST } = await import("./route");
    expect((await POST(post({ store: "onat.hardware", action: "preview" }))).status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the ERP from the server with the key in the header, the documented body, and no redirect following", async () => {
    erp(200, PREVIEW);
    const { POST } = await import("./route");
    await POST(post({ store: "onat.hardware", week: "2026-11-02", action: "preview", resend: true }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://erp.profesoronline.id/api/v1/erp/wa/client-weekly");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(init.redirect).toBe("manual");
    expect(JSON.parse(init.body)).toEqual({
      source: "dashboard", store: "onat.hardware", workspace: "", action: "preview", resend: true, sentBy: "Vani", week: "2026-11-02",
    });
    expect(String(url)).not.toContain(KEY);
  });

  it("leaves out week when none is given, defaults resend to false, and falls back to the email name for sentBy", async () => {
    state.profile = { role: "superadmin", display_name: null, email: "oli.admin@example.com" };
    erp(200, PREVIEW);
    const { POST } = await import("./route");
    await POST(post({ store: "onat.hardware", action: "send" }));
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).not.toHaveProperty("week");
    expect(sent.resend).toBe(false);
    expect(sent.sentBy).toBe("oli.admin");
  });

  it("ignores a resend that is not literally true", async () => {
    erp(200, PREVIEW);
    const { POST } = await import("./route");
    await POST(post({ store: "onat.hardware", action: "send", resend: "true" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).resend).toBe(false);
  });

  it("returns the preview fields only, and the key is never in a response", async () => {
    erp(200, PREVIEW);
    const { POST } = await import("./route");
    const res = await POST(post({ store: "onat.hardware", action: "preview" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("secretExtra");
    const body = JSON.parse(text);
    expect(body).toMatchObject({ ok: true, group: "Onat x Prof Toko", imageUrl: "https://files.example/x.png", caption: "Laporan mingguan", week: { from: "2026-11-02", to: "2026-11-08" } });
    expect(body.sent).toBeUndefined();
  });

  it("a successful send says sent: true", async () => {
    erp(200, { ...PREVIEW, status: "sent", sent: true, detail: "queued" });
    const { POST } = await import("./route");
    const body = await (await POST(post({ store: "onat.hardware", action: "send" }))).json();
    expect(body.sent).toBe(true);
    expect(body.detail).toBe("queued");
  });

  it("409 no_group and 409 already_sent (with sentAt) are passed on", async () => {
    const { POST } = await import("./route");
    erp(409, { error: "no_group" });
    let res = await POST(post({ store: "onat.hardware", action: "preview" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_group");
    erp(409, { error: "already_sent", sentAt: "2026-11-09T01:02:03.000Z" });
    res = await POST(post({ store: "onat.hardware", action: "send" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_sent", sentAt: "2026-11-09T01:02:03.000Z" });
  });

  it("404 no_data, 400 and 502 send_failed carry the ERP's message", async () => {
    const { POST } = await import("./route");
    erp(404, { error: "no_data", message: "No numbers for 2026-11-02 yet" });
    let res = await POST(post({ store: "onat.hardware", action: "preview" }));
    expect([res.status, (await res.json()).message]).toEqual([404, "No numbers for 2026-11-02 yet"]);
    erp(400, { error: "bad_request", message: "week is not valid" });
    res = await POST(post({ store: "onat.hardware", action: "preview" }));
    expect([res.status, (await res.json()).message]).toEqual([400, "week is not valid"]);
    erp(502, { error: "send_failed", message: "WhatsApp refused: number not on WhatsApp" });
    res = await POST(post({ store: "onat.hardware", action: "send" }));
    expect([res.status, (await res.json()).message]).toEqual([502, "WhatsApp refused: number not on WhatsApp"]);
  });

  it("an ERP 401 is NOT passed on as 401 (the admin is still signed in) and says so", async () => {
    erp(401);
    const { POST } = await import("./route");
    const res = await POST(post({ store: "onat.hardware", action: "preview" }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("erp_auth");
  });

  it("never retries: one ERP call per request, even when the ERP fails or is unreachable", async () => {
    const { POST } = await import("./route");
    erp(502, { error: "send_failed", message: "no" });
    await POST(post({ store: "onat.hardware", action: "send" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const res = await POST(post({ store: "onat.hardware", action: "send" }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("erp_unreachable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an unexpected ERP answer is a generic 502", async () => {
    erp(500, { error: "boom", stack: "secret internals" });
    const { POST } = await import("./route");
    const res = await POST(post({ store: "onat.hardware", action: "preview" }));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
