import { describe, expect, it, vi } from "vitest";

import {
  abandonDocumentProposalReceipt,
  commitDocumentProposalReceipt,
  documentProposalReceiptFor,
  prepareDocumentProposalReceipt,
} from "./projectAgentDocumentReceipt";

const persisted = {
  receiptProposalId: "receipt-id",
  approvalId: "approval-id",
  actionHash: "action-hash",
};
const prepared = { invocation: { input: { operation: "append" as const } } };

describe("Project Agent document receipt helper", () => {
  it.each([
    [{ toolName: "nomi_document_edit", args: {} }, prepared, "append"],
    [{ toolName: "append_to_end", args: {} }, { invocation: { input: undefined } }, "append"],
    [{ toolName: "unknown_alias", args: { operation: "replace" } }, { invocation: { input: undefined } }, "replace"],
    [{ toolName: "unknown_alias", args: {} }, { invocation: { input: undefined } }, "write"],
  ])("preserves the resolved operation in the durable proposal", (call, preparedInput, operation) => {
    const resolved = documentProposalReceiptFor(
      call,
      persisted,
      preparedInput,
    );

    expect(resolved).toMatchObject({
      proposalId: "receipt-id",
      hostApprovalId: "approval-id",
      hostActionHash: "action-hash",
      summary: `${operation} ${call.toolName}`,
      stepLabels: [`${operation}:${call.toolName}`],
    });
  });

  it("prepares, commits, and abandons the same receipt with CAS revisions", () => {
    const proposal = documentProposalReceiptFor({ toolName: "nomi_document_edit", args: {} }, persisted, prepared);
    const writer = {
      read: vi.fn(() => null),
      write: vi.fn((value) => ({ ...value, revision: 1 })),
      transition: vi.fn(),
    };

    const preparing = prepareDocumentProposalReceipt(writer, proposal, "approval-id");
    commitDocumentProposalReceipt(writer, preparing, proposal, "approval-id");
    abandonDocumentProposalReceipt(writer, preparing, proposal, "approval-id");

    expect(writer.write).toHaveBeenNthCalledWith(1, expect.objectContaining({ expectedRevision: 0, lifecycle: "preparing" }));
    expect(writer.write).toHaveBeenNthCalledWith(2, expect.objectContaining({ expectedRevision: 1, lifecycle: "committed" }));
    expect(writer.transition).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1, lifecycle: "undone" }));
  });

  it("preserves a preparing receipt when the undone CAS transition fails", () => {
    const proposal = documentProposalReceiptFor({ toolName: "nomi_document_edit", args: {} }, persisted, prepared);
    const writer = {
      read: () => ({ revision: 4 }),
      write: (value: unknown) => ({ ...(value as object), revision: 5 }),
      transition: () => { throw new Error("stale revision"); },
    };

    expect(() => abandonDocumentProposalReceipt(writer, { revision: 5 }, proposal, "approval-id")).not.toThrow();
  });
});
