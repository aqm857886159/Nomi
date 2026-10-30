/** One decision for tool receipts and the permission to offer a spend confirmation. */
export function submissionActions(input: {
  status: string; errorCode?: string; providerTaskId?: string; materialized?: boolean; retryCount?: number;
}) {
  const safe = input.status === "needs_attention"
    && ["provider_not_reached", "provider_rejected"].includes(input.errorCode ?? "");
  const answered = !!input.providerTaskId || input.errorCode === "output_retrieval_failed";
  const phase = input.materialized ? "succeeded"
    : input.status === "submission_unknown" ? "submission_unknown"
    : answered ? "accepted"
    : safe ? "not_sent" : "submitting";
  return {
    phase,
    accepted: safe ? "not_sent" : answered ? "accepted" : "unknown",
    allowedActions: [
      ...(input.providerTaskId ? ["query"] : ["inspect_provider"]),
      ...(safe && (input.retryCount ?? 0) < 1 ? ["retry"] : []),
      "request_new_attempt",
    ],
    // A request is not approval: a new attempt must still pass the human spend gate.
    newAttemptRequiresUserConfirmation: true,
  } as const;
}

export type SubmissionActionProjection = ReturnType<typeof submissionActions>;
