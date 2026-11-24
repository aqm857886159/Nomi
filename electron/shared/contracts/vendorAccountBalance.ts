/** Account balance lookup input for an official built-in vendor (read-only). */
export type VendorAccountBalanceRequest = { vendorKey: string };

/**
 * Snapshot of remaining account balance for an official built-in vendor.
 * Used only for displaying the low-balance shortfall / top-up shortcut beside the send button;
 * never caches indefinitely and never blocks sending when unknown or expired.
 */
export type VendorAccountBalance = {
  /** Remaining usable credits (APIMart: remain_credits ?? remain_balance * 10); null when unlimited. */
  remainCredits: number | null;
  /** Remaining USD balance (remain_balance); null when unlimited. */
  remainUsd: number | null;
  /** True when the upstream reports an unlimited balance (e.g. APIMart remain_balance === -1). */
  unlimited: boolean;
  /** Token-specific quota flag, independent of the account display. */
  unlimitedQuota?: boolean;
  /** Official top-up / account URL (including invite code when configured). */
  topUpUrl: string;
  /** Epoch ms when main process fetched this snapshot. */
  fetchedAt: number;
};

export type VendorBalanceCheck =
  | { status: "received"; balance: VendorAccountBalance | null }
  | { status: "offline" | "invalid" | "unavailable" };

/** Local shape check shared by the APIMart input and its main-process write boundary. */
export function isApimartKeyCandidate(key: string): boolean {
  return /^sk-\S+$/.test(key);
}
