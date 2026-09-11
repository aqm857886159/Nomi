// `layout.read` / `layout.write` 的动词声明——**不投内部 profile**，对外传输今天仍是手写的。
//
// 不投内部的理由是领域约束「无头宿主」（设计正本 §6.4，用户 09-11 拍板的唯一额外差异）：Nomi 自己的
// Agent 住在工作台里，五面板布局是用户手边的东西，模型没有理由替他摆；外部宿主（Claude Code 之类）
// 看不见 Nomi 的界面，读/摆布局是它把结果呈现给用户的唯一手段。对外 `nomi_layout_read/write` 的传输
// schema 今天住 `mcpCapabilityProjection.ts`（手写，带 `operation:"read"|"write"`），所以 `profiles: []`
// + 过渡理由 `mcpHandwrittenTransport`：描述已经只有这一份 owner，传输在 PR B 收编成派生。
// PR A 之前这两个契约挂着 `layout_read` / `layout_write` 两个从未发布的 `pi` 幽灵别名（审计 §4.2），已删。
import { layoutPiInputSchemaForAlias } from "../layout";
import { modelArgumentTolerance, noArgumentTolerance } from "../modelArgumentTolerance";
import type { VerbDeclaration } from "../verbDeclaration";

const LAYOUT_GUIDELINES = Object.freeze([
  "The editing layout is the user's workspace arrangement, not project content: read it before writing it and never change it to work around a missing panel.",
]);

function schemaFor(alias: string): VerbDeclaration["schema"] {
  const schema = layoutPiInputSchemaForAlias(alias);
  if (!schema) throw new Error(`Unregistered layout alias: ${alias}`);
  return schema;
}

export function layoutVerbs(): VerbDeclaration[] {
  const read: VerbDeclaration = {
    name: "layout_read",
    contractId: "layout.read",
    effect: "read",
    nextAction: "none",
    profiles: [],
    profileReason: "mcpHandwrittenTransport",
    describe: {
      does: "Read the current five-panel editing layout: panel widths, timeline height, visibility and preset.",
      useWhen: "Use it when a headless host needs to know which panels the user can currently see before showing a result there.",
      notWhen: "Do not use it to read project content — the script is read_full_text, the canvas is nomi_canvas_read, the timeline is read_timeline. It never changes anything.",
      params: "Takes no arguments.",
    },
    promptGuidelines: LAYOUT_GUIDELINES,
    schema: schemaFor("layout_read"),
    examples: [{ when: "Always call it with no arguments:", arguments: {} }],
    prepareArguments: noArgumentTolerance,
  };
  const write: VerbDeclaration = {
    name: "layout_write",
    contractId: "layout.write",
    effect: "reversible_local",
    nextAction: "none",
    profiles: [],
    profileReason: "mcpHandwrittenTransport",
    describe: {
      does: "Apply a reversible change to the five-panel editing layout (widths, timeline height, visibility, preset).",
      useWhen: "Use it only when the user asked to show, hide or resize a panel, or to switch to a named preset.",
      notWhen: "Do not use it to change project content (read_full_text, nomi_canvas_read and read_timeline are the entry points for that) and never to hide a panel the user did not mention.",
      params: "layout is the complete layout object exactly as returned by layout_read with the fields you want changed; partial objects are rejected.",
    },
    promptGuidelines: LAYOUT_GUIDELINES,
    schema: schemaFor("layout_write"),
    examples: [{
      when: "Switch to the focus preset with the default sizes:",
      arguments: { layout: { sourceWidth: 320, inspectorWidth: 280, assistantWidth: 400, timelineHeight: 220, visibility: { source: true, inspector: true, assistant: true }, preset: "focus" } },
    }],
    prepareArguments: modelArgumentTolerance({ objectFields: ["layout"] }),
  };
  return [read, write];
}
