/** Only read-only account figures leave the main process. Unknown figures stay null. */
export type VendorAccountFacts = {
  vendorKey: string;
  checkedAt: number;
  keyState: "valid" | "invalid" | "unknown";
  accountCredits: number | null;
  keyCredits: number | null;
  keyUnlimited: boolean;
  usageCredits: number | null;
  usageRequests: number | null;
};
