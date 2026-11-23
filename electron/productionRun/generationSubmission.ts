import type { ProductionRunRuntimeEnvelopeStore, RuntimeEnvelopeSealInput } from "./productionRunRuntimeEnvelope";
import { SubmissionReceiptUnknownError, createSubmissionOutbox, type ProviderDispatchInput, type ProviderDispatchResult, type SubmissionOutboxDependencies, type SubmissionOutboxRequest } from "./submissionOutbox";

export type RunOwnedGenerationSubmissionInput = {
  request: SubmissionOutboxRequest;
  envelope: RuntimeEnvelopeSealInput;
};

export type RunOwnedGenerationSubmissionDependencies = Omit<SubmissionOutboxDependencies, "afterDispatch"> & {
  envelopeFor: (input: { runId: string; jobId: string }) => ProductionRunRuntimeEnvelopeStore;
  afterProviderAccepted?: (result: ProviderDispatchResult, input: ProviderDispatchInput) => void | Promise<void>;
};

export function createRunOwnedGenerationSubmission(deps: RunOwnedGenerationSubmissionDependencies) {
  const outbox = createSubmissionOutbox({
    ...deps,
    persistAcceptance: (receipt, input) => {
      deps.envelopeFor({ runId: input.run.runId, jobId: input.job.jobId }).markProviderAccepted({ providerTaskId: receipt.taskId, acceptance: receipt });
    },
    afterDispatch: async (result, input) => {
      deps.envelopeFor({ runId: input.run.runId, jobId: input.job.jobId }).markProviderAccepted({ providerTaskId: result.providerTaskId, rawReceipt: result });
      await deps.afterProviderAccepted?.(result, input);
    },
  });

  async function submit(input: RunOwnedGenerationSubmissionInput) {
    const envelope = deps.envelopeFor({ runId: input.request.runId, jobId: input.request.jobId });
    envelope.seal(input.envelope);
    try {
      return await outbox.submit(input.request);
    } catch (error) {
      if (error instanceof SubmissionReceiptUnknownError) envelope.markSubmittedUnknown();
      throw error;
    }
  }

  return { submit };
}

export type RunOwnedGenerationSubmission = ReturnType<typeof createRunOwnedGenerationSubmission>;
