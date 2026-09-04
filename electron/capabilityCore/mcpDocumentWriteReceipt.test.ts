import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectAgentProposalReceiptService } from "../projectAgentHost/projectAgentProposalReceiptStore";
import {
  createProjectAgentProposalReceiptService,
} from "../projectAgentHost/projectAgentProposalReceiptStore";
import { executeMcpDocumentWriteWithReceipt } from "./mcpDocumentWriteReceipt";

const binding = {
  projectId: "mcp-receipt-project",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 1,
} as const;

const proposalService = (projectRoot: string) => createProjectAgentProposalReceiptService({ projectRoot, binding });

let roots: string[] = [];

function tempProject(): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-mcp-document-receipt-"));
  fs.mkdirSync(path.join(projectRoot, ".nomi"), { recursive: true });
  roots.push(projectRoot);
  return projectRoot;
}

afterEach(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  roots = [];
});

describe("MCP document.write durable receipt boundary", () => {
  it("prepares before the real executor and commits the same receipt after applied=true", async () => {
    const service = proposalService(tempProject());
    const execute = vi.fn(async () => ({ applied: true, revision: 2 }));

    const result = await executeMcpDocumentWriteWithReceipt({
      service,
      operation: "append",
      execute,
    });

    expect(result).toEqual({ applied: true, revision: 2 });
    expect(execute).toHaveBeenCalledOnce();
    expect(service.read()).toMatchObject({ revision: 2, lifecycle: "committed", proposal: {
      summary: "MCP document append",
      stepLabels: ["document.write:append"],
    } });
  });

  it.each([
    { label: "timeout", error: Object.assign(new Error("capability_timeout"), { code: "capability_timeout" }) },
    { label: "network failure", error: Object.assign(new Error("capability_execution_failed"), { code: "capability_execution_failed" }) },
  ])("records an undone receipt for a %s before returning the fail-closed error", async ({ error }) => {
    const service = proposalService(tempProject());
    const execute = vi.fn(async () => { throw error; });

    await expect(executeMcpDocumentWriteWithReceipt({ service, operation: "replace", execute }))
      .rejects.toBe(error);
    expect(execute).toHaveBeenCalledOnce();
    expect(service.read()).toMatchObject({ revision: 2, lifecycle: "undone" });
  });

  it("turns an applied=false result into durable undone evidence without claiming success", async () => {
    const service = proposalService(tempProject());

    await expect(executeMcpDocumentWriteWithReceipt({
      service,
      operation: "insert",
      execute: async () => ({ applied: false }),
    })).rejects.toThrow("capability_execution_failed");
    expect(service.read()).toMatchObject({ revision: 2, lifecycle: "undone" });
  });

  it("records commit failure separately when the effect was applied but receipt commit failed", async () => {
    const projectRoot = tempProject();
    const backing = proposalService(projectRoot);
    let writes = 0;
    const service = {
      ...backing,
      write: vi.fn((input: Parameters<ProjectAgentProposalReceiptService["write"]>[0]) => {
        writes += 1;
        if (writes === 2) throw new Error("receipt_commit_write_failed");
        return backing.write(input);
      }),
    } as unknown as ProjectAgentProposalReceiptService;

    await expect(executeMcpDocumentWriteWithReceipt({
      service,
      operation: "append",
      execute: async () => ({ applied: true }),
    })).rejects.toThrow("receipt_commit_write_failed");
    expect(backing.read()).toMatchObject({ revision: 2, lifecycle: "commit_failed" });
  });

  it("never claims undone when cancellation arrives after the executor reports an effect", async () => {
    const service = proposalService(tempProject());
    const controller = new AbortController();

    await expect(executeMcpDocumentWriteWithReceipt({
      service,
      operation: "append",
      signal: controller.signal,
      execute: async () => {
        controller.abort(new Error("late cancel"));
        return { applied: true };
      },
    })).rejects.toThrow("late cancel");

    expect(service.read()).toMatchObject({ revision: 2, lifecycle: "effect_unknown" });
  });

  it("reconciles a preparing receipt after restart as effect-unknown", async () => {
    const projectRoot = tempProject();
    const first = proposalService(projectRoot);
    let writes = 0;
    await expect(executeMcpDocumentWriteWithReceipt({
      service: {
        ...first,
        write: vi.fn((input: Parameters<ProjectAgentProposalReceiptService["write"]>[0]) => {
          if (++writes === 2) throw new Error("receipt commit interrupted");
          return first.write(input);
        }),
        transition: vi.fn(() => { throw new Error("receipt commit interrupted"); }),
      } as unknown as ProjectAgentProposalReceiptService,
      operation: "append",
      execute: async () => ({ applied: true }),
    })).rejects.toThrow("receipt commit interrupted");

    const restarted = proposalService(projectRoot);
    expect(restarted.read()).toMatchObject({ lifecycle: "preparing" });
    expect(restarted.reconcileInDoubt()).toMatchObject({ lifecycle: "effect_unknown" });
    expect(restarted.read()).toMatchObject({ lifecycle: "effect_unknown" });
  });

  it("preserves preparing evidence when its failure transition loses the receipt CAS race", async () => {
    const projectRoot = tempProject();
    const backing = proposalService(projectRoot);
    const service = {
      ...backing,
      transition: vi.fn(() => { throw new Error("revision_conflict"); }),
    } as unknown as ProjectAgentProposalReceiptService;

    await expect(executeMcpDocumentWriteWithReceipt({
      service,
      operation: "append",
      execute: async () => { throw new Error("provider disconnected"); },
    })).rejects.toThrow("provider disconnected");
    expect(backing.read()).toMatchObject({ revision: 1, lifecycle: "preparing" });
    expect(service.transition).toHaveBeenCalledOnce();
  });

  it("fails before dispatch when the service read is stale, preserving the existing receipt", async () => {
    const projectRoot = tempProject();
    const backing = proposalService(projectRoot);
    await executeMcpDocumentWriteWithReceipt({
      service: backing,
      operation: "append",
      execute: async () => ({ applied: true }),
    });
    const service = {
      ...backing,
      read: vi.fn(() => null),
    } as unknown as ProjectAgentProposalReceiptService;
    const execute = vi.fn(async () => ({ applied: true }));

    await expect(executeMcpDocumentWriteWithReceipt({ service, operation: "append", execute }))
      .rejects.toMatchObject({ code: "revision_conflict" });
    expect(execute).not.toHaveBeenCalled();
    expect(backing.read()).toMatchObject({ revision: 2, lifecycle: "committed" });
  });
});
