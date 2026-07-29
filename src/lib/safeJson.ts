// A killed serverless function (e.g. past Vercel's maxDuration) returns a
// plaintext platform error page, not JSON. An unguarded `res.json()` throws
// an unreadable "Unexpected token 'A', "An error o"... is not valid JSON" on
// that instead of a useful message. Check content-type first.
export async function safeJson(res: Response): Promise<any> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  const text = await res.text();
  throw new Error(`Server error (${res.status}): ${text.slice(0, 120)}`);
}
