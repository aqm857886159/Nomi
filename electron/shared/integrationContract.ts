/** Shared lifecycle vocabulary for the integration session and its durable
 * certification projection. Both main and renderer DTOs derive from these
 * tuples instead of maintaining parallel string unions. */
export const INTEGRATION_STAGES = [
  "draft",
  "needs_credential",
  "needs_input",
  "discovering",
  "needs_selection",
  "needs_spend_confirmation",
  "certifying",
  "committing",
  "completed",
  "partial",
  "failed",
  "cancelled",
] as const;

export type IntegrationStage = typeof INTEGRATION_STAGES[number];

export const INTEGRATION_CREDENTIAL_STATUSES = ["missing", "ready", "needs_resave", "unavailable"] as const;
export type IntegrationCredentialStatus = typeof INTEGRATION_CREDENTIAL_STATUSES[number];

export const INTEGRATION_START_RECEIPT_STATUSES = ["pending", "consumed"] as const;
export type IntegrationStartReceiptStatus = typeof INTEGRATION_START_RECEIPT_STATUSES[number];
