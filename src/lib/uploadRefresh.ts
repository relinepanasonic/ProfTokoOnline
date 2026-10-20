// Derived-table refresh after a SPOS / Ads / Performa upload (migrations 0107-0110).
//
// The rows are already in sales_rows when this runs. It recomputes what the dashboards read:
//   * dashboard_rollup (+ completeness)  - every source
//   * ads_rollup                          - ads only
//   * product_catalog                     - spos only
// These are independent of each other (different target tables), so they run IN PARALLEL: for a
// 1,470-row SPOS file that is max(25 s, 33 s) instead of 25 s + 33 s, which is what pushed the single
// request over Vercel's 60 s limit (504 FUNCTION_INVOCATION_TIMEOUT). The upload page now calls this
// in its own request (/api/upload/refresh) so it also gets its own 60 s budget.
//
// Errors are returned, not thrown or swallowed (migration 0102): the rows are saved regardless, a
// failed refresh must be visible instead of leaving the dashboard silently stale.

export type RefreshSource = "spos" | "ads" | "perf";

type RpcResult = { error: { message: string } | null };
export type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult> };

export type RefreshSlice = { year: number | null; month: string | null; week: string | null; store_name: string | null };

export async function runUploadRefresh(
  admin: RpcClient,
  opts: { clientId: string; source: RefreshSource; uploadId: string; slice: RefreshSlice },
): Promise<string[]> {
  const { clientId, source, uploadId, slice } = opts;
  // SLICE-scoped refresh only when the whole slice key is known; otherwise the client-wide rebuild
  // so data is never left stale (same rule the upload route has always had).
  const canSlice = slice.year != null && !!slice.month && !!slice.week && !!slice.store_name;

  const jobs: { label: string; run: () => PromiseLike<RpcResult> }[] = [
    {
      label: "dashboard",
      run: () => canSlice
        ? admin.rpc("refresh_dashboard_rollup_slice", {
            p_client_id: clientId, p_source: source, p_year: slice.year,
            p_month: slice.month, p_week: slice.week, p_store_name: slice.store_name,
          })
        : admin.rpc("refresh_dashboard_rollup", { p_client_id: clientId }),
    },
  ];
  if (source === "ads") {
    jobs.push({
      label: "ads",
      run: () => canSlice
        ? admin.rpc("refresh_ads_rollup_slice", {
            p_client_id: clientId, p_year: slice.year, p_month: slice.month, p_week: slice.week, p_store_name: slice.store_name,
          })
        : admin.rpc("refresh_ads_rollup", { p_client_id: clientId }),
    });
  }
  if (source === "spos") {
    jobs.push({ label: "catalog", run: () => admin.rpc("refresh_product_catalog_for_upload", { p_upload_id: uploadId }) });
  }

  const results = await Promise.all(
    jobs.map(async (j) => {
      try { return { label: j.label, error: (await j.run()).error }; }
      catch (e) { return { label: j.label, error: { message: e instanceof Error ? e.message : String(e) } }; }
    }),
  );
  const warnings: string[] = [];
  for (const r of results) {
    if (r.error) {
      console.error(`refresh_${r.label} failed:`, r.error);
      warnings.push(`${r.label}: ${r.error.message}`);
    }
  }
  return warnings;
}
