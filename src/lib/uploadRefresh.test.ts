import { describe, expect, it, vi } from "vitest";
import { runUploadRefresh, type RpcClient } from "./uploadRefresh";

const SLICE = { year: 2026, month: "Oktober", week: "Week 2", store_name: "lozindonesia" };

/** fake client: records calls and lets a test hold every call open to prove they overlap */
function fake(opts: { fail?: string[]; throwOn?: string } = {}) {
  const calls: string[] = [];
  let inFlight = 0, maxInFlight = 0;
  const client: RpcClient = {
    rpc: async (fn) => {
      calls.push(fn);
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      if (opts.throwOn === fn) throw new Error("socket hang up");
      return { error: opts.fail?.includes(fn) ? { message: `${fn} exploded` } : null };
    },
  };
  return { client, calls, maxInFlight: () => maxInFlight };
}

describe("runUploadRefresh", () => {
  it("spos: refreshes the rollup slice and the catalog TOGETHER", async () => {
    const f = fake();
    const w = await runUploadRefresh(f.client, { clientId: "c", source: "spos", uploadId: "u1", slice: SLICE });
    expect(w).toEqual([]);
    expect(f.calls.sort()).toEqual(["refresh_dashboard_rollup_slice", "refresh_product_catalog_for_upload"]);
    expect(f.maxInFlight()).toBe(2); // overlapped, not one after the other
  });

  it("ads: rollup slice + ads rollup slice, no catalog", async () => {
    const f = fake();
    await runUploadRefresh(f.client, { clientId: "c", source: "ads", uploadId: "u", slice: SLICE });
    expect(f.calls.sort()).toEqual(["refresh_ads_rollup_slice", "refresh_dashboard_rollup_slice"]);
  });

  it("perf: only the rollup slice", async () => {
    const f = fake();
    await runUploadRefresh(f.client, { clientId: "c", source: "perf", uploadId: "u", slice: SLICE });
    expect(f.calls).toEqual(["refresh_dashboard_rollup_slice"]);
  });

  it("incomplete slice key falls back to the client-wide rebuilds", async () => {
    const f = fake();
    await runUploadRefresh(f.client, { clientId: "c", source: "ads", uploadId: "u", slice: { ...SLICE, week: null } });
    expect(f.calls.sort()).toEqual(["refresh_ads_rollup", "refresh_dashboard_rollup"]);
  });

  it("passes the slice and ids to the database functions", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    await runUploadRefresh({ rpc }, { clientId: "client-1", source: "spos", uploadId: "up-9", slice: SLICE });
    expect(rpc).toHaveBeenCalledWith("refresh_dashboard_rollup_slice", {
      p_client_id: "client-1", p_source: "spos", p_year: 2026, p_month: "Oktober", p_week: "Week 2", p_store_name: "lozindonesia",
    });
    expect(rpc).toHaveBeenCalledWith("refresh_product_catalog_for_upload", { p_upload_id: "up-9" });
  });

  it("returns a failed step as a warning and still finishes the others", async () => {
    const f = fake({ fail: ["refresh_product_catalog_for_upload"] });
    const w = await runUploadRefresh(f.client, { clientId: "c", source: "spos", uploadId: "u", slice: SLICE });
    expect(w).toEqual(["catalog: refresh_product_catalog_for_upload exploded"]);
    expect(f.calls).toContain("refresh_dashboard_rollup_slice");
  });

  it("a thrown error (network) becomes a warning instead of crashing the request", async () => {
    const f = fake({ throwOn: "refresh_dashboard_rollup_slice" });
    const w = await runUploadRefresh(f.client, { clientId: "c", source: "spos", uploadId: "u", slice: SLICE });
    expect(w).toEqual(["dashboard: socket hang up"]);
  });
});
