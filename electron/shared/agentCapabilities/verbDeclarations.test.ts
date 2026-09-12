// 四条装配期不变量（A1–A4）的**阳性对照**（R17：加规则必须先验它会红）。
//
// 规则本体住 `verbDeclaration.ts` 的 `assembleVerbDeclarations`；这里对每条先证明它会红，再证明
// 真实的 `VERB_DECLARATIONS` 原样通过（合法近邻）。少了后者，一个「什么都判红」的规则也能过 CI。
import { describe, expect, it } from "vitest";

import { CAPABILITY_CONTRACTS } from "./registry";
import { isPaidBoundaryAlias } from "./paidBoundary";
import { assembleVerbDeclarations, proseWithoutQuotedExamples, renderVerbDescription, verbConsequence, type VerbDeclaration } from "./verbDeclaration";
import { VERB_DECLARATIONS } from "./verbDeclarations";
import { modelFacingToolSpecs, mcpProfileTools } from "./modelFacingToolRegistry";

function assemble(declarations: readonly VerbDeclaration[]) {
  return assembleVerbDeclarations({
    declarations,
    contractById: (id) => CAPABILITY_CONTRACTS.find((contract) => contract.id === id),
    isPaidBoundaryName: isPaidBoundaryAlias,
  });
}

function mutate(name: string, patch: (declaration: VerbDeclaration) => VerbDeclaration): VerbDeclaration[] {
  const found = VERB_DECLARATIONS.find((declaration) => declaration.name === name);
  if (!found) throw new Error(`fixture: ${name} is not declared`);
  return VERB_DECLARATIONS.map((declaration) => (declaration === found ? patch(declaration) : declaration));
}

describe("动词声明 · 装配期不变量", () => {
  it("真实的声明表原样通过（合法近邻）", () => {
    expect(() => assemble(VERB_DECLARATIONS)).not.toThrow();
    expect(new Set(VERB_DECLARATIONS.map((d) => d.name)).size).toBe(VERB_DECLARATIONS.length);
  });

  it("A1 · 一效果一工具：效果与契约不一致、内部 profile 见 spend、读动词承诺 nextAction 都抛", () => {
    expect(() => assemble(mutate("generate", (d) => ({ ...d, effect: "spend", nextAction: "user_sees_spend_card" }))))
      .toThrow(/implies "reversible_local"/);
    expect(() => assemble(mutate("read_timeline", (d) => ({ ...d, effect: "reversible_local" }))))
      .toThrow(/implies "read"/);
    expect(() => assemble(mutate("read_timeline", (d) => ({ ...d, nextAction: "user_sees_panel" }))))
      .toThrow(/read-only but promises/);
    expect(() => assemble(mutate("arrange_canvas", (d) => ({ ...d, operationEffects: { create_canvas_nodes: "read" } } as VerbDeclaration))))
      .toThrow(/per-operation effects/);
    // 内部 profile 里出现 spend：先绕过契约对账（用一个真的付费契约）也过不了「内部不投 spend」。
    expect(() => assemble([...VERB_DECLARATIONS, {
      ...VERB_DECLARATIONS[0]!, name: "nomi_start_generation", contractId: "generation.gate", effect: "spend", nextAction: "user_sees_spend_card",
      describe: { ...VERB_DECLARATIONS[0]!.describe, notWhen: "Use nomi_canvas_read instead." },
    }])).toThrow(/cannot project to the internal profile/);
  });

  it("A2 · 描述五槽：缺槽、notWhen 不点名别的动词、点名不存在的名字、does 太长都抛", () => {
    expect(() => assemble(mutate("read_script", (d) => ({ ...d, describe: { ...d.describe, notWhen: "" } }))))
      .toThrow(/describe\.notWhen empty/);
    expect(() => assemble(mutate("read_script", (d) => ({ ...d, describe: { ...d.describe, notWhen: "Do not use it for anything else." } }))))
      .toThrow(/must name at least one other declared verb/);
    expect(() => assemble(mutate("read_script", (d) => ({ ...d, describe: { ...d.describe, notWhen: "Use read_timeline or nomi_make_video instead of read_script." } }))))
      .toThrow(/names "nomi_make_video"/);
    expect(() => assemble(mutate("read_script", (d) => ({ ...d, describe: { ...d.describe, does: `Reads. ${"x".repeat(200)}` } }))))
      .toThrow(/at most 160 characters/);
    // 合法近邻：schema 自己的枚举值可以出现在描述里。
    expect(() => assemble(mutate("arrange_canvas", (d) => ({ ...d, describe: { ...d.describe, params: `${d.describe.params} links batches nodes.` } }))))
      .not.toThrow();
  });

  it("A3 · 语言统一：说明性文字里的中文抛；引号里的示例值与 examples.arguments 豁免", () => {
    expect(() => assemble(mutate("read_script", (d) => ({ ...d, examples: [{ when: "创建一个镜头：", arguments: {} }] }))))
      .toThrow(/contains CJK characters/);
    expect(() => assemble(mutate("read_script", (d) => ({ ...d, promptGuidelines: ["先读文稿。"] }))))
      .toThrow(/promptGuidelines\[0\]/);
    expect(proseWithoutQuotedExamples("Display name, in the user's language (e.g. '林夏' / '天台').")).not.toMatch(/[一-鿿]/);
    expect(() => assemble(mutate("arrange_canvas", (d) => ({ ...d, examples: [{ when: "Create one node:", arguments: { links: [{ fromId: "node-a", toId: "node-b", role: "character_ref" }] } }] }))))
      .not.toThrow();
  });

  it("A4 · 不与付费边界矛盾：手写的后果句抛；后果句只能由 effect × nextAction 派生", () => {
    expect(() => assemble(mutate("generate", (d) => ({ ...d, describe: { ...d.describe, does: "This host cannot preview or start paid generation." } }))))
      .toThrow(/hand-writes a consequence/);
    expect(() => assemble(mutate("arrange_canvas", (d) => ({ ...d, describe: { ...d.describe, useWhen: `${d.describe.useWhen} It never generates.` } }))))
      .toThrow(/hand-writes a consequence/);
    expect(() => verbConsequence("read", "user_sees_spend_card")).toThrow(/inconsistent/);
    expect(renderVerbDescription(VERB_DECLARATIONS.find((d) => d.name === "generate")!))
      .toMatch(/priced confirmation card .* nothing is generated and nothing is spent until the user approves/);
  });

  it("profile 差异只能来自声明：缺 profileReason 抛；付费边界一个名字都不进内部面", () => {
    expect(() => assemble(mutate("generate", (d) => ({ ...d, profileReason: undefined }))))
      .toThrow(/gives no profileReason/);
    for (const spec of modelFacingToolSpecs("internal")) expect(isPaidBoundaryAlias(spec.name), spec.name).toBe(false);
    for (const tool of mcpProfileTools()) expect(tool.name.startsWith("nomi_"), tool.name).toBe(true);
  });
});
