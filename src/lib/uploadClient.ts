import { safeJson } from "@/lib/safeJson";

/**
 * Second step of a SPOS / Ads / Performa upload: ask the server to refresh the dashboard tables for the
 * upload that was just saved (/api/upload/refresh). Returns a warning text, or undefined when all went well.
 * The rows are already saved at this point, so a failure here is only a warning (and can be retried).
 */
export async function refreshAfterUpload(uploadId: string | undefined | null): Promise<string | undefined> {
  if (!uploadId) return undefined;
  try {
    const res = await fetch("/api/upload/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_id: uploadId }),
    });
    const j = await safeJson(res);
    if (!res.ok) return `dashboard refresh: ${j?.error || res.status}`;
    return j?.rollup_warning || undefined;
  } catch (e) {
    return `dashboard refresh: ${e instanceof Error ? e.message : String(e)}`;
  }
}
