import { afterEach, describe, expect, it, vi } from "vitest";

import type { CreationDocumentTools } from "../workbenchTypes";
import { useWorkbenchStore } from "../workbenchStore";
import { handleCapabilityApply } from "./capabilityApplyHandler";

const originalDocumentId = useWorkbenchStore.getState().activeDocumentId;
const originalTools = useWorkbenchStore.getState().creationDocumentTools;

afterEach(() => {
  useWorkbenchStore.setState({ activeDocumentId: originalDocumentId, creationDocumentTools: originalTools });
});

function tools() {
  return {
    readFullText: () => "已有文稿",
    readSelectionText: () => "",
    readState: vi.fn(() => ({
      revision: 4,
      contentHash: "fnv1a-current",
      anchor: { kind: "whole-document" as const },
    })),
    applyDocumentWrite: vi.fn(() => ({ applied: true as const, revision: 5, contentHash: "fnv1a-next" })),
    insertAtCursor: () => {},
    replaceSelection: () => {},
    appendToEnd: () => {},
  } as unknown as CreationDocumentTools & {
    readState: ReturnType<typeof vi.fn>;
    applyDocumentWrite: ReturnType<typeof vi.fn>;
  };
}

type DocumentWriteFailureState = {
  creationDocumentTools: ReturnType<typeof tools> | null;
  activeDocumentId?: string;
  operation?: string;
  content?: string;
};

const documentWriteFailureCases: readonly (readonly [string, DocumentWriteFailureState])[] = [
  ["missing tools", { creationDocumentTools: null }],
  ["unknown operation", { creationDocumentTools: tools(), operation: "delete" }],
  ["empty content", { creationDocumentTools: tools(), operation: "append", content: "" }],
  ["missing active document", { creationDocumentTools: tools(), activeDocumentId: "" }],
];

describe("document.write renderer capability boundary", () => {
  it("reads the live document state and applies the verified write through CreationDocumentTools", async () => {
    const documentTools = tools();
    useWorkbenchStore.setState({ activeDocumentId: "document-live", creationDocumentTools: documentTools });

    const result = await handleCapabilityApply("document.write", {
      projectId: "project-1",
      operation: "append",
      content: "追加的 Unicode 内容😀",
    });

    expect(result).toEqual({ applied: true, revision: 5, contentHash: "fnv1a-next" });
    expect(documentTools.readState).toHaveBeenCalledOnce();
    expect(documentTools.applyDocumentWrite).toHaveBeenCalledWith({
      operation: "append",
      content: "追加的 Unicode 内容😀",
      target: { kind: "document", documentId: "document-live", anchor: { kind: "whole-document" } },
      preconditions: { document: { revision: 4, contentHash: "fnv1a-current" } },
    });
  });

  it.each(documentWriteFailureCases)("fails closed for document.write %s before applying", async (_label, state) => {
    const documentTools = state.creationDocumentTools;
    useWorkbenchStore.setState({
      activeDocumentId: state.activeDocumentId ?? "document-live",
      creationDocumentTools: documentTools,
    });

    await expect(handleCapabilityApply("document.write", {
      projectId: "project-1",
      operation: state.operation ?? "append",
      content: state.content ?? "valid content",
    })).rejects.toThrow();
    if (documentTools) {
      expect(documentTools.applyDocumentWrite).not.toHaveBeenCalled();
    }
  });
});
