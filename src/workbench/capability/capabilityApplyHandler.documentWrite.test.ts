import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkbenchStore } from "../workbenchStore";
import { createDefaultWorkbenchDocument } from "../workbenchTypes";
import {
  overrideDocumentSessionPort,
  workbenchDocumentPlainText,
  type DocumentSessionPort,
} from "../project/documentSessionPort";
import { handleCapabilityApply } from "./capabilityApplyHandler";

const originalDocumentId = useWorkbenchStore.getState().activeDocumentId;
const originalDocuments = useWorkbenchStore.getState().workbenchDocuments;
let restoreOverride: (() => void) | null = null;

afterEach(() => {
  restoreOverride?.();
  restoreOverride = null;
  useWorkbenchStore.setState({ activeDocumentId: originalDocumentId, workbenchDocuments: originalDocuments });
});

function fakePort() {
  const port = {
    readFullText: () => "已有文稿",
    readSelectionText: () => "",
    readState: vi.fn(() => ({
      revision: 4,
      contentHash: "fnv1a-current",
      anchor: { kind: "whole-document" as const },
    })),
    applyDocumentWrite: vi.fn(() => ({ applied: true as const, revision: 5, contentHash: "fnv1a-next" })),
  };
  return port as DocumentSessionPort & { readState: ReturnType<typeof vi.fn>; applyDocumentWrite: ReturnType<typeof vi.fn> };
}

describe("document.write renderer capability boundary", () => {
  it("reads the live document state and applies the verified write through the session port", async () => {
    const port = fakePort();
    restoreOverride = overrideDocumentSessionPort(port);
    useWorkbenchStore.setState({ activeDocumentId: "document-live" });

    const result = await handleCapabilityApply("document.write", {
      projectId: "project-1",
      operation: "append",
      content: "追加的 Unicode 内容😀",
    });

    expect(result).toEqual({ applied: true, revision: 5, contentHash: "fnv1a-next" });
    expect(port.readState).toHaveBeenCalledOnce();
    expect(port.applyDocumentWrite).toHaveBeenCalledWith({
      operation: "append",
      content: "追加的 Unicode 内容😀",
      target: { kind: "document", documentId: "document-live", anchor: { kind: "whole-document" } },
      preconditions: { document: { revision: 4, contentHash: "fnv1a-current" } },
    });
  });

  // 创作页从未挂载（没有增强覆盖）：apply 路径照样落到 store——这就是 J 块要修的那条路。
  it("appends to the store document through the baseline port when no editor is mounted", async () => {
    const document = { ...createDefaultWorkbenchDocument(), id: "document-baseline", updatedAt: 1 };
    useWorkbenchStore.setState({ workbenchDocuments: [document], activeDocumentId: document.id });

    const result = await handleCapabilityApply("document.write", {
      projectId: "project-1",
      operation: "append",
      content: "第一句。",
    });

    const written = useWorkbenchStore.getState().workbenchDocuments.find((item) => item.id === document.id)!;
    expect(workbenchDocumentPlainText(written)).toBe("第一句。");
    expect(result).toMatchObject({ applied: true, revision: written.updatedAt });
  });

  it.each([
    ["unknown operation", { operation: "delete" }],
    ["empty content", { operation: "append", content: "" }],
    ["missing active document", { activeDocumentId: "" }],
  ] as const)("fails closed for document.write %s before applying", async (_label, state) => {
    const port = fakePort();
    restoreOverride = overrideDocumentSessionPort(port);
    useWorkbenchStore.setState({ activeDocumentId: "activeDocumentId" in state ? state.activeDocumentId : "document-live" });

    await expect(handleCapabilityApply("document.write", {
      projectId: "project-1",
      operation: "operation" in state ? state.operation : "append",
      content: "content" in state ? state.content : "valid content",
    })).rejects.toThrow();
    expect(port.applyDocumentWrite).not.toHaveBeenCalled();
  });
});
