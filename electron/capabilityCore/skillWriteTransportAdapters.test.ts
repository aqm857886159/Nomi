import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeToolCall } from "../harness/runtime/runtimePort";
import { SKILL_WRITE_CAPABILITY } from "../shared/agentCapabilities/skillWrite";
import type { SkillRecord } from "../skills/skillStore";
import type { SkillManifest } from "../skills/skillManifestSchema";
import {
  computeSkillContentHash,
  type ImportSkillResult,
  type SkillPackage,
} from "../skills/skillPackage";
import { createPiSkillWriteTransportAdapter } from "./skillWriteTransportAdapters";

const target = { kind: "document" as const, documentId: "doc-a", anchor: { kind: "whole-document" as const } };
const preconditions = { document: { revision: 2, contentHash: "before" } } as const;

function manifest(): SkillManifest {
  return {
    name: "creative.avatar",
    version: "1.0.0",
    description: "Create a consistent avatar.",
    tools: ["read_canvas_state", "create_canvas_nodes"],
    requiredProviders: ["image"],
    permissions: ["read-only", "create"],
  };
}

function call(overrides: Partial<RuntimeToolCall> = {}): RuntimeToolCall {
  return {
    toolCallId: "tool-skill-1",
    toolName: SKILL_WRITE_CAPABILITY.aliases.pi,
    args: { dirName: "creative-avatar", manifest: manifest(), skillMarkdown: "Use a clean avatar workflow." },
    ...overrides,
  };
}

function recordFor(pkg: SkillPackage, directoryName = pkg.dirName): SkillRecord {
  return {
    name: manifest().name,
    directoryName,
    filePath: `/tmp/${directoryName}/SKILL.md`,
    description: manifest().description,
    body: pkg.files["SKILL.md"],
    manifest: manifest(),
    origin: "user",
    audience: "internal",
    packageVersion: "nomi-skill-v1",
    contentHash: computeSkillContentHash(pkg.files),
  };
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

describe("skill.write transport adapter", () => {
  it("validates, asks the authoritative importer to write, and verifies the persisted record", async () => {
    let records: SkillRecord[] = [];
    const importer = vi.fn((pkg: SkillPackage): ImportSkillResult => {
      records = [recordFor(pkg)];
      return { ok: true, dirName: pkg.dirName, skillName: manifest().name, manifest: manifest() };
    });
    const adapter = createPiSkillWriteTransportAdapter({
      readRecords: () => records,
      importPackage: importer,
      now: () => 123,
    });
    const prepared = await adapter.prepare(call(), { target, preconditions }, signal());
    expect(prepared?.invocation.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared?.invocation.actionHash).toMatch(/^[a-f0-9]{64}$/);
    const result = await adapter.execute(prepared!, {
      receiptProposalId: "receipt-skill-1",
      approvalId: "approval-skill-1",
      actionHash: prepared!.invocation.actionHash,
    }, signal());
    expect(importer).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, proposalId: "receipt-skill-1", result: { applied: true, created: true } });
  });

  it("does not write twice when the approval is replayed after a lost response", async () => {
    let records: SkillRecord[] = [];
    const importer = vi.fn((pkg: SkillPackage): ImportSkillResult => {
      records = [recordFor(pkg)];
      return { ok: true, dirName: pkg.dirName, skillName: manifest().name, manifest: manifest() };
    });
    const adapter = createPiSkillWriteTransportAdapter({ readRecords: () => records, importPackage: importer });
    const prepared = await adapter.prepare(call(), { target, preconditions }, signal());
    const approval = { receiptProposalId: "receipt-replay", approvalId: "approval-replay", actionHash: prepared!.invocation.actionHash };
    const first = await adapter.execute(prepared!, approval, signal());
    const second = await adapter.execute(prepared!, approval, signal());
    expect(importer).toHaveBeenCalledOnce();
    expect(first).toMatchObject({ ok: true, result: { created: true } });
    expect(second).toMatchObject({ ok: true, result: { created: false } });
  });

  it("fails closed for malformed manifests, forged approval hashes, and cancelled calls", async () => {
    const importer = vi.fn<(_pkg: SkillPackage) => ImportSkillResult>();
    const adapter = createPiSkillWriteTransportAdapter({ readRecords: () => [], importPackage: importer });
    const malformed = await expect(adapter.prepare(call({ args: { dirName: "bad", manifest: { name: "missing-fields" }, skillMarkdown: "body" } }), { target, preconditions }, signal())).rejects;
    await malformed.toThrow("capability_input_invalid");
    const prepared = await adapter.prepare(call(), { target, preconditions }, signal());
    const forged = await adapter.execute(prepared!, {
      receiptProposalId: "receipt-forged",
      approvalId: "approval-forged",
      actionHash: createHash("sha256").update("forged").digest("hex"),
    }, signal());
    expect(forged).toMatchObject({ ok: false, code: "capability_authority_invalid" });
    const controller = new AbortController();
    controller.abort();
    const cancelled = await adapter.execute(prepared!, {
      receiptProposalId: "receipt-cancelled",
      approvalId: "approval-cancelled",
      actionHash: prepared!.invocation.actionHash,
    }, controller.signal);
    expect(cancelled).toMatchObject({ ok: false, code: "capability_cancelled" });
    expect(importer).not.toHaveBeenCalled();
  });

  it("never reports success when the importer does not leave a matching catalog record", async () => {
    const importer = vi.fn((_pkg: SkillPackage): ImportSkillResult => ({
      ok: true,
      dirName: "creative-avatar",
      skillName: manifest().name,
      manifest: manifest(),
    }));
    const adapter = createPiSkillWriteTransportAdapter({ readRecords: () => [], importPackage: importer });
    const prepared = await adapter.prepare(call(), { target, preconditions }, signal());
    const result = await adapter.execute(prepared!, {
      receiptProposalId: "receipt-no-effect",
      approvalId: "approval-no-effect",
      actionHash: prepared!.invocation.actionHash,
    }, signal());
    expect(result).toMatchObject({ ok: false, code: "capability_execution_failed" });
  });
});
