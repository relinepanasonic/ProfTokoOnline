// The tenant that maintains the Marketplace Fee table (Prof Toko Online).
// Owners (branch_manager) of ANY tenant read fees from here — a customer
// who signed up on their own has an empty tenant of their own, so reading
// their own client_id would leave the Price Calculator with no fee data.
// Must match the hardcoded client_id in migration 0125's
// market_fees_read_master policy. Staff keep reading their own tenant.
export const FEE_SOURCE_CLIENT_ID =
  process.env.NEXT_PUBLIC_FEE_CLIENT_ID || "92213048-a91b-4202-9b47-8d1c38671082";
