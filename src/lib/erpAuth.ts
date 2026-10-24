import crypto from "crypto";
import type { NextRequest } from "next/server";

// Shared by every /api/erp/* feed (server-to-server, accounting ERP).
//  * the key is ONLY accepted from `Authorization: Bearer <ERP_API_KEY>` — never from the query string;
//  * ERP_API_KEY not set -> always unauthorised;
//  * constant-time: SHA-256 both sides first, so the comparison takes the same time wherever the first
//    mismatch is and a length difference leaks nothing.
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function erpAuthorized(req: NextRequest): boolean {
  const expected = process.env.ERP_API_KEY;
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/.exec(header.trim());
  if (!m) return false;
  return safeEqual(m[1], expected);
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;
