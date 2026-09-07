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

const SKILL_NAME = "creative-avatar";
const SKILL_DESCRIPTION = "Create a consistent avatar.";
/** A skill is one file; the frontmatter is the whole manifest. */
const SKILL_MARKDOWN = [
  "---",
  `name: ${SKILL_NAME}`,
  `description: ${SKILL_DESCRIPTION}`,
  "metadata:",
  "  nomi:",
  '    version: "1.0.0"',
  "    tools: [read_canvas_state, create_canvas_nodes]",
  "    required-providers: [image]",
  "---",
  "",
  "Use a clean avatar workflow.",
].join("\n");

function manifest(): SkillManifest {
  return {
    version: "1.0.0",
    tools: ["read_canvas_state", "create_canvas_nodes"],
    requiredProviders: ["image"],
  };
}

function call(overrides: Partial<RuntimeToolCall> = {}): RuntimeToolCall {
  return {
    toolCallId: "tool-skill-1",
    toolName: SKILL_WRITE_CAPABILITY.aliases.pi,
    args: { dirName: "creative-avatar", skillMarkdown: SKILL_MARKDOWN },
    ...overrides,
  };
}

function recordFor(pkg: SkillPackage, directoryName = pkg.dirName): SkillRecord {
  return {
    name: SKILL_NAME,
    directoryName,
    filePath: `/tmp/${directoryName}/SKILL.md`,
    description: SKILL_DESCRIPTION,
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
      return { ok: true, dirName: pkg.dirName, skillName: SKILL_NAME };
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
      return { ok: true, dirName: pkg.dirName, skillName: SKILL_NAME };
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

  it("fails closed for unreadable frontmatter, forged approval hashes, and cancelled calls", async () => {
    const importer = vi.fn<(_pkg: SkillPackage) => ImportSkillResult>();
    const adapter = createPiSkillWriteTransportAdapter({ readRecords: () => [], importPackage: importer });
    // 未加引号的值里带 ": " —— 真 YAML 解析器读不动，别的宿主会整包丢掉它，所以不许落盘。
    const brokenFrontmatter = "---\nname: bad\ndescription: 为 anchor（`carrier: visual`）写提示词\n---\n\nbody";
    const malformed = await expect(adapter.prepare(call({ args: { dirName: "bad", skillMarkdown: brokenFrontmatter } }), { target, preconditions }, signal())).rejects;
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
      skillName: SKILL_NAME,
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
